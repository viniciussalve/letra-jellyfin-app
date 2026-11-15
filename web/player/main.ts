import "../shared/tokens.css";
import "../shared/base.css";
import "./styles.css";
import type { Language, PlayerData, TrackDTO } from "../../shared/types.ts";
import { mountBackground } from "../shared/background.ts";
import { el, iconEl } from "../shared/dom.ts";
import { navBar } from "../shared/nav.ts";
import { formatRemaining, formatTime } from "../shared/format.ts";
import type { IconName } from "../shared/icons.ts";
import { enableActiveStates, flip, swapIcon } from "../shared/motion.ts";
import { applyPalette, extractPaletteFromImage } from "../shared/palette.ts";
import { recordVisit } from "../shared/recents.ts";
import { mountToast } from "../shared/toast.ts";
import { lyricsState } from "../shared/lyrics-state.ts";
import { createPlayer, durationOf } from "./audio.ts";
import { mountLayoutOrder } from "./layout-order.ts";
import { createLyricsView } from "./lyrics-view.ts";
import { mountSaveLine, type SaveLine } from "./save-line.ts";
import { mountShareDialog } from "./share-dialog.ts";
import { startAt } from "./timing.ts";
import { mountTranslation } from "./translation.ts";

const COPY = {
  lyricsRegion: "Letra",
  play: "Tocar",
  skipLyrics: "Pular a letra",
  pause: "Pausar",
  back10: "Voltar 10 segundos",
  forward10: "Avançar 10 segundos",
  fullscreen: "Tela cheia",
  showCover: "Mostrar capa",
  share: "Compartilhar",
  translate: "Tradução",
  volume: "Volume",
  position: "Posição na música",
  unsynced: "Letra sem sincronia",
  notFound: "Esse link não existe ou a música foi apagada.",
  audioError: "Não foi possível tocar este arquivo neste navegador.",
};

const SKIP_MS = 10_000;
const KEY_SEEK_MS = 5_000;
/** Fields where typed characters are input, so shortcuts stay off. Sliders and buttons are not among them. */
const TEXT_ENTRY =
  "input:not([type=range]):not([type=button]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=reset]), " +
  "select, textarea, [contenteditable]:not([contenteditable='false'])";

function readData(): PlayerData {
  const text = document.getElementById("letra-data")?.textContent;
  if (!text) return null;
  try {
    return JSON.parse(text) as PlayerData;
  } catch {
    return null;
  }
}

function glassButton(name: IconName, label: string, attrs: Record<string, string | boolean>): HTMLButtonElement {
  return el("button", { type: "button", class: "glass-btn", "aria-label": label, ...attrs }, iconEl(name));
}

/** Sets a slider's fill, `--fill-n`: 0 (empty) to 1 (full). */
function setFill(range: HTMLElement, ratio: number): void {
  range.style.setProperty("--fill-n", String(Math.round(ratio * 10000) / 10000));
}

/** iOS keeps volume at 1 whatever a page sets, so the slider is only offered where it works. */
function canSetVolume(): boolean {
  const probe = new Audio();
  probe.volume = 0.5;
  return probe.volume === 0.5;
}

function renderNotFound(app: HTMLElement): void {
  app.className = "not-found";
  app.append(
    navBar({ current: null }),
    el("div", { class: "not-found-tile" }, iconEl("music-note")),
    el("h1", { class: "not-found-text" }, COPY.notFound),
  );
}

