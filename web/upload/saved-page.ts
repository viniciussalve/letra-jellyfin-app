import "./saved.css";
import { getSummary } from "../shared/api.ts";
import { el, iconEl } from "../shared/dom.ts";
import { formatTime } from "../shared/format.ts";
import type { Menu } from "../shared/menu.ts";
import { navBar } from "../shared/nav.ts";
import { tokenMs } from "../shared/motion.ts";
import { toast } from "../shared/toast.ts";
import {
  countLabel,
  groupBySong,
  isTrackId,
  lineHref,
  linesLabel,
  mergeSummaries,
  readSaved,
  removeLine,
  restoreLine,
  SAVED_KEY,
  savedLabel,
  writeSaved,
  type SavedLine,
  type SavedSong,
} from "../shared/saved.ts";
import { lineTranslations, paintRow, readTranslationEnabled, writeTranslationEnabled, type RowNote, type TranslationPatch } from "./line-translate.ts";

const COPY = {
  title: "Linhas salvas",
  unavailable: "Música indisponível",
  remove: "Remover linha salva",
  empty: "Nenhuma linha salva ainda. No player, toque no marcador ao lado de um verso para guardá-lo aqui.",
  goHome: "Ir para o início",
  removed: "Linha removida",
  undo: "Desfazer",
  blocked: "Não foi possível salvar neste navegador.",
  full: "Você chegou ao limite de 1000 linhas salvas. Remova algumas para salvar novas.",
};

/** Fields where Ctrl+Z belongs to the text. */
const TEXT_ENTRY = "input, select, textarea, [contenteditable]:not([contenteditable='false'])";

/** How long the undo toast stays. */
const UNDO_MS = 5000;

/** The summary route takes at most this many ids per request. */
const BATCH = 50;

/** Removes the previous render's listeners: only the latest page listens. */
let unmount: AbortController | null = null;

function cover(song: SavedSong, gone: boolean): HTMLElement {
  if (song.hasCover && !gone) {
    const img = el("img", { src: `/media/${encodeURIComponent(song.trackId)}/cover.jpg`, alt: "", loading: "lazy", decoding: "async" });
    return el("div", { class: "saved-cover" }, img);
  }
  return el("div", { class: "saved-cover is-tile" }, iconEl("music-note"));
}

/** Ids for the lines' text; a counter, since a stored track id may hold anything, spaces included. */
let textIds = 0;

/**
 * The rows' translate controls: `control` builds a row's, given the row and the id of its text;
 * `note` is what the row shows in its translation's place. Null when the rows get none.
 */
type TranslateControl = { control(row: HTMLElement, l: SavedLine, textId: string): HTMLElement; note(l: SavedLine): RowNote | null } | null;

function lineItem(l: SavedLine, gone: boolean, now: number, translate: TranslateControl): HTMLElement {
  const id = `saved-q-${++textIds}`;
  const text = el("span", { class: "saved-q", "data-line-text": true, id, lang: l.lang || null }, l.text);
  const link = gone
    ? el("span", { class: "saved-line-link", "data-line-link": true }, text)
    : el("a", { class: "saved-line-link", "data-line-link": true, href: lineHref(l) }, text);
  const body = el("div", { class: "saved-line-text" }, link);

  const at = new Date(l.at);
  const when = el(
    "time",
    {
      class: "saved-when",
      "data-saved-when": true,
      datetime: Number.isNaN(at.getTime()) ? null : at.toISOString(),
      title: Number.isNaN(at.getTime()) ? null : at.toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "short" }),
    },
    savedLabel(l.at, now, "page"),
  );
  const meta = el("div", { class: "saved-line-meta" }, when);
  if (l.t !== null && !gone) meta.append(el("span", { class: "saved-time", "data-line-time": true }, iconEl("play"), formatTime(l.t)));

  const remove = el("button", { type: "button", class: "saved-act", "data-remove": true, "aria-label": COPY.remove, "aria-describedby": id }, iconEl("bookmark-simple-fill"));
  const acts = el("div", { class: "saved-acts" });
  const row = el("li", { class: "saved-line", "data-line": true, "data-track": l.trackId, "data-index": l.index }, body, meta, acts);
  const control = gone ? null : translate;
  if (control) acts.append(control.control(row, l, id));
  acts.append(remove);
  paintRow(row, l.tr, control?.note(l) ?? null);
  return row;
}

