import type { Lyrics, TrackDTO } from "../../shared/types.ts";
import { ApiClientError, saveLyricsText } from "../shared/api.ts";
import { openDialog } from "../shared/dialog.ts";
import { el, iconEl } from "../shared/dom.ts";
import { toast } from "../shared/toast.ts";

export { copyLink, copyText, mountToast, toast } from "../shared/toast.ts";

/** What the page's parts tell each other. */
export type Hooks = {
  /** A track was edited (title, artist, lyrics): every view of it redraws. */
  changed(track: TrackDTO): void;
  /** A track was deleted. */
  removed(id: string): void;
  /** If `err` means the session ended (401), the page switches to the sign-in and this returns true. */
  signedOut(err: unknown): boolean;
};

// Pure helpers first: this module is importable in node, so DOM access stays inside functions.

const COPY = {
  remove: "Apagar",
  cancel: "Cancelar",
  removeQuestion: (title: string) => `Apagar “${title}”? O link para de funcionar.`,
  saveLyrics: "Salvar letra",
  lyricsSaved: "Letra salva",
  sendLrc: "Enviar .lrc",
};

const two = (n: number) => String(n).padStart(2, "0");

/** LRC timestamp for a line start, e.g. 2500 ms -> "[00:02.50]". */
function stamp(ms: number): string {
  const cs = Math.max(0, Math.round(ms / 10));
  return `[${two(Math.floor(cs / 6000))}:${two(Math.floor(cs / 100) % 60)}.${two(cs % 100)}]`;
}

/** The lyrics as the owner would type them: LRC when synced, plain lines otherwise, "" for none. */
export function lyricsToText(lyrics: Lyrics | null): string {
  if (!lyrics || lyrics.instrumental) return "";
  return lyrics.lines.map((l) => (lyrics.synced && l.t !== null ? `${stamp(l.t)}${l.text}` : l.text)).join("\n");
}

/** The message to show for a failed request. */
export const messageOf = (err: unknown): string =>
  err instanceof ApiClientError ? err.message : "Algo deu errado. Tente de novo.";

/** Asks before deleting; true when the owner chose "Apagar". */
export function confirmDelete(title: string, fallback?: () => HTMLElement | null): Promise<boolean> {
  const id = "delete-question";
  const cancel = el("button", { type: "submit", value: "cancel", class: "alert-btn" }, COPY.cancel);
  const remove = el("button", { type: "submit", value: "delete", class: "alert-btn is-danger" }, COPY.remove);
  const dialog = el(
    "dialog",
    { class: "dialog alert", "aria-labelledby": id },
    el("form", { method: "dialog", class: "alert-body" }, el("p", { class: "alert-text", id }, COPY.removeQuestion(title)), el("div", { class: "alert-actions" }, cancel, remove)),
  );
  // A click on the backdrop (outside the box) is a cancel.
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close("cancel");
  });
  return openDialog(dialog, cancel, fallback).then((value) => value === "delete");
}

/**
 * The lyrics editor: a glass textarea taking LRC or plain text, filled from a .lrc file
 * on request or on drop. Resolves with the saved track, or null when cancelled.
 */
export function editLyrics(track: TrackDTO, heading: string, fallback?: () => HTMLElement | null): Promise<TrackDTO | null> {
  const headingId = "lyrics-dialog-title";
  const text = el("textarea", { class: "field lyrics-field", "aria-labelledby": headingId, spellcheck: "false", rows: 12 });
  text.value = lyricsToText(track.lyrics);
  const error = el("p", { class: "error", role: "alert", hidden: true });
  const fileInput = el("input", { type: "file", accept: ".lrc,.txt,text/plain", hidden: true, "data-dialog-lrc-input": true });
  const sendLrc = el("button", { type: "button", class: "glass-pill" }, iconEl("upload"), COPY.sendLrc);
  const cancel = el("button", { type: "button", class: "glass-pill" }, COPY.cancel);
  const save = el("button", { type: "submit", class: "white-pill" }, COPY.saveLyrics);
  const form = el(
    "form",
    { class: "dialog-body" },
    el("h2", { class: "dialog-title", id: headingId }, heading),
    text,
    error,
    el("div", { class: "dialog-actions" }, sendLrc, fileInput, el("span", { class: "spacer" }), cancel, save),
  );
  const dialog = el("dialog", { class: "dialog sheet", "aria-labelledby": headingId }, form);
  let saved: TrackDTO | null = null;

  const showError = (message: string) => {
    error.textContent = message;
    error.hidden = false;
  };
  const load = async (file: File | undefined) => {
    if (!file) return;
    text.value = await file.text();
    error.hidden = true;
    text.focus();
  };

  sendLrc.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    void load(fileInput.files?.[0]);
    fileInput.value = "";
  });
  text.addEventListener("dragover", (e) => e.preventDefault());
  text.addEventListener("drop", (e) => {
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    void load(e.dataTransfer.files[0]);
  });
  cancel.addEventListener("click", () => dialog.close());
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    save.disabled = true;
    try {
      saved = await saveLyricsText(track.id, text.value);
      dialog.close();
      toast(COPY.lyricsSaved);
    } catch (err) {
      showError(messageOf(err));
      text.focus();
    } finally {
      save.disabled = false;
    }
  });

  return openDialog(dialog, text, fallback).then(() => saved);
}
