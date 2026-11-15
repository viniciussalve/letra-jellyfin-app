import "./nav.css";
import { el } from "./dom.ts";

/** The tab of the screen in view; null where neither is (a song). */
export type NavCurrent = "home" | "saved" | null;

const COPY = {
  wordmark: "letra",
  label: "Principal",
  home: "Início",
  saved: "Linhas salvas",
};

const TABS = [
  { id: "home", href: "/", label: COPY.home },
  { id: "saved", href: "/salvas", label: COPY.saved },
] as const;

/**
 * The app's one navigation bar (spec §3): the wordmark, the two tabs, then this screen's actions.
 * The wordmark is text, never a link; it is the page's h1 when `heading` is set, else a span (for
 * pages that have their own h1). The tab of the screen in view carries aria-current="page".
 */
export function navBar(o: { current: NavCurrent; actions?: Node[]; heading?: boolean }): HTMLElement {
  const wordmark = el(o.heading ? "h1" : "span", { class: "nav-wordmark" }, COPY.wordmark);
  const tabs = TABS.map((t) =>
    el("a", { class: "nav-tab", "data-tab": t.id, href: t.href, "aria-current": o.current === t.id ? "page" : null }, t.label),
  );
  return el(
    "header",
    { class: "nav-bar", "data-nav": true },
    wordmark,
    el("nav", { class: "nav-tabs", "aria-label": COPY.label }, ...tabs),
    el("div", { class: "nav-actions" }, ...(o.actions ?? [])),
  );
}
