import type { TrackSummary } from "../../shared/types.ts";
import { getSummaries } from "../shared/api.ts";
import { el, iconEl } from "../shared/dom.ts";
import { navBar } from "../shared/nav.ts";
import { clearRecents, mergeSummaries, readRecents, saveRecents, type Recent } from "../shared/recents.ts";
import { toast } from "../shared/toast.ts";
import { createSavedSection } from "./saved-section.ts";
import { openSignIn, type SignedIn } from "./login.ts";

const COPY = {
  signIn: "Entrar",
  heading: "Ouvidas recentemente",
  clear: "Limpar histórico",
  cleared: "Histórico apagado",
  empty: "As músicas que você abrir por um link aparecem aqui.",
};

const mesh = (summary: TrackSummary | undefined): string | null => summary?.palette.mesh[0] ?? null;

/**
 * The id of the song the listener came from, when the previous page was its player (same origin,
 * /t/<id>). The Navigation API says it for every kind of navigation. Without it only
 * document.referrer does, and not on a back/forward traversal: that keeps the referrer of the
 * entry's first load, which may be another song, so it is not used then.
 */
function cameFrom(): string | null {
  try {
    const nav = (window as unknown as { navigation?: { activation?: { from?: { url?: string } | null } } }).navigation;
    let from = nav?.activation?.from?.url;
    if (from === undefined) {
      const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (entry?.type !== "back_forward") from = document.referrer;
    }
    if (!from) return null;
    const url = new URL(from, location.href);
    const id = url.origin === location.origin ? /^\/t\/([^/]+)\/?$/.exec(url.pathname)?.[1] : undefined;
    return id === undefined ? null : decodeURIComponent(id);
  } catch {
    return null; // a malformed escape in the path
  }
}

/** Names the cover of one tile (or none) for the view transition: only one element may carry a name. */
function nameCover(grid: HTMLElement, id: string | null): void {
  for (const t of grid.querySelectorAll<HTMLElement>("[data-recent]")) {
    const cover = t.querySelector<HTMLElement>(".home-cover");
    if (cover) cover.style.viewTransitionName = t.dataset.id === id ? "cover" : "";
  }
}

/**
 * Settles when the page's reveal transition is over (at once when there is none: no
 * `pagereveal`, reduced motion, no transition). Redrawing the tiles replaces the one that carries
 * the cover's name, which ends a running transition on the spot; the summaries wait for this.
 * This module is render-blocking, so the listener is in place before the first reveal.
 */
let revealed: Promise<unknown> = Promise.resolve();
addEventListener("pagereveal", (e) => {
  const vt = (e as unknown as { viewTransition?: { finished: Promise<void> } | null }).viewTransition;
  if (vt) revealed = vt.finished.catch(() => {});
});

/** Removes the previous render's pageshow listener: only the latest home listens. */
let unmount: AbortController | null = null;

function tile(r: Recent, palettes: Map<string, [string, string]>): HTMLAnchorElement {
  const colors = palettes.get(r.id);
  const art = r.hasCover
    ? el("img", { src: `/media/${encodeURIComponent(r.id)}/cover.jpg`, alt: "", loading: "lazy", decoding: "async" })
    : el("div", { class: "home-tile-art" }, iconEl("music-note"));
  if (!r.hasCover && colors) art.style.background = `linear-gradient(135deg, ${colors[0]}, ${colors[1]})`;
  return el(
    "a",
    { class: "home-tile", href: `/t/${encodeURIComponent(r.id)}`, "data-recent": true, "data-id": r.id, "aria-label": `${r.title} — ${r.artist}` },
    el("div", { class: "home-cover" }, art),
    el("span", { class: "home-title" }, r.title),
    el("span", { class: "home-artist" }, r.artist),
  );
}

/**
 * The listener view (spec §7): the songs this browser opened by a link, newest first, from
 * localStorage at once and refreshed from the server's summaries. Nothing here needs a session.
 * Back from a song can restore this page from the back/forward cache as it was before the
 * visit: it then loads again.
 */
export function renderHome(app: HTMLElement, opts: { onSignedIn: SignedIn }): void {
  let list: Recent[] = [];
  const palettes = new Map<string, [string, string]>();
  let generation = 0; // bumped by every load and by clearing: only the latest load's summaries land
  unmount?.abort();
  unmount = new AbortController();
  const { signal } = unmount;
  const savedSection = createSavedSection(signal);

  const signIn = el("button", { type: "button", class: "glass-pill", "data-sign-in": true }, COPY.signIn);
  signIn.addEventListener("click", () => openSignIn(opts.onSignedIn));
  const heading = el("h2", { class: "home-heading", tabindex: "-1" }, COPY.heading);
  const clear = el("button", { type: "button", class: "home-clear", "data-clear-recents": true }, COPY.clear);
  const headRow = el("div", { class: "home-head-row" }, heading);
  const grid = el("div", { class: "home-grid", "data-recents": true });
  const empty = el("div", { class: "home-empty", "data-recents-empty": true }, iconEl("music-note"), el("p", {}, COPY.empty));

  let named: string | null = null; // the tile that carries the transition name; a click overrides the way we came
  const draw = () => {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>("[data-recent]")?.dataset.id : undefined;
    if (list.length === 0) clear.remove();
    else if (!clear.isConnected) headRow.append(clear);
    empty.hidden = list.length > 0;
    grid.hidden = list.length === 0;
    grid.replaceChildren(...list.map((r) => tile(r, palettes)));
    nameCover(grid, named ?? cameFrom());
    if (focused) grid.querySelector<HTMLElement>(`[data-id="${CSS.escape(focused)}"]`)?.focus();
  };

  grid.addEventListener("click", (e) => {
    const t = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-recent]") : null;
    if (!t) return;
    named = t.dataset.id ?? null;
    nameCover(grid, named);
  });
  // A saved card opens a player too: the tile of its song carries the name, else none does.
  savedSection.element.addEventListener("click", (e) => {
    const card = e.target instanceof Element ? e.target.closest<HTMLElement>("a[data-saved-card]") : null;
    if (!card) return;
    named = card.dataset.track ?? null;
    nameCover(grid, named);
  });

  clear.addEventListener("click", () => {
    generation++; // a summary answer still in flight must not bring the list back
    clearRecents();
    list = [];
    draw();
    heading.focus();
    toast(COPY.cleared);
  });

  app.className = "upload home";
  app.replaceChildren(
    navBar({ current: "home", heading: true, actions: [signIn] }),
    el(
      "div",
      { class: "home-page", "data-home-view": true },
      savedSection.element,
      headRow,
      grid,
      empty,
    ),
  );

  /** Draws the stored list at once, then refreshes it from the server's summaries. */
  const load = () => {
    savedSection.load();
    const asked = ++generation;
    list = readRecents();
    draw();
    if (list.length === 0) return;
    getSummaries(list.map((r) => r.id)).then(
      async (summaries) => {
        await revealed;
        if (asked !== generation || !app.contains(grid)) return;
        for (const s of summaries) {
          const [a, b] = [mesh(s), s.palette.mesh[1]];
          if (a) palettes.set(s.id, [a, b ?? a]);
        }
        list = mergeSummaries(list, summaries);
        saveRecents(list);
        draw();
      },
      () => {}, // the stored list stays, with no error message
    );
  };

  window.addEventListener(
    "pageshow",
    (e) => {
      if (e.persisted && app.contains(grid)) load();
    },
    { signal },
  );
  load();
}