function renderPlayer(app: HTMLElement, track: TrackDTO, translationEnabled: boolean, languages: Language[]): void {
  const id = encodeURIComponent(track.id);
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  app.className = "player";

  // --- the navigation bar: the wordmark and the tabs; translation, share and full screen on the right ---
  // One rule for offering translation: an engine, a language list, and lyrics there is something to translate in.
  const state = lyricsState(track);
  const canTranslate = translationEnabled && languages.length > 0 && state !== "none" && state !== "instrumental";
  const translate = glassButton("translate", COPY.translate, { "data-translate": true, "aria-pressed": "false", hidden: !canTranslate });
  const language = el("button", { type: "button", class: "text-pill", "data-language": true, hidden: true });
  const share = glassButton("share", COPY.share, { "data-share": true });
  // Never hidden: without the Fullscreen API (iPhone Safari) it toggles the cover view in the page.
  // A toggle: its name stays the same and aria-pressed carries the state.
  const canFullscreen = document.fullscreenEnabled;
  const fullscreen = glassButton("corners-out", canFullscreen ? COPY.fullscreen : COPY.showCover, { "data-fullscreen": true, "aria-pressed": "false" });
  const translateGroup = el("div", { class: "translate-group" }, translate, language);
  // No tab is current (a song is neither) and no heading: the song's title is the page's h1.
  const bar = navBar({ current: null, actions: [translateGroup, share, fullscreen] });
  const tabs = bar.querySelector<HTMLElement>(".nav-tabs")!;

  // --- stage: cover and lyrics column ---
  const coverImg = track.hasCover
    ? el("img", { src: `/media/${id}/cover.jpg`, alt: "", decoding: "async" })
    : null;
  if (coverImg) {
    const upgradePalette = () => {
      const extracted = extractPaletteFromImage(coverImg);
      track.palette = extracted;
      applyPalette(extracted);
    };
    if (coverImg.complete && coverImg.naturalWidth > 0) upgradePalette();
    else coverImg.addEventListener("load", upgradePalette, { once: true });
  }
  const cover = el(
    "div",
    { class: "cover", "data-cover": true },
    coverImg ?? el("div", { class: "cover-tile" }, iconEl("music-note")),
  );
  const lyrics = el("section", { class: "lyrics", "aria-label": COPY.lyricsRegion });
  // A link past the lyrics for screen readers and switch users: out of the Tab order, it moves focus to play.
  const skipLyrics =
    state === "synced" || state === "unsynced"
      ? el("a", { class: "skip-lyrics", href: "#play", tabindex: "-1", "data-skip-lyrics": true }, COPY.skipLyrics)
      : null;
  const stage = el("div", { class: "stage" }, cover, skipLyrics, lyrics);

  // --- bottom bar: title, transport over the progress bar, volume ---
  const now = el(
    "div",
    { class: "now" },
    el("h1", { class: "title" }, track.title),
    el("p", { class: "artist" }, track.artist),
    state === "unsynced" && el("p", { class: "badge" }, COPY.unsynced),
  );
  const progress = el("input", {
    class: "range progress",
    type: "range",
    min: 0,
    max: track.durationMs,
    step: "any",
    value: 0,
    "aria-label": COPY.position,
    "data-progress": true,
  });
  const elapsed = el("span", { class: "time", "data-elapsed": true }, formatTime(0));
  const remaining = el("span", { class: "time", "data-remaining": true }, formatRemaining(track.durationMs));
  const skip = (name: IconName, label: string, attr: string) =>
    el("button", { type: "button", class: "transport-btn skip", "aria-label": label, [attr]: true }, iconEl(name), el("span", { class: "skip-num", "aria-hidden": "true" }, "10"));
  const back = skip("skip-back-10", COPY.back10, "data-back");
  const forward = skip("skip-forward-10", COPY.forward10, "data-forward");
  const play = el("button", { type: "button", class: "transport-btn play", "aria-label": COPY.play, "data-play": true, id: "play" }, iconEl("play"));
  const volumeInput = el("input", { class: "range", type: "range", min: 0, max: 1, step: 0.01, value: 1, "aria-label": COPY.volume });
  const volumeIconHolder = el("span", { class: "volume-icon" }, iconEl("speaker"));
  const volume = canSetVolume() ? el("div", { class: "volume" }, volumeIconHolder, volumeInput) : null;
  const error = el("p", { class: "audio-error", role: "alert", hidden: true });
  const transport = el("div", { class: "transport" }, back, play, forward);
  const progressRow = el("div", { class: "progress-row" }, elapsed, progress, remaining);
  const bottomBar = el("footer", { class: "bottom-bar" }, now, el("div", { class: "transport-area" }, transport, progressRow), volume, error);

  const audio = el("audio", { preload: "metadata", src: `/media/${id}/audio` });
  app.append(bar, stage, bottomBar, audio);
  mountLayoutOrder({ bottomBar, cover, now, transport, progressRow });

  // --- behavior ---
  const player = createPlayer(audio, track);
  const showError = () => {
    error.textContent = COPY.audioError;
    error.hidden = false;
  };
  const playPause = () => {
    player.toggle().catch((err: unknown) => {
      if ((err as Error | null)?.name === "NotSupportedError") showError();
    });
  };
  const startPlaying = () => {
    if (audio.paused) playPause();
  };
  // Whether the listener has moved the song since the page opened (see ?t= below).
  let listenerSeeked = false;
  const seekTo = (ms: number) => {
    listenerSeeked = true;
    player.seek(ms);
  };
  const seekBy = (deltaMs: number) => seekTo(audio.currentTime * 1000 + deltaMs);

  // The view reports target changes while it is still being built, before saveLine exists.
  let saveLine: SaveLine | null = null;
  const view = createLyricsView(lyrics, track, {
    onSeek: (ms) => {
      seekTo(ms);
      startPlaying();
    },
    onSave: (index) => saveLine?.toggle(index),
    onTargetChange: () => saveLine?.sync(),
    reducedMotion,
  });
  saveLine = mountSaveLine(track, view, lyrics);
  mountToast(); // empty and in the page before the first message
  const translation = mountTranslation(track.id, view, languages, canTranslate, { button: translate, pill: language, column: lyrics });
  mountShareDialog(share, track, view);

  let dragging = false;
  let shownElapsed = "";
  let shownRemaining = "";
  const renderPosition = (ms: number, durationMs: number) => {
    const e = formatTime(ms);
    const r = formatRemaining(Math.max(0, durationMs - ms));
    if (e !== shownElapsed) {
      elapsed.textContent = shownElapsed = e;
      progress.setAttribute("aria-valuetext", `${e} de ${formatTime(durationMs)}`);
    }
    if (r !== shownRemaining) remaining.textContent = shownRemaining = r;
    progress.max = String(durationMs);
    progress.value = String(ms);
    setFill(progress, durationMs > 0 ? Math.min(1, ms / durationMs) : 0);
  };

  player.onTime((ms) => {
    const durationMs = durationOf(audio, track);
    view.update(ms, durationMs);
    if (!dragging) renderPosition(ms, durationMs);
  });

  // A link to a moment (?t=) opens the song paused there. Some browsers only keep the position
  // once the file's metadata has loaded, so it is set again then, once: unless the listener has
  // moved the song or started it meanwhile, or the position is already there.
  const start = startAt(location.search, track.durationMs);
  if (start !== null) {
    player.seek(start);
    audio.addEventListener(
      "loadedmetadata",
      () => {
        if (listenerSeeked || !audio.paused || Math.abs(audio.currentTime * 1000 - start) < 1) return;
        player.seek(start);
      },
      { once: true },
    );
  }

  audio.addEventListener("play", () => {
    play.setAttribute("aria-label", COPY.pause);
    swapIcon(play, "pause");
  });
  const showPaused = () => {
    play.setAttribute("aria-label", COPY.play);
    swapIcon(play, "play");
  };
  audio.addEventListener("pause", showPaused);
  audio.addEventListener("ended", showPaused);
  audio.addEventListener("error", showError);

  skipLyrics?.addEventListener("click", (e) => {
    e.preventDefault();
    play.focus();
  });
  play.addEventListener("click", playPause);
  back.addEventListener("click", () => seekBy(-SKIP_MS));
  forward.addEventListener("click", () => seekBy(SKIP_MS));

  // Dragging previews the position (bar grows, times follow); releasing seeks.
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    delete progress.dataset.dragging;
  };
  progress.addEventListener("pointerdown", () => {
    dragging = true;
    progress.dataset.dragging = "";
  });
  progress.addEventListener("input", () => {
    const ms = Number(progress.value);
    if (dragging) renderPosition(ms, durationOf(audio, track));
    else seekTo(ms);
  });
  progress.addEventListener("change", () => {
    seekTo(Number(progress.value));
    endDrag();
  });
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);
  progress.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    seekBy(e.key === "ArrowLeft" ? -KEY_SEEK_MS : KEY_SEEK_MS);
  });

  if (volume) {
    const syncVolume = () => setFill(volumeInput, audio.volume);
    volumeInput.addEventListener("input", () => {
      audio.volume = Number(volumeInput.value);
      swapIcon(volumeIconHolder, audio.volume === 0 ? "speaker-mute" : "speaker");
      syncVolume();
    });
    syncVolume();
  }

  /**
   * The cover view: a big cover alone on the stage, no lyrics, no translation and no tabs. The only
   * writer of data-lyrics ("off" when on); it follows full screen, or the button where
   * the browser has no Fullscreen API.
   */
  const setCoverView = (on: boolean) => {
    // Focus in what becomes inert would drop to <body>: it goes to the button that brings it back.
    const leaving = [lyrics, translateGroup, tabs];
    if (on && leaving.some((part) => part.contains(document.activeElement))) fullscreen.focus();
    if (!on && app.dataset.lyrics === "off") app.dataset.lyricsBack = ""; // the lyrics' return fade (styles.css), never on load
    flip(cover, () => {
      app.dataset.lyrics = on ? "off" : "on";
    });
    fullscreen.setAttribute("aria-pressed", String(on));
    swapIcon(fullscreen, on ? "corners-in" : "corners-out");
    for (const part of leaving) part.inert = on;
    if (skipLyrics) skipLyrics.hidden = on;
  };
  setCoverView(false);

  const toggleFullscreen = () => {
    if (!canFullscreen) return setCoverView(app.dataset.lyrics === "on");
    const request = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    request.catch(() => {});
  };
  fullscreen.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", () => setCoverView(document.fullscreenElement !== null));

  // Space play/pause, ←/→ 5 s, T translation, F full screen (the cover view), S save the verse
  // (save-line.ts). ↑/↓ are not shortcuts (on a verse they move between verses,
  // lyrics-view.ts). Text-entry fields keep every
  // key; a focused button keeps Space (and Enter) for itself; a focused slider keeps its
  // arrows (the progress bar maps them to ±5 s itself) but not Space, T or F.
  // None of them while a dialog (the share dialog) is open over the player. S also stays off
  // while a menu (the language menu) is showing, and in the cover view, where the lyrics are hidden.
  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector("dialog[open]")) return;
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest(TEXT_ENTRY)) return;
    const onButton = Boolean(target?.closest("button"));
    const onSlider = target instanceof HTMLInputElement && target.type === "range";
    switch (e.key) {
      case " ":
        if (onButton) return;
        e.preventDefault();
        if (!e.repeat) playPause();
        break;
      case "ArrowLeft":
      case "ArrowRight":
        if (onSlider) return;
        e.preventDefault();
        seekBy(e.key === "ArrowLeft" ? -KEY_SEEK_MS : KEY_SEEK_MS);
        break;
      case "t":
      case "T":
        if (!e.repeat && app.dataset.lyrics !== "off") translation.toggle();
        break;
      case "f":
      case "F":
        if (!e.repeat) toggleFullscreen();
        break;
      case "s":
      case "S":
        if (!e.repeat && app.dataset.lyrics !== "off" && !document.querySelector('[role="menu"]:not([hidden])')) saveLine.toggle();
        break;
    }
  });
}

const app = document.getElementById("app")!;
mountBackground(document.body);
enableActiveStates();
const data = readData();
if (data === null) renderNotFound(app);
else {
  // The history is a convenience: recording never throws, and it happens before audio starts.
  recordVisit({ id: data.track.id, title: data.track.title, artist: data.track.artist, hasCover: data.track.hasCover });
  renderPlayer(app, data.track, data.translationEnabled, data.languages);
}
