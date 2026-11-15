import "./background.css";
import { el } from "./dom.ts";

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return Number.POSITIVE_INFINITY;
  const n = Number.parseInt(m[1]!, 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/**
 * Mounts the cover-color field behind the page: four soft radial gradients
 * (--mesh-1..4, set per track by the server) over the darkest of them, on a
 * blurred, oversized layer that drifts on a 60 s CSS loop. The drift pauses while
 * the tab is hidden; reduced motion turns it off in CSS.
 */
export function mountBackground(parent: HTMLElement): void {
  const root = document.documentElement;
  const styles = getComputedStyle(root);
  const mesh = [1, 2, 3, 4].map((i) => styles.getPropertyValue(`--mesh-${i}`).trim());
  const darkest = mesh.reduce((a, b) => (luminance(b) < luminance(a) ? b : a));
  if (luminance(darkest) !== Number.POSITIVE_INFINITY) root.style.setProperty("--mesh-dark", darkest);

  const bg = el("div", { class: "bg", "aria-hidden": "true" }, el("div", { class: "bg-field" }));
  parent.prepend(bg);

  const sync = () => bg.classList.toggle("is-paused", document.hidden);
  document.addEventListener("visibilitychange", sync);
  sync();
}
