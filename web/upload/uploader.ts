import { NOT_AUDIO, tooLarge } from "../../shared/copy.ts";
import { ALLOWED_EXTS } from "../../shared/formats.ts";
import type { TrackDTO } from "../../shared/types.ts";
import { upload } from "../shared/api.ts";
import { el, iconEl } from "../shared/dom.ts";
import { messageOf } from "./dialogs.ts";

export { upload };

// Pure helpers first: this module is importable in node, so DOM access stays inside functions.

const MB = 1048576;

const COPY = {
  drop: "Solte uma música aqui",
  choose: "Escolher arquivo",
  sending: (pct: number) => `Enviando… ${pct}%`,
  searching: "Procurando a letra…",
};

const extOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
};

/** The spec §8 message for a file the server would refuse (type first, then size), or null. */
export function validateFile(f: { name: string; size: number }, maxBytes: number): string | null {
  if (!(ALLOWED_EXTS as readonly string[]).includes(extOf(f.name))) return NOT_AUDIO;
  if (f.size > maxBytes) return tooLarge(f.size, maxBytes);
  return null;
}

/** "MP3, M4A, FLAC, OGG ou WAV, até 100 MB", from the shared format list and the server's limit. */
export function uploadHint(maxBytes: number): string {
  const names = ALLOWED_EXTS.map((e) => e.toUpperCase());
  const list = `${names.slice(0, -1).join(", ")} ou ${names.at(-1)}`;
  const mb = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(maxBytes / MB);
  return `${list}, até ${mb} MB`;
}

// --- UI -----------------------------------------------------------------------------

export type Uploader = {
  element: HTMLElement;
  /** Removes the window listeners (on sign-out). */
  dispose(): void;
};

type Options = {
  maxBytes: number;
  /** `hadFocus`: keyboard focus was in the panel, so the result should take it. */
  uploaded(track: TrackDTO, hadFocus: boolean): void;
  /** A request failed in a way the page handles (signed out). Returns true when it did. */
  handled(err: unknown): boolean;
};

const isFileDrag = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
const modalOpen = () => document.querySelector("dialog[open]") !== null;

/**
 * The drop panel: idle (heading, formats, "Escolher arquivo"), or uploading (file name,
 * bar, percent, then "Procurando a letra…"). The whole window takes drops; while a file
 * is dragged over it the panel gets `data-dragging`.
 */
export function mountUploader({ maxBytes, uploaded, handled }: Options): Uploader {
  const input = el("input", {
    type: "file",
    accept: ALLOWED_EXTS.map((e) => `.${e}`).join(","),
    hidden: true,
    "data-file-input": true,
  });
  const choose = el("button", { type: "button", class: "white-pill is-large" }, COPY.choose);
  const error = el("p", { class: "error", role: "alert", hidden: true });
  const idle = el(
    "div",
    { class: "drop-idle" },
    el("span", { class: "drop-icon" }, iconEl("upload")),
    el("h2", { class: "drop-title", id: "drop-title" }, COPY.drop),
    el("p", { class: "drop-hint" }, uploadHint(maxBytes)),
    error,
    el("div", { class: "drop-actions" }, choose),
    input,
  );

  const fileName = el("p", { class: "drop-file", id: "drop-file" });
  const fill = el("span", { class: "bar-fill" });
  const bar = el(
    "div",
    { class: "bar", role: "progressbar", tabindex: -1, "aria-labelledby": "drop-file", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": 0 },
    fill,
  );
  const status = el("p", { class: "drop-status", "data-upload-status": true });
  const progress = el("div", { class: "drop-progress", hidden: true }, fileName, bar, status);

  const panel = el("section", { class: "panel drop", "aria-labelledby": "drop-title", "data-drop": true }, idle, progress);

  let busy = false;

  const setDragging = (on: boolean) => {
    if (on) panel.dataset.dragging = "";
    else delete panel.dataset.dragging;
  };

  const showProgress = (name: string, pct: number) => {
    const text = pct < 100 ? COPY.sending(pct) : COPY.searching;
    fileName.textContent = name;
    status.textContent = text;
    bar.setAttribute("aria-valuenow", String(pct));
    bar.setAttribute("aria-valuetext", text);
    fill.style.setProperty("--fill", `${pct}%`);
  };

  const showIdle = (message: string | null) => {
    error.textContent = message ?? "";
    error.hidden = message === null;
    idle.hidden = false;
    progress.hidden = true;
    panel.dataset.state = message === null ? "idle" : "error";
  };

  async function start(file: File): Promise<void> {
    if (busy) return;
    const invalid = validateFile(file, maxBytes);
    if (invalid !== null) {
      showIdle(invalid);
      return;
    }
    busy = true;
    const hadFocus = panel.contains(document.activeElement);
    showProgress(file.name, 0);
    idle.hidden = true;
    progress.hidden = false;
    panel.dataset.state = "uploading";
    if (hadFocus) bar.focus(); // the button it was on just went away
    try {
      const track = await upload(file, (pct) => showProgress(file.name, pct));
      showIdle(null);
      uploaded(track, hadFocus);
    } catch (err) {
      if (handled(err)) return; // signed out: the page shows the sign-in instead
      showIdle(messageOf(err));
      if (hadFocus) choose.focus();
    } finally {
      busy = false;
    }
  }

  choose.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.value = ""; // so picking the same file again still fires
    if (file) void start(file);
  });

  // Window-wide drop. The depth counter pairs enter/leave across child elements.
  let depth = 0;
  const onEnter = (e: DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    if (modalOpen()) return;
    depth += 1;
    if (!busy) setDragging(true);
  };
  const onOver = (e: DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault(); // without this the browser opens the file instead of dropping it here
    if (e.dataTransfer) e.dataTransfer.dropEffect = busy || modalOpen() ? "none" : "copy";
  };
  const onLeave = (e: DragEvent) => {
    if (!isFileDrag(e) || depth === 0) return;
    depth -= 1;
    if (depth === 0) setDragging(false);
  };
  const onDrop = (e: DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    depth = 0;
    setDragging(false);
    if (modalOpen()) return; // the lyrics dialog handles its own drops
    const file = e.dataTransfer?.files[0];
    if (file) void start(file);
  };
  const onEnd = () => {
    depth = 0;
    setDragging(false);
  };
  window.addEventListener("dragenter", onEnter);
  window.addEventListener("dragover", onOver);
  window.addEventListener("dragleave", onLeave);
  window.addEventListener("drop", onDrop);
  window.addEventListener("dragend", onEnd);

  showIdle(null);

  return {
    element: panel,
    dispose() {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", onEnd);
    },
  };
}
