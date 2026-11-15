import type { TrackDTO } from "../../shared/types.ts";
import { el, iconEl } from "../shared/dom.ts";
import { defaultStore } from "../shared/recents.ts";
import { isSaved, readSaved, removeLine, SAVED_HINT_KEY, SAVED_KEY, saveLine } from "../shared/saved.ts";
import { toast } from "../shared/toast.ts";
import { saveLabel, type LyricsView, type SaveTarget } from "./lyrics-view.ts";

export type SaveLine = {
  /** Saves or removes the verse at `index`, or the one the keyboard acts on; nothing when there is no such verse. */
  toggle(index?: number): void;
  /** Brings the button after the lyrics in line with the verse the keyboard acts on. */
  sync(): void;
};

const COPY = {
  saved: "Linha salva",
  removed: "Linha removida",
  hint: "Linha salva. Elas ficam em Linhas salvas.",
  full: "Você chegou ao limite de 1000 linhas salvas. Remova algumas para salvar novas.",
  blocked: "Não foi possível salvar neste navegador.",
  pillSave: "Salvar linha",
  pillRemove: "Remover linha salva",
};

const TOAST_MS = 4000;

/** Whether the first-save toast was shown on this device; an unreadable store counts as shown, so it never nags. */
function hintShown(): boolean {
  try {
    return defaultStore()?.getItem(SAVED_HINT_KEY) !== null;
  } catch {
    return true;
  }
}

function markHintShown(): void {
  try {
    defaultStore()?.setItem(SAVED_HINT_KEY, "1");
  } catch {
    // The toast may show again on the next save; nothing else depends on the flag.
  }
}

/**
 * Wires the saved-lines store to the player: the toggle (icons, the S key), the button after
 * the lyrics (synced lyrics only), the announcements and the toasts. The marks follow the
 * store, so another tab's changes show here too.
 */
export function mountSaveLine(track: TrackDTO, view: LyricsView, column: HTMLElement): SaveLine {
  const synced = column.dataset.lyricsState === "synced"; // set by the lyrics view
  // The status region is in the page from the start: screen readers skip regions that arrive filled.
  const status = el("div", { class: "save-status", role: "status", "aria-live": "polite", "data-save-status": true });
  column.append(status);
  const pill = synced
    ? el(
        "button",
        { type: "button", class: "save-pill", "data-save-line": true, "aria-pressed": "false" },
        iconEl("bookmark-simple", "icon save-outline"),
        iconEl("bookmark-simple-fill", "icon save-filled"),
        el("span", { class: "save-pill-label" }, COPY.pillSave),
      )
    : null;
  const pillLabel = pill?.querySelector(".save-pill-label");
  if (pill) column.querySelector("[data-lyrics-scroll]")!.after(pill);

  let saved = new Set<number>();
  let announceFrame = 0;

  /** The verses that show as saved: a record for this track, at that index, with that very text. */
  const refresh = () => {
    const list = readSaved();
    saved = new Set();
    for (const l of list) {
      const verse = l.trackId === track.id ? view.targetAt(l.index) : null;
      if (verse && isSaved(list, track.id, verse.index, verse.text)) saved.add(verse.index);
    }
    view.setSaved(saved);
    sync();
  };

  /** Empties the region, then fills it in the next frame, so the same words twice are read twice. */
  const announce = (text: string) => {
    cancelAnimationFrame(announceFrame);
    status.textContent = "";
    announceFrame = requestAnimationFrame(() => (status.textContent = text));
  };

  const save = (target: SaveTarget) => {
    const result = saveLine({
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      hasCover: track.hasCover,
      index: target.index,
      t: target.t,
      text: target.text,
      lang: track.lyricsLang,
      tr: target.translation,
    });
    if (result === "full") return toast(COPY.full, TOAST_MS);
    if (result === "blocked") return toast(COPY.blocked, TOAST_MS);
    announce(COPY.saved);
    if (!hintShown()) {
      toast(COPY.hint, TOAST_MS);
      markHintShown();
    }
  };

  const remove = (target: SaveTarget) => {
    if (removeLine(track.id, target.index) === null) return toast(COPY.blocked, TOAST_MS);
    announce(COPY.removed);
  };

  function sync(): void {
    if (!pill) return;
    const target = view.target();
    pill.hidden = target === null;
    if (!target) return;
    const on = saved.has(target.index);
    pill.setAttribute("aria-pressed", String(on));
    pill.setAttribute("aria-label", saveLabel(target.text, on));
    if (pillLabel) pillLabel.textContent = on ? COPY.pillRemove : COPY.pillSave;
  }

  const popWatched = new WeakSet<Element>();

  /**
   * Plays the pop on a verse's icon. The class stays while the animation runs. The end and cancel
   * events arrive a frame late, so a pop that restarts an unfinished one also receives the old
   * pop's cancel: the class goes only when no pop is left running.
   */
  const pop = (index: number) => {
    const icon = column.querySelector<HTMLElement>(`[data-verse][data-index="${index}"] .verse-save`);
    if (!icon) return;
    if (!popWatched.has(icon)) {
      popWatched.add(icon);
      const end = () => {
        const running = icon.getAnimations({ subtree: true }).some((a) => (a as CSSAnimation).animationName === "save-pop" && a.playState === "running");
        if (!running) icon.classList.remove("is-popping");
      };
      icon.addEventListener("animationend", end);
      icon.addEventListener("animationcancel", end);
    }
    icon.classList.remove("is-popping");
    void icon.offsetWidth; // restarts the animation if the last one is still running
    icon.classList.add("is-popping");
  };

  const toggle = (index?: number) => {
    const target = index === undefined ? view.target() : view.targetAt(index);
    if (!target) return;
    // The store decides, not the marks: another tab may have changed it a moment ago.
    const wasSaved = isSaved(readSaved(), track.id, target.index, target.text);
    if (wasSaved) remove(target);
    else save(target);
    refresh();
    if (!wasSaved && saved.has(target.index)) pop(target.index); // only when the listener saves, and it took
  };

  pill?.addEventListener("click", () => toggle());
  window.addEventListener("storage", (e) => {
    if (e.key === SAVED_KEY || e.key === null) refresh();
  });
  // A page restored from the back/forward cache missed the changes made meanwhile.
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) refresh();
  });
  // Marks already in the store show from the first frame: no fade runs for them at load.
  column.classList.add("save-restoring");
  refresh();
  void column.offsetWidth; // the styles settle with transitions off
  column.classList.remove("save-restoring");

  return { toggle, sync };
}
