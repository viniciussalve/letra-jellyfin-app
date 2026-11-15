import { normalizeLangTag } from "../../shared/languages.ts";
import type { TrackDTO } from "../../shared/types.ts";
import { el, iconEl } from "../shared/dom.ts";
import { lyricsState } from "../shared/lyrics-state.ts";
import { activeIndex, blurLevel, currentVerse, firstVerseIndex, hasIntro, LYRICS_LEAD_MS, wipeProgress } from "./timing.ts";

/** A verse that can be saved: its place in the lyrics, its text and time, and the translation shown under it. */
export type SaveTarget = { index: number; text: string; t: number | null; translation: { lang: string; text: string } | null };

export type LyricsView = {
  /** Moves the active verse and its wipe to `ms`; called every frame while playing. */
  update(ms: number, durationMs: number): void;
  /**
   * Shows a translated line under each verse (aligned with the lyrics lines, each tagged
   * with `lang`), or a status `note` in their place; null removes either.
   */
  setTranslations(lines: string[] | null, note: string | null, lang?: string): void;
  /** The active verse and its shown translation; nulls when none is active (or a dots row is). */
  current(): { verse: string | null; translation: string | null };
  /** The verse the keyboard (the S key, the button after the lyrics) acts on; null when there is none. */
  target(): SaveTarget | null;
  /** A verse with text, by its index in the lyrics; null for breaks and out-of-range indexes. */
  targetAt(index: number): SaveTarget | null;
  /** Marks these verses as saved (by index) and every other one as not. */
  setSaved(indexes: ReadonlySet<number>): void;
};

type Options = {
  /** A verse was clicked (synced lyrics only): seek there and play. */
  onSeek(ms: number): void;
  /** The save icon of the verse at `index` was clicked or tapped. */
  onSave(index: number): void;
  /** The verse `target()` returns changed. Also called while the view is being created. */
  onTargetChange(): void;
  reducedMotion: MediaQueryList;
};

const FOLLOW_AT = 0.3; // the active verse's first line sits 30% down the column
const RESUME_AFTER_MS = 5000;
const SCROLL_TOLERANCE_PX = 2;
const BLUR_REACH = 24; // covers every row of a tall column (1024x1366); beyond it rows are far off screen

const COPY = {
  none: "A letra desta música não foi encontrada.",
  instrumental: "Instrumental",
  backToCurrent: "Voltar ao verso atual",
};

/** The name of a save control: it carries the line and what pressing it does. */
export const saveLabel = (line: string, saved: boolean) => (saved ? `Remover linha salva: ${line}` : `Salvar linha: ${line}`);

const isBreak = (text: string) => text.trim() === "";

/** The shared pulsing three-dot component (intro and breaks). */
const dots = () => el("span", { class: "dots" }, el("i", { class: "dot" }), el("i", { class: "dot" }), el("i", { class: "dot" }));

/** The two bookmark icons of a save control; the styles show one of them. */
const saveIcons = () => [iconEl("bookmark-simple", "icon save-outline"), iconEl("bookmark-simple-fill", "icon save-filled")];

