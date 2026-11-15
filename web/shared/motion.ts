import { iconEl } from "./dom.ts";
import type { IconName } from "./icons.ts";

/** The trimmed computed value of a custom property on :root, e.g. token("--ease-move"). */
export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** A duration token in milliseconds: "400ms" gives 400, ".2s" gives 200. */
export function tokenMs(name: string): number {
  const raw = token(name);
  const value = parseFloat(raw);
  return raw.endsWith("ms") ? value : value * 1000;
}

/**
 * Cross-fades the icon in a button: the new one fades in while the old one fades out, then the old
 * one is removed. Showing the name already shown does nothing; a swap that interrupts another
 * drops the icon still leaving first, so the button never holds more than two icons.
 */
export function swapIcon(button: HTMLElement, name: IconName): void {
  button.querySelectorAll(".icon.is-leaving").forEach((n) => n.remove());
  const current = button.querySelector<HTMLElement>(".icon");
  if (current?.dataset.icon === name) return;
  const next = iconEl(name);
  if (current) {
    next.classList.add("is-entering");
    button.append(next);
    void next.offsetWidth; // commit the start state so removing the class starts the transition now
    next.classList.remove("is-entering");
    current.classList.add("is-leaving");
    const leaving = current;
    const done = () => leaving.remove();
    leaving.addEventListener("transitionend", done, { once: true });
    setTimeout(done, tokenMs("--dur-exit") + 50);
  } else {
    button.append(next);
  }
}

const flips = new WeakMap<HTMLElement, Animation>();

/**
 * FLIP: measures `el`, cancels any flip still running on it, runs `change` (which moves or
 * resizes it in the layout), measures again and plays the difference on `transform`, from the
 * old box to the new one. Cancelling first means a second change starts from where the element
 * is, not from where the first one was heading. With reduced motion, when either box is empty or
 * when the box did not move, it only runs `change`. `duration` and `easing` are token names.
 */
export function flip(el: HTMLElement, change: () => void, o: { duration?: string; easing?: string } = {}): void {
  const first = el.getBoundingClientRect();
  flips.get(el)?.cancel();
  flips.delete(el);
  change();
  const last = el.getBoundingClientRect();
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (first.width === 0 || first.height === 0 || last.width === 0 || last.height === 0) return;
  const dx = first.left - last.left;
  const dy = first.top - last.top;
  const sx = first.width / last.width;
  const sy = first.height / last.height;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.001 && Math.abs(sy - 1) < 0.001) return;
  const duration = tokenMs(o.duration ?? "--dur-move");
  const easing = token(o.easing ?? "--ease-move");
  const animation = el.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, transformOrigin: "top left" },
      { transform: "none", transformOrigin: "top left" },
    ],
    { duration, easing },
  );
  flips.set(el, animation);
  const done = () => {
    if (flips.get(el) === animation) flips.delete(el);
  };
  animation.addEventListener("finish", done);
  animation.addEventListener("cancel", done);
}

/** iOS Safari applies :active only once the document has a touchstart listener. */
export function enableActiveStates(): void {
  document.addEventListener("touchstart", () => {}, { passive: true });
}
