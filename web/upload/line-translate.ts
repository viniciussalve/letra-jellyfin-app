// The translate button of a saved line on /salvas, its menu of languages, the request and the
// row's states while and after it runs. The page owns the store's lines and the rows; this module
// draws the control, asks the server, writes the answer into the record it was asked for and
// keeps each row's note in memory, by song and position, so a redraw shows it again.

import { ApiClientError, getLineTranslation } from "../shared/api.ts";
import { el, iconEl } from "../shared/dom.ts";
import { attachMenu, type Menu } from "../shared/menu.ts";
import { defaultStore } from "../shared/recents.ts";
import { isSaved, readSaved, setLineTranslation, type SavedLine } from "../shared/saved.ts";
import { toast } from "../shared/toast.ts";
import type { LineTranslationDTO } from "../../shared/types.ts";

const COPY = {
  translate: "Traduzir linha",
  hide: "Ocultar tradução",
  lyricLanguage: "Idioma da letra",
  failed: "Não foi possível traduzir agora.",
  retry: "Tentar de novo",
  changed: "Esta linha mudou na música e não pode ser traduzida.",
  blocked: "Não foi possível salvar neste navegador.",
  busy: (inName: string) => `Traduzindo para ${inName}…`,
  same: (inName: string) => `Esta linha já está em ${inName}.`,
};

/** The menu's languages, in order; `inName` is the name inside a sentence. */
const LANGUAGES = [
  { code: "pt-BR", name: "Português", inName: "português" },
  { code: "en", name: "Inglês", inName: "inglês" },
] as const;

const inName = (code: string) => LANGUAGES.find((l) => l.code === code)?.inName ?? code;

/** The translating text shows at least this long, counted from the choice; a failure waits the same. */
const BUSY_MIN_MS = 300;

/** With no answer this long after a choice, the translating text is announced. */
const BUSY_ANNOUNCE_MS = 1000;

/** The last `translationEnabled` the server gave, so the buttons draw at once on the next visit. */
export const TRANSLATION_ENABLED_KEY = "letra.translation.enabled.v1";

