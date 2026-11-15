import { icon, type IconName } from "./icons.ts";

type Attrs = Record<string, string | number | boolean | null | undefined>;
type Child = Node | string | null | undefined | false;

/**
 * Creates an element. String children become text nodes (never parsed as HTML), so
 * track and lyrics text is always safe here. `false`, `null` and `undefined`
 * attributes are skipped; `true` sets an empty attribute.
 */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(name, value === true ? "" : String(value));
  }
  for (const child of children) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

/** A span holding one of our own inline SVG icons (never user data). */
export function iconEl(name: IconName, className = "icon"): HTMLSpanElement {
  const span = el("span", { class: className, "aria-hidden": "true", "data-icon": name });
  span.innerHTML = icon(name);
  return span;
}