/** Renders the lyrics into `column` (already in the document) and returns its controller. */
export function createLyricsView(column: HTMLElement, track: TrackDTO, opts: Options): LyricsView {
  const state = lyricsState(track);
  column.dataset.lyricsState = state;

  const list = el("div", { class: "lyrics-list" });
  const scroller = el("div", { class: "lyrics-scroll", "data-lyrics-scroll": true }, list);
  // The note is UI copy, so it sits outside the list (and its lang).
  const noteEl = el("p", { class: "translation-note", role: "status", hidden: true });
  column.append(scroller, noteEl);
  const setNote = (note: string | null) => {
    noteEl.textContent = note ?? "";
    noteEl.hidden = note === null;
  };

  if (state === "none" || state === "instrumental") {
    list.append(el("p", { class: "lyrics-message" }, COPY[state]));
    return {
      update() {},
      setTranslations() {},
      current: () => currentVerse(state, [], -1, null),
      target: () => null,
      targetAt: () => null,
      setSaved() {},
    };
  }

  // Only the verses are in the song's language; the column's pills and messages are UI copy.
  // (A tag stored before the server validated them may be free text: no lang then.)
  const lyricsLang = normalizeLangTag(track.lyricsLang);
  if (lyricsLang) list.lang = lyricsLang;
  const lines = track.lyrics!.lines;
  const synced = state === "synced";
  const texts: HTMLSpanElement[] = [];
  const verses = lines.map((line, i) => {
    const brk = isBreak(line.text);
    // Synced breaks show the three-dot pause; unsynced ones are stanza gaps.
    const text = el("span", { class: "verse-text" }, brk ? (synced ? dots() : "") : line.text);
    texts.push(text);
    const attrs = {
      class: `verse${brk ? " is-break" : ""}${brk && synced ? " is-dots" : ""}${brk ? "" : " has-save"}`,
      "data-verse": true,
      "data-index": i,
    };
    // Every verse with text ends with its save icon. Synced verses are buttons already, so
    // the icon is decoration there (the button after the lyrics is its keyboard twin);
    // unsynced verses get a real button each (roving: see the tab stop below).
    const save = brk
      ? null
      : synced
        ? el("span", { class: "verse-save", "aria-hidden": "true" }, ...saveIcons())
        : el(
            "button",
            { type: "button", class: "verse-save", tabindex: -1, "aria-pressed": "false", "aria-label": saveLabel(line.text, false) },
            ...saveIcons(),
          );
    if (synced && !brk && line.t !== null) {
      const button = el("button", { ...attrs, type: "button", tabindex: -1 }, text, save); // roving: see the tab stop below
      const t = line.t;
      button.addEventListener("click", (e) => {
        if (onSaveIcon(e)) return; // the list's handler saves; the song stays where it is
        // Seeking moves the active verse, which slides the column there; if it was
        // already active, the follow() after it brings a scrolled-away column back.
        startFollowing();
        opts.onSeek(t);
        follow(true);
      });
      return button;
    }
    return el("div", { ...attrs, "aria-hidden": brk ? "true" : null }, text, save);
  });
  // A long intro gets its own dots row, first in the list; blank lines before the first
  // verse would repeat it, so they are hidden.
  const intro = synced && hasIntro(lines)
    ? el("div", { class: "verse is-dots", "data-intro": true, "aria-hidden": "true" }, dots())
    : null;
  const firstVerse = firstVerseIndex(lines);
  if (intro) for (let i = 0; i < firstVerse; i++) verses[i]!.hidden = true;
  list.append(...(intro ? [intro] : []), ...verses);

  // --- saving: the icons, the saved marks and the verse the keyboard acts on ---------

  const targetAt = (index: number): SaveTarget | null => {
    const line = lines[index];
    if (!line || !verses[index]!.classList.contains("has-save")) return null;
    const tr = verses[index]!.querySelector<HTMLElement>(".verse-translation");
    return { index, text: line.text, t: line.t, translation: tr?.textContent ? { lang: tr.lang, text: tr.textContent } : null };
  };
  const setSaved = (indexes: ReadonlySet<number>) => {
    verses.forEach((v, i) => {
      if (!v.classList.contains("has-save")) return;
      const saved = indexes.has(i);
      v.toggleAttribute("data-saved", saved);
      const button = v.querySelector("button.verse-save");
      if (button) {
        button.setAttribute("aria-pressed", String(saved));
        button.setAttribute("aria-label", saveLabel(lines[i]!.text, saved));
      }
    });
  };
  const verseIndex = (node: Element | null) => {
    const v = node?.closest<HTMLElement>(".verse.has-save");
    return v ? Number(v.dataset.index) : -1;
  };
  // A click on the icon saves; on unsynced lyrics a click anywhere else on a verse picks it.
  let picked = -1;
  const pick = (index: number) => {
    if (index < 0 || index === picked) return;
    if (picked >= 0) verses[picked]!.removeAttribute("data-picked");
    verses[index]!.setAttribute("data-picked", "");
    picked = index;
    opts.onTargetChange();
  };
  list.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const index = verseIndex(target);
    if (index < 0) return;
    if (onSaveIcon(e)) opts.onSave(index);
    else if (!synced) pick(index);
  });

  if (!synced) {
    // The save buttons are a single Tab stop (roving tabindex), moved with ↑/↓. The keyboard
    // acts on the verse whose button has focus, else on the picked one (the first to start).
    const saveButtons = verses.flatMap((v) => [...v.querySelectorAll<HTMLButtonElement>("button.verse-save")]);
    let saveStop = saveButtons[0];
    saveStop?.setAttribute("tabindex", "0");
    pick(verseIndex(saveStop ?? null));
    list.addEventListener("focusin", (e) => {
      if (!(e.target instanceof HTMLButtonElement) || !saveButtons.includes(e.target)) return;
      saveStop?.setAttribute("tabindex", "-1");
      saveStop = e.target;
      saveStop.setAttribute("tabindex", "0");
      opts.onTargetChange();
    });
    list.addEventListener("focusout", () => opts.onTargetChange());
    list.addEventListener("keydown", (e) => {
      if ((e.key !== "ArrowUp" && e.key !== "ArrowDown") || e.ctrlKey || e.metaKey || e.altKey) return;
      const from = e.target instanceof HTMLButtonElement ? saveButtons.indexOf(e.target) : -1;
      if (from < 0) return;
      e.preventDefault();
      saveButtons[from + (e.key === "ArrowDown" ? 1 : -1)]?.focus();
    });
    const focusedIndex = () => {
      const a = document.activeElement;
      return a instanceof HTMLButtonElement && saveButtons.includes(a) ? verseIndex(a) : -1;
    };
    return {
      update() {},
      current: () => currentVerse(state, lines, -1, null),
      setTranslations: (t, note, lang) => {
        setNote(note);
        renderTranslations(verses, lines.length, t, lang);
      },
      target: () => {
        const focused = focusedIndex();
        return targetAt(focused >= 0 ? focused : picked);
      },
      targetAt,
      setSaved,
    };
  }

  // --- synced: active verse, wipe, following -------------------------------------

  const back = el("button", { type: "button", class: "back-pill", "data-back-to-current": true, hidden: true }, COPY.backToCurrent);
  column.append(back);

  const firstTimed = Math.max(0, lines.findIndex((l) => l.t !== null));
  let active = -1;
  let wiped = -1; // index whose span carries --p
  let lastP = "";
  let following = true;
  let expectedTop = 0;
  let resumeTimer = 0;

  // Inactive verses blur by distance from the shown active one: 1, 2, then 3 steps (the
  // CSS sizes them); beyond BLUR_REACH they are off screen and skip the filter.
  const applyStates = () => {
    // Before any verse is active, distance runs from the intro row (just before the first
    // verse) or from the first verse.
    const anchor = active >= 0 ? active : intro ? firstVerse - 1 : firstVerse;
    verses.forEach((v, i) => {
      const s = i < active ? "past" : i === active ? "active" : "future";
      if (v.dataset.state !== s) v.dataset.state = s;
      const blur = s === "active" ? "0" : String(blurLevel(i, anchor, BLUR_REACH));
      if (v.dataset.blur !== blur) v.dataset.blur = blur;
    });
    if (intro) {
      intro.dataset.state = active < 0 ? "active" : "past";
      intro.dataset.blur = active < 0 ? "0" : String(blurLevel(firstVerse - 1, active, BLUR_REACH));
    }
  };

  // --- keyboard: the verses are a single Tab stop (roving tabindex) ------------------
  // The stop is the active verse (the last one before an active break; the first before
  // any is active). While focus is on a verse the stop stays there, so a playing song
  // never moves focus; once focus leaves the lyrics column the stop goes back to the
  // active verse. ↑/↓ move between verse buttons; the intro and break rows are not buttons.
  //
  // Which verse the keyboard acts on (the S key, the button after the lyrics), one rule:
  // - a verse focused from the keyboard, while it has focus. It is decided when focus
  //   arrives: a verse focused by a pointer (Chromium focuses a clicked button) never
  //   holds it, even once a key makes it match :focus-visible;
  // - while focus is elsewhere in the column (the button after the lyrics), the verse it
  //   had when focus arrived there, whatever plays: the button's name must not shift.
  //   From outside the column that is the verse playing then. A window blur and return
  //   changes nothing;
  // - otherwise the playing verse (the first before any plays).
  const buttons = verses.filter((v): v is HTMLButtonElement => v instanceof HTMLButtonElement && !v.hidden);
  let tabStop: HTMLButtonElement | null = null;
  let held: HTMLButtonElement | null = null; // the verse focused from the keyboard
  let pinned: HTMLButtonElement | null = null; // the target while focus is in the column, off the verses
  let shown: HTMLButtonElement | undefined; // the target last reported
  const setTabStop = (button: HTMLButtonElement | undefined) => {
    if (!button || button === tabStop) return;
    tabStop?.setAttribute("tabindex", "-1");
    button.setAttribute("tabindex", "0");
    tabStop = button;
  };
  const activeButton = () => {
    for (let i = active; i >= 0; i--) {
      const v = verses[i];
      if (v instanceof HTMLButtonElement && !v.hidden) return v;
    }
    return buttons[0];
  };
  const targetButton = () => {
    const a = document.activeElement;
    if (held && a === held) return held;
    if (pinned && a instanceof Element && column.contains(a) && !list.contains(a)) return pinned;
    return activeButton();
  };
  const reportTarget = () => {
    const t = targetButton();
    if (t === shown) return;
    shown = t;
    opts.onTargetChange();
  };
  const leaveColumn = () => {
    held = null;
    pinned = null;
    setTabStop(activeButton());
    reportTarget();
  };
  const syncTabStop = () => {
    if (!column.contains(document.activeElement)) setTabStop(activeButton());
  };
  column.addEventListener("focusin", (e) => {
    const t = e.target;
    if (t instanceof HTMLButtonElement && buttons.includes(t)) {
      setTabStop(t);
      held = t.matches(":focus-visible") ? t : null;
      pinned = null;
    } else if (t instanceof Element && !list.contains(t) && !pinned) {
      // Arriving from a verse that holds the target keeps it; from anywhere else, the playing verse.
      pinned = held && e.relatedTarget === held ? held : activeButton() ?? null;
      setTabStop(pinned ?? undefined);
    }
    reportTarget();
  });
  column.addEventListener("focusout", (e) => {
    if (e.relatedTarget instanceof Node) {
      if (!column.contains(e.relatedTarget)) leaveColumn();
      return;
    }
    // No next element: focus went to the page (a click on nothing), or the window lost focus,
    // which keeps the focused element and so changes nothing here.
    window.setTimeout(() => {
      if (!column.contains(document.activeElement)) leaveColumn();
    });
  });
  list.addEventListener("keydown", (e) => {
    if ((e.key !== "ArrowUp" && e.key !== "ArrowDown") || e.ctrlKey || e.metaKey || e.altKey) return;
    const from = e.target instanceof HTMLButtonElement ? buttons.indexOf(e.target) : -1;
    if (from < 0) return;
    e.preventDefault(); // the column must not scroll, and the page's shortcuts must not see it
    buttons[from + (e.key === "ArrowDown" ? 1 : -1)]?.focus();
  });

  const targetTop = () => {
    const v = intro && active < 0 ? intro : verses[Math.max(active, firstTimed)]!;
    const pad = Number.parseFloat(getComputedStyle(v).paddingTop) || 0;
    const max = scroller.scrollHeight - scroller.clientHeight;
    return Math.round(Math.min(Math.max(v.offsetTop + pad - scroller.clientHeight * FOLLOW_AT, 0), max));
  };

  /**
   * Scrolls so the active verse sits at 30%. Animated moves are a FLIP: jump the
   * scroll position, offset each nearby verse back to where it was (the `translate`
   * property, so the dim scale in `transform` is untouched), then let them slide up
   * (--lyrics-follow on --ease-move), all together.
   */
  const follow = (animate: boolean) => {
    const target = targetTop();
    const delta = target - scroller.scrollTop;
    if (Math.abs(delta) < 1) {
      expectedTop = scroller.scrollTop;
      return;
    }
    const viewTop = scroller.scrollTop;
    const viewBottom = viewTop + scroller.clientHeight;
    const reach = Math.abs(delta);
    const rows = intro ? [intro, ...verses] : verses;
    const nearby = animate && !opts.reducedMotion.matches && reach <= scroller.clientHeight
      ? rows.filter((v) => v.offsetTop + v.offsetHeight > viewTop - reach && v.offsetTop < viewBottom + reach)
      : [];
    // Read any in-flight offsets before writing, so an interrupted slide continues smoothly.
    const inFlight = nearby.map((v) => {
      const m = getComputedStyle(v).translate.split(" ")[1];
      return m ? Number.parseFloat(m) || 0 : 0;
    });

    list.classList.add("is-jumping");
    for (const v of rows) if (!nearby.includes(v) && v.style.translate) v.style.translate = "";
    nearby.forEach((v, k) => (v.style.translate = `0 ${delta + inFlight[k]!}px`));
    scroller.scrollTop = target;
    expectedTop = scroller.scrollTop;
    void list.offsetHeight; // commit the jump before transitions come back
    list.classList.remove("is-jumping");
    for (const v of nearby) v.style.translate = "";
  };

  /** Sets --p on the active verse's text span only; reduced motion shows it plain white instead. */
  const setWipe = (index: number, ms: number, durationMs: number) => {
    const target = opts.reducedMotion.matches ? -1 : index;
    if (wiped !== target) {
      if (wiped >= 0) texts[wiped]!.style.removeProperty("--p");
      wiped = target;
      lastP = "";
    }
    if (target < 0) return;
    const p = `${(wipeProgress(lines, target, ms, durationMs, LYRICS_LEAD_MS) * 100).toFixed(1)}%`;
    if (p !== lastP) texts[target]!.style.setProperty("--p", p);
    lastP = p;
  };

  function startFollowing(): void {
    window.clearTimeout(resumeTimer);
    back.hidden = true;
    following = true;
  }
  const resume = () => {
    startFollowing();
    follow(true);
  };

  const userScrolled = () => {
    following = false;
    back.hidden = false;
    window.clearTimeout(resumeTimer);
    resumeTimer = window.setTimeout(resume, RESUME_AFTER_MS);
  };

  back.addEventListener("click", resume);
  scroller.addEventListener("wheel", userScrolled, { passive: true });
  scroller.addEventListener("touchmove", userScrolled, { passive: true });
  scroller.addEventListener(
    "scroll",
    () => {
      // Our own scrolls land exactly where we put them; anything else is the reader.
      if (Math.abs(scroller.scrollTop - expectedTop) > SCROLL_TOLERANCE_PX) userScrolled();
    },
    { passive: true },
  );

  // Font loading, translations and viewport changes move the verses: re-anchor without animation.
  const ro = new ResizeObserver(() => {
    if (following) follow(false);
    else expectedTop = scroller.scrollTop;
  });
  ro.observe(scroller);
  ro.observe(list);

  applyStates();
  setTabStop(activeButton());
  reportTarget();
  follow(false);

  return {
    update(ms, durationMs) {
      const raw = activeIndex(lines, ms, LYRICS_LEAD_MS); // the shown verse leads; the wipe starts on real time
      const index = intro && raw < firstVerse ? -1 : raw; // hidden leading blanks stay with the intro
      if (index !== active) {
        active = index;
        if (following) follow(true);
        applyStates(); // after the FLIP commit, so opacity and scale still transition
        syncTabStop();
        reportTarget();
      }
      setWipe(active, ms, durationMs);
    },
    current: () => currentVerse(state, lines, active, verses[active]?.querySelector(".verse-translation")?.textContent ?? null),
    setTranslations: (t, note, lang) => {
      setNote(note);
      renderTranslations(verses, lines.length, t, lang);
    },
    target: () => {
      const t = targetButton();
      return t ? targetAt(Number(t.dataset.index)) : null;
    },
    targetAt,
    setSaved,
  };
}

/** True when the click landed on a verse's save icon. */
function onSaveIcon(e: Event): boolean {
  return e.target instanceof Element && e.target.closest(".verse-save") !== null;
}

function renderTranslations(verses: HTMLElement[], count: number, lines: string[] | null, lang?: string): void {
  for (let i = 0; i < count; i++) {
    const verse = verses[i]!;
    verse.querySelector(".verse-translation")?.remove();
    const text = lines?.[i]?.trim();
    if (!text || verse.classList.contains("is-break")) continue;
    // Before the save icon, which stays the verse's last child.
    verse.insertBefore(el("span", { class: "verse-translation", lang: lang ?? null }, text), verse.querySelector(".verse-save"));
  }
}
