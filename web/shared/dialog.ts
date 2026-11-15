import { tokenMs } from "./motion.ts";

const pendingRemoval = new WeakMap<HTMLDialogElement, () => void>();

/**
 * Opens a modal <dialog> and resolves with its return value once it closes (Escape
 * included). Focus goes back to whatever had it when the dialog opened, or to
 * `fallback()` when that element is gone. Focus and the promise settle at once; the dialog
 * stays in the page while its exit transition plays and is then removed, unless it was
 * opened again meanwhile.
 */
export function openDialog(dialog: HTMLDialogElement, initial: HTMLElement, fallback?: () => HTMLElement | null): Promise<string> {
  pendingRemoval.get(dialog)?.(); // an exit still running for this element ends here
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.body.append(dialog);
  dialog.showModal();
  initial.focus();
  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => {
        removeAfterExit(dialog);
        const target = opener?.isConnected && opener.offsetParent !== null ? opener : fallback?.();
        target?.focus();
        resolve(dialog.returnValue);
      },
      { once: true },
    );
  });
}

/**
 * Removes a closed dialog once its exit transition ends (or a little after it should have). At
 * once under reduced motion, and where `overlay` is not supported: there the stylesheets have no
 * exit, as the closed dialog would play it out of the top layer, in the page's flow.
 */
function removeAfterExit(dialog: HTMLDialogElement): void {
  const remove = () => {
    cancel();
    if (!dialog.open) dialog.remove();
  };
  const onEnd = (e: Event) => {
    if (e.target === dialog) remove(); // not a transition of something inside it
  };
  let timer = 0;
  const cancel = () => {
    window.clearTimeout(timer);
    dialog.removeEventListener("transitionend", onEnd);
    pendingRemoval.delete(dialog);
  };
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || !CSS.supports("overlay", "auto")) {
    remove();
    return;
  }
  dialog.addEventListener("transitionend", onEnd);
  timer = window.setTimeout(remove, tokenMs("--dur-exit") + 50);
  pendingRemoval.set(dialog, cancel);
}