/** The stored answer; false when there is none or storage is blocked. */
export function readTranslationEnabled(): boolean {
  try {
    return defaultStore()?.getItem(TRANSLATION_ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeTranslationEnabled(on: boolean): void {
  try {
    defaultStore()?.setItem(TRANSLATION_ENABLED_KEY, on ? "1" : "0");
  } catch {
    // storage full or blocked: the next visit asks again
  }
}

const primary = (tag: string) => tag.toLowerCase().split("-")[0]!;

/** What a row shows in its translation's place: the translating text or one of the three notes. */
export type RowNote = { kind: "busy" | "failed" | "same"; code: string } | { kind: "changed" };

const noteText = (note: RowNote) =>
  note.kind === "busy" ? COPY.busy(inName(note.code)) : note.kind === "same" ? COPY.same(inName(note.code)) : note.kind === "failed" ? COPY.failed : COPY.changed;

/**
 * Draws what goes under a row's line: the busy text or a note when there is one, else the
 * record's translation. The one place that decides the button's `is-on`: white while the line
 * translates and while a translation shows.
 */
export function paintRow(row: HTMLElement, tr: SavedLine["tr"], note: RowNote | null = null): void {
  row.querySelectorAll("[data-line-translation], [data-line-busy], [data-line-note]").forEach((n) => n.remove());
  const link = row.querySelector("[data-line-link]");
  if (note?.kind === "busy") {
    link?.append(el("span", { class: "saved-tr is-busy", "data-line-busy": true }, noteText(note)));
  } else if (note) {
    const p = el("p", { class: "saved-note", "data-line-note": true }, noteText(note));
    if (note.kind === "failed") {
      const textId = row.querySelector("[data-line-text]")?.id || null;
      p.append(el("button", { type: "button", class: "saved-retry", "data-retry": true, "aria-describedby": textId }, COPY.retry));
    }
    link?.after(p);
  } else if (tr) {
    link?.append(el("span", { class: "saved-tr", "data-line-translation": true, lang: tr.lang }, tr.text));
  }
  row.querySelector("[data-translate]")?.classList.toggle("is-on", note?.kind === "busy" || (!note && tr !== null));
}

/** What a write changed in a record. */
export type TranslationPatch = { tr?: SavedLine["tr"]; lang?: string };

/** Ids for the menus, which `aria-controls` needs; a counter, like the lines' text ids. */
let menuIds = 0;

const keyOf = (trackId: string, index: number) => `${index}\n${trackId}`;

type Outcome = { answer: LineTranslationDTO } | { error: unknown };

/**
 * The page's translate controls. `record` and `row` find a line's record and its row as the page
 * holds them now (the row drawn last); `onSaved` hears of each write the store kept: the record it
 * went into and what changed. `status` is the page's live region for the results.
 */
export function lineTranslations(o: {
  status: HTMLElement;
  record(trackId: string, index: number): SavedLine | undefined;
  row(trackId: string, index: number): HTMLElement | undefined;
  onSaved(rec: SavedLine, patch: TranslationPatch): void;
}) {
  /** Each row's note and the number of its latest choice, by song and position; a reload forgets them. */
  const states = new Map<string, { note: RowNote | null; ask: number }>();
  let asks = 0;
  let announced = 0;

  const stateOf = (rec: SavedLine) => {
    const key = keyOf(rec.trackId, rec.index);
    let s = states.get(key);
    if (!s) states.set(key, (s = { note: null, ask: 0 }));
    return s;
  };

  const noteOf = (l: SavedLine) => states.get(keyOf(l.trackId, l.index))?.note ?? null;

  /** Draws the row drawn last for the record, as the page's line and the row's note are now. */
  const repaint = (trackId: string, index: number) => {
    const row = o.row(trackId, index);
    if (row) paintRow(row, o.record(trackId, index)?.tr ?? null, states.get(keyOf(trackId, index))?.note ?? null);
  };

  /** Empties the live region; the text, if any, comes in the next frame, so it is heard as new. */
  const announce = (text: string | null, lang: string | null = null) => {
    const id = ++announced;
    o.status.replaceChildren();
    o.status.removeAttribute("lang");
    if (text === null) return;
    requestAnimationFrame(() => {
      if (id !== announced) return;
      if (lang) o.status.setAttribute("lang", lang);
      o.status.textContent = text;
    });
  };

  /** Writes into the record it was asked for: true when the store kept it, false when it refused, null when the record is gone. */
  const save = (rec: SavedLine, patch: TranslationPatch): boolean | null => {
    if (setLineTranslation(rec.trackId, rec.index, rec.text, patch)) {
      o.onSaved(rec, patch);
      return true;
    }
    return isSaved(readSaved(), rec.trackId, rec.index, rec.text) ? false : null;
  };

  /** Lands an answer, unless a newer choice of the row or the row's removal came first. */
  const settle = (rec: SavedLine, code: string, ask: number, outcome: Outcome) => {
    const key = keyOf(rec.trackId, rec.index);
    const s = states.get(key);
    if (!s || s.ask !== ask) return;
    if (!o.record(rec.trackId, rec.index)) {
      states.delete(key);
      return;
    }
    let note: RowNote | null = null;
    let patch: TranslationPatch | null = null;
    let tr: SavedLine["tr"] = null;
    if ("error" in outcome) {
      note = outcome.error instanceof ApiClientError && outcome.error.code === "line_changed" ? { kind: "changed" } : { kind: "failed", code };
    } else if (outcome.answer.sameLanguage) {
      note = { kind: "same", code };
      patch = { lang: outcome.answer.sourceLang ?? code };
    } else if (outcome.answer.text) {
      tr = { lang: code, text: outcome.answer.text };
      patch = outcome.answer.sourceLang ? { tr, lang: outcome.answer.sourceLang } : { tr };
    } else {
      note = { kind: "failed", code }; // a blank answer is no translation
    }
    if (patch) {
      const kept = save(rec, patch);
      if (kept === null) {
        states.delete(key);
        repaint(rec.trackId, rec.index);
        return;
      }
      if (!kept) {
        s.note = null;
        repaint(rec.trackId, rec.index);
        toast(COPY.blocked);
        return;
      }
    }
    s.note = note;
    repaint(rec.trackId, rec.index);
    if (note) announce(noteText(note));
    else if (tr) announce(tr.text, tr.lang);
  };

  /** Asks for the line in `code`; only the row's latest choice counts. */
  const choose = (trackId: string, index: number, code: string) => {
    const rec = o.record(trackId, index);
    if (!rec) return;
    const s = stateOf(rec);
    const ask = (s.ask = ++asks);
    if (rec.tr?.lang === code) {
      // The language in use: nothing to ask; the note, if any, goes.
      s.note = null;
      repaint(trackId, index);
      return;
    }
    const busy: RowNote = { kind: "busy", code };
    s.note = busy;
    repaint(trackId, index);
    announce(null);
    // A long wait is said once; a newer choice, the answer or the row's removal comes first otherwise.
    window.setTimeout(() => {
      if (states.get(keyOf(trackId, index)) !== s || s.ask !== ask || s.note !== busy || !o.record(trackId, index)) return;
      // The region was emptied at the choice, so the text is heard as new without waiting a frame.
      ++announced;
      o.status.removeAttribute("lang");
      o.status.textContent = noteText(busy);
    }, BUSY_ANNOUNCE_MS);
    const floor = new Promise<void>((done) => window.setTimeout(done, BUSY_MIN_MS));
    const answer: Promise<Outcome> = getLineTranslation(rec.trackId, rec.index, code, rec.text).then(
      (a) => ({ answer: a }),
      (error: unknown) => ({ error }),
    );
    void Promise.all([answer, floor]).then(([outcome]) => settle(rec, code, ask, outcome));
  };

  /** "Ocultar tradução": the translation and the row's note go. */
  const clear = (trackId: string, index: number) => {
    const rec = o.record(trackId, index);
    if (!rec) return;
    const s = stateOf(rec);
    s.ask = ++asks;
    s.note = null;
    if (save(rec, { tr: null }) === false) toast(COPY.blocked);
    repaint(trackId, index);
  };

  /**
   * The translate button and its menu for one row. The row must be drawn with `paintRow` and
   * `note(line)` once the control is in it.
   */
  const control = (row: HTMLElement, line: SavedLine, textId: string): { element: HTMLElement; menu: Menu } => {
    const { trackId, index } = line;
    const trigger = el(
      "button",
      { type: "button", class: "saved-act saved-translate", "data-translate": true, "aria-label": COPY.translate, "aria-describedby": textId },
      iconEl("translate"),
    );
    const menuEl = el("div", { class: "line-menu", id: `line-menu-${++menuIds}`, role: "menu", "aria-label": COPY.translate, hidden: true });

    const rows = () => [...menuEl.querySelectorAll<HTMLElement>(".menu-row")];
    const enabled = (r: HTMLElement) => r.getAttribute("aria-disabled") !== "true";

    /** Builds the rows from the record as it is now. */
    const fill = (rec: SavedLine) => {
      const lyric = rec.lang ? primary(rec.lang) : null;
      const items: HTMLElement[] = LANGUAGES.map((l) => {
        const disabled = lyric === primary(l.code);
        const item = el(
          "button",
          { type: "button", class: "menu-row", role: "menuitemradio", "data-lang": l.code, "aria-checked": String(rec.tr?.lang === l.code), "aria-disabled": disabled ? "true" : null },
          el("span", {}, l.name),
          disabled ? el("small", { class: "menu-note" }, COPY.lyricLanguage) : iconEl("check"),
        );
        item.addEventListener("click", () => {
          if (disabled) return;
          menu.close(true);
          choose(trackId, index, l.code);
        });
        return item;
      });
      if (rec.tr) {
        const item = el("button", { type: "button", class: "menu-row", role: "menuitem", "data-hide": true }, COPY.hide);
        item.addEventListener("click", () => {
          menu.close(true);
          clear(trackId, index);
        });
        items.push(item);
      }
      menuEl.replaceChildren(...items);
    };

    /** Opens upward when the menu's bottom would pass the viewport's bottom less 8 px. */
    const place = () => {
      menuEl.classList.remove("is-up");
      const wrap = menuEl.parentElement;
      if (!wrap) return;
      // Measured untransformed: the opening scale must not decide the side.
      const bottom = wrap.getBoundingClientRect().bottom + 6 + menuEl.offsetHeight;
      menuEl.classList.toggle("is-up", bottom > window.innerHeight - 8);
    };

    const menu = attachMenu({
      trigger,
      menu: menuEl,
      items: rows,
      first: () => rows().find((r) => r.getAttribute("aria-checked") === "true") ?? rows().find(enabled),
      onOpen: () => {
        const rec = o.record(trackId, index);
        if (rec) fill(rec);
        row.classList.add("has-menu");
        place();
      },
      onClose: () => row.classList.remove("has-menu"),
    });

    // "Tentar de novo" asks again for the language that failed, from the row's translate button.
    row.addEventListener("click", (e) => {
      if (!(e.target instanceof Element) || !e.target.closest("[data-retry]")) return;
      const note = states.get(keyOf(trackId, index))?.note;
      if (note?.kind !== "failed") return;
      trigger.focus();
      choose(trackId, index, note.code);
    });

    return { element: el("div", { class: "saved-tr-wrap" }, trigger, menuEl), menu };
  };

  return { control, note: noteOf };
}