function songSection(song: SavedSong, gone: boolean, now: number, translate: TranslateControl): HTMLElement {
  const meta = el("div", { class: "saved-meta" }, el("h2", {}, song.title), el("p", {}, gone ? COPY.unavailable : song.artist));
  const count = el("span", { "data-song-count": true }, linesLabel(song.lines.length));
  const head = gone
    ? el("div", { class: "saved-song-head", "data-song-head": true }, cover(song, gone), meta, count)
    : el("a", { class: "saved-song-head", "data-song-head": true, href: `/t/${encodeURIComponent(song.trackId)}` }, cover(song, gone), meta, count);
  return el(
    "section",
    { class: gone ? "saved-song is-gone" : "saved-song", "data-song": true, "data-id": song.trackId },
    head,
    el("ul", { class: "saved-lines" }, ...song.lines.map((l) => lineItem(l, gone, now, translate))),
  );
}

/**
 * The saved lines by song (spec §6): drawn from this browser's store at once, then refreshed from
 * the server's summaries. Nothing here needs a session. It loads again when the page comes back
 * from the back/forward cache and when another tab changes the store. `actions` go in the bar.
 */
export function renderSavedPage(app: HTMLElement, opts: { actions?: Node[] } = {}): void {
  let lines: SavedLine[] = [];
  let goneIds = new Set<string>(); // songs the server no longer has, for this visit only
  let generation = 0; // bumped by every load: only the latest load's summaries land
  let translationOn = readTranslationEnabled(); // the server's last word, until it answers again
  let menus: Menu[] = []; // the rows' translate menus as drawn now

  const heading = el("h1", { tabindex: "-1" }, COPY.title);
  const count = el("p", { "data-saved-count": true });
  const songsEl = el("div", { class: "saved-songs" });
  const empty = el(
    "div",
    { class: "home-empty saved-empty", "data-saved-empty": true },
    iconEl("bookmark-simple"),
    el("p", {}, COPY.empty),
    el("a", { href: "/" }, COPY.goHome),
  );

  /** Moves focus to a row's link, or to its remove button when the link is plain text (a song the server dropped). */
  const focusRow = (row: Element | null | undefined) =>
    (row?.querySelector<HTMLElement>("a[data-line-link]") ?? row?.querySelector<HTMLElement>("[data-remove]"))?.focus();

  const findRow = (trackId: string, index: number) =>
    [...songsEl.querySelectorAll<HTMLElement>("[data-line]")].find((n) => n.dataset.track === trackId && n.dataset.index === String(index));

  /** A row's part that held focus, found again in the row drawn anew. */
  const partOf = (active: HTMLElement) =>
    active.hasAttribute("data-remove")
      ? "[data-remove]"
      : active.hasAttribute("data-retry")
        ? "[data-retry]"
        : active.closest(".saved-tr-wrap")
          ? "[data-translate]"
          : "a[data-line-link]";

  /** The results of the rows' translations, announced; empty when the page is built. */
  const status = el("div", { class: "sr-only", "data-translate-status": true, role: "status", "aria-live": "polite" });

  /** Keeps a write the store took in the page's lines; the translations draw the row. */
  const translated = (rec: SavedLine, patch: TranslationPatch) => {
    lines = lines.map((l) => (l.trackId === rec.trackId && l.index === rec.index && l.text === rec.text ? { ...l, ...patch } : l));
    if (patch.lang) findRow(rec.trackId, rec.index)?.querySelector("[data-line-text]")?.setAttribute("lang", patch.lang);
  };

  const translations = lineTranslations({
    status,
    record: (trackId, index) => lines.find((x) => x.trackId === trackId && x.index === index),
    row: findRow,
    onSaved: translated,
  });

  const translateControl: TranslateControl = {
    control: (row, l, textId) => {
      const control = translations.control(row, l, textId);
      menus.push(control.menu);
      return control.element;
    },
    note: translations.note,
  };

  const draw = () => {
    const active = document.activeElement;
    const inside = active instanceof HTMLElement && songsEl.contains(active);
    const headOf = inside ? active.closest<HTMLElement>("[data-song-head]")?.closest<HTMLElement>("[data-song]")?.dataset.id : undefined;
    const line = inside ? active.closest<HTMLElement>("[data-line]") : null;
    const focused = line && inside ? { track: line.dataset.track, index: line.dataset.index, part: partOf(active) } : null;

    // An open menu is closed through its own code before its row goes, so nothing of it lingers.
    for (const m of menus) m.close();
    menus = [];
    const songs = groupBySong(lines);
    const now = Date.now();
    count.textContent = countLabel(lines.length, songs.length);
    count.hidden = lines.length === 0;
    empty.hidden = lines.length > 0;
    const translate = translationOn ? translateControl : null;
    songsEl.replaceChildren(...songs.map((s) => songSection(s, goneIds.has(s.trackId), now, translate)));

    if (headOf !== undefined) {
      [...songsEl.querySelectorAll<HTMLElement>("[data-song]")].find((n) => n.dataset.id === headOf)?.querySelector<HTMLElement>("[data-song-head]")?.focus();
    } else if (focused) {
      const again = [...songsEl.querySelectorAll<HTMLElement>("[data-line]")].find((n) => n.dataset.track === focused.track && n.dataset.index === focused.index);
      const part = again?.querySelector<HTMLElement>(focused.part);
      if (part) part.focus();
      // A part that went (the translate controls, when translation goes off) gives way to the row's link.
      else if (again) focusRow(again);
      else heading.focus(); // the row is gone: focus must not fall to the page
    }
  };

  const undo = (record: SavedLine) => {
    const result = restoreLine(record);
    if (result !== "saved") {
      toast(result === "full" ? COPY.full : COPY.blocked);
      return;
    }
    lines = [...lines.filter((l) => !(l.trackId === record.trackId && l.index === record.index)), record];
    draw();
    focusRow(findRow(record.trackId, record.index));
  };

  /** Undoes the last removal while its toast shows (Ctrl+Z and Cmd+Z run it too); null otherwise. */
  let pendingUndo: (() => void) | null = null;

  /**
   * Removes the row's line with no question: the row fades out, then the page is drawn again
   * without it. From the keyboard the undo toast has no countdown until focus has been in it and
   * left, so "Desfazer" can be reached by Tab however far it is.
   */
  const remove = (row: HTMLElement, fromKeyboard: boolean) => {
    if (row.classList.contains("is-leaving")) return;
    const trackId = row.dataset.track ?? "";
    const index = Number(row.dataset.index);
    const record = removeLine(trackId, index);
    if (!record) {
      // Another tab may have removed it already: read the store again, with no error.
      if (!readSaved().some((l) => l.trackId === trackId && l.index === index)) {
        lines = readSaved();
        draw();
      } else {
        toast(COPY.blocked);
      }
      return;
    }
    lines = lines.filter((l) => !(l.trackId === trackId && l.index === index));
    const hideToast = toast(COPY.removed, {
      ms: UNDO_MS,
      sticky: fromKeyboard,
      action: { label: COPY.undo, run: () => undo(record) },
      onHide: () => {
        if (pendingUndo === run) pendingUndo = null;
      },
    });
    const run = () => {
      hideToast();
      undo(record);
    };
    pendingUndo = run;

    // Focus moves now, so it is never on a row that is about to go: next row, else previous, else the title.
    const rows = [...songsEl.querySelectorAll<HTMLElement>("[data-line]:not(.is-leaving)")];
    const at = rows.indexOf(row);
    const neighbour = rows[at + 1] ?? rows[at - 1];
    if (neighbour) focusRow(neighbour);
    else heading.focus();

    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      draw();
      return;
    }
    row.classList.add("is-leaving");
    const done = () => {
      row.removeEventListener("transitionend", onEnd);
      window.clearTimeout(fallback);
      if (songsEl.contains(row)) draw();
    };
    const onEnd = (e: TransitionEvent) => {
      if (e.target === row && e.propertyName === "opacity") done();
    };
    row.addEventListener("transitionend", onEnd);
    const fallback = window.setTimeout(done, tokenMs("--dur-exit") + 50);
  };

  songsEl.addEventListener("click", (e) => {
    const button = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-remove]") : null;
    const row = button?.closest<HTMLElement>("[data-line]");
    if (row) remove(row, e.detail === 0); // a click made from the keyboard has no pointer presses
  });

  app.className = "upload home";
  app.replaceChildren(
    navBar({ current: "saved", actions: opts.actions }),
    el(
      "div",
      { class: "home-page saved-page", "data-saved-view": true },
      el("div", { class: "saved-col" }, el("div", { class: "saved-head" }, heading, count), songsEl, empty),
      status,
    ),
  );

  /** Draws the stored lines at once, then refreshes the songs' details from the server. */
  const load = () => {
    const asked = ++generation;
    lines = readSaved();
    draw();
    const ids = [...new Set(lines.map((l) => l.trackId))];
    // An id the server would refuse is a song it does not have; only the others are asked about.
    const asking = ids.filter(isTrackId);
    const refused = ids.filter((id) => !isTrackId(id));
    goneIds = new Set([...[...goneIds].filter((id) => asking.includes(id)), ...refused]);
    if (refused.length > 0) draw();
    if (asking.length === 0) return;
    const batches: string[][] = [];
    for (let i = 0; i < asking.length; i += BATCH) batches.push(asking.slice(i, i + BATCH));
    Promise.all(batches.map((b) => getSummary(b))).then(
      (answers) => {
        if (asked !== generation || !app.contains(songsEl)) return;
        const merged = mergeSummaries(readSaved(), answers.flatMap((a) => a.tracks));
        if (merged.changed) writeSaved(merged.list);
        lines = merged.list;
        // A song outside the request (saved meanwhile) is not "gone"; only the asked ones count.
        const gone = new Set([...merged.gone.filter((id) => asking.includes(id)), ...refused]);
        const on = answers.every((a) => a.translationEnabled);
        writeTranslationEnabled(on);
        // Nothing shown changed: no redraw, so an open menu stays open.
        const same = !merged.changed && on === translationOn && gone.size === goneIds.size && [...gone].every((id) => goneIds.has(id));
        goneIds = gone;
        translationOn = on;
        if (!same) draw();
      },
      () => {}, // the stored lines stay, with no error message
    );
  };

  unmount?.abort();
  unmount = new AbortController();
  const { signal } = unmount;
  window.addEventListener(
    "pageshow",
    (e) => {
      if (e.persisted && app.contains(songsEl)) load();
    },
    { signal },
  );
  document.addEventListener(
    "keydown",
    (e) => {
      if (!pendingUndo || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "z") return;
      if (e.target instanceof Element && e.target.closest(TEXT_ENTRY)) return;
      e.preventDefault();
      pendingUndo();
    },
    { signal },
  );
  // The press that closes an open menu only closes it: the click that follows does not open a
  // song from its row's link or its header (the rows' links cover the rows). Buttons still act.
  // A menu closes on the press, so the menu open when it began and shut by the click tells.
  let menuAtPress: Menu | undefined;
  document.addEventListener("pointerdown", () => (menuAtPress = menus.find((m) => m.isOpen)), { capture: true, signal });
  document.addEventListener("pointercancel", () => (menuAtPress = undefined), { capture: true, signal });
  document.addEventListener(
    "click",
    (e) => {
      const dismissed = menuAtPress !== undefined && !menuAtPress.isOpen && e.detail !== 0; // a key's click has no press
      menuAtPress = undefined;
      const link = dismissed && e.target instanceof Element ? e.target.closest("a") : null;
      if (link && songsEl.contains(link)) e.preventDefault();
    },
    { capture: true, signal },
  );
  window.addEventListener(
    "storage",
    (e) => {
      if ((e.key === null || e.key === SAVED_KEY) && app.contains(songsEl)) load();
    },
    { signal },
  );
  load();
}
