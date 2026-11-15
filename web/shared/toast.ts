import { el } from "./dom.ts";

const COPY = {
  copied: "Link copiado",
  manual: "Copie o link",
};

const TOAST_MS = 2000;
const MANUAL_MS = 10_000;

let toastEl: HTMLDivElement | null = null;
let toastTimer = 0;
/** Removes the hover and focus listeners of the toast showing. */
let holds: AbortController | null = null;

/** Puts the (empty) live region in the page early: screen readers skip regions that arrive already filled. */
export function mountToast(): HTMLDivElement {
  if (!toastEl) {
    toastEl = el("div", { class: "toast", role: "status", "aria-live": "polite", "data-toast": true });
    document.body.append(toastEl);
  }
  return toastEl;
}

export type ToastOptions = {
  ms?: number;
  action?: { label: string; run(): void };
  /**
   * With an action: no countdown until focus has been inside the toast and left (then the usual
   * one runs). Until then it stays until its action is used or another toast replaces it.
   */
  sticky?: boolean;
  /** Called once when this toast is hidden or replaced by another. */
  onHide?(): void;
};

/** True while the pointer is over the toast or focus is inside it. */
const held = (node: HTMLElement) => node.matches(":hover") || node.contains(document.activeElement);

/** The onHide of the toast showing. */
let hidden: (() => void) | null = null;
/** Counts the toasts shown, so a toast's own hide function does nothing once another replaced it. */
let shown = 0;

function hide(node: HTMLElement): void {
  window.clearTimeout(toastTimer);
  node.classList.remove("is-shown");
  const done = hidden;
  hidden = null;
  done?.();
}

/**
 * One glass toast for the page, in a polite live region. A number is the duration in ms. With an
 * action the toast gets a button after the content; a click runs it and hides the toast at once,
 * and the countdown waits while the pointer or focus is on the toast, then starts again whole.
 * A new toast replaces the content and the action of the one showing. Returns a function that
 * hides this toast, if it is still the one showing.
 */
export function toast(content: string | Node, options: number | ToastOptions = {}): () => void {
  const { ms = TOAST_MS, action, sticky = false, onHide } = typeof options === "number" ? { ms: options } : options;
  const node = mountToast();
  window.clearTimeout(toastTimer);
  const replaced = hidden;
  hidden = onHide ?? null;
  replaced?.();
  const id = ++shown;
  node.classList.toggle("has-action", Boolean(action));
  node.replaceChildren(content);
  if (action) {
    const button = el("button", { type: "button", class: "toast-action", "data-toast-action": true }, action.label);
    button.addEventListener("click", () => {
      if (!node.classList.contains("is-shown")) return; // the toast is leaving: its action is gone
      hide(node);
      action.run();
    });
    node.append(button);
  }
  node.classList.add("is-shown");
  const start = () => {
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => hide(node), ms);
  };
  let waiting = Boolean(action) && sticky; // no countdown until focus has been inside and left
  const resume = () => {
    if (!waiting && !held(node)) start();
  };
  holds?.abort();
  holds = null;
  if (action) {
    holds = new AbortController();
    const { signal } = holds;
    const stop = () => window.clearTimeout(toastTimer);
    node.addEventListener("mouseenter", stop, { signal });
    node.addEventListener("mouseleave", resume, { signal });
    node.addEventListener("focusin", stop, { signal });
    node.addEventListener(
      "focusout",
      (e) => {
        if (e.relatedTarget instanceof Node && node.contains(e.relatedTarget)) return;
        waiting = false;
        resume();
      },
      { signal },
    );
  }
  if (action) resume();
  else start();
  return () => {
    if (id === shown && node.classList.contains("is-shown")) hide(node);
  };
}

/** Copies text; false when the clipboard is blocked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Copies a share link and confirms in the toast; if the clipboard is blocked, shows the link selected to copy by hand. */
export async function copyLink(url: string): Promise<void> {
  if (await copyText(url)) {
    toast(COPY.copied);
    return;
  }
  const input = el("input", { class: "toast-input", type: "text", readonly: true, value: url, "aria-label": COPY.manual });
  toast(input, MANUAL_MS);
  input.focus();
  input.select();
}
