import "./saved.css";
import { getSummaries } from "../shared/api.ts";
import { el, iconEl } from "../shared/dom.ts";
import { isTrackId, latest, lineHref, mergeSummaries, readSaved, SAVED_KEY, savedLabel, writeSaved, type SavedLine } from "../shared/saved.ts";

const COPY = {
  heading: "Linhas salvas",
  unavailable: "Música indisponível",
};

/** How many cards the home shows. */
const CARDS = 3;

function cover(line: SavedLine, gone: boolean): HTMLElement {
  if (line.hasCover && !gone) {
    const img = el("img", { src: `/media/${encodeURIComponent(line.trackId)}/cover.jpg`, alt: "", loading: "lazy", decoding: "async" });
    return el("span", { class: "saved-cover" }, img);
  }
  return el("span", { class: "saved-cover is-tile" }, iconEl("music-note"));
}

function card(line: SavedLine, gone: boolean, now: number): HTMLElement {
  const at = new Date(line.at);
  const valid = !Number.isNaN(at.getTime());
  const when = el(
    "time",
    {
      class: "saved-card-when",
      datetime: valid ? at.toISOString() : null,
      title: valid ? at.toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "short" }) : null,
    },
    savedLabel(line.at, now, "card"),
  );
  const who = el("span", { class: "saved-card-who" }, el("b", {}, line.title), el("i", {}, gone ? COPY.unavailable : line.artist));
  const children = [
    el("span", { class: "saved-card-q", lang: line.lang || null }, line.text),
    el("span", { class: "saved-card-by" }, cover(line, gone), who, when),
  ];
  return gone
    ? el("div", { class: "saved-card", "data-saved-card": true }, ...children)
    : el("a", { class: "saved-card", "data-saved-card": true, "data-track": line.trackId, "data-index": line.index, href: lineHref(line) }, ...children);
}

/**
 * The latest saved lines for the home: drawn from this browser's store at once, then refreshed
 * with the server's summaries of those songs. `load` runs again when the page comes back from the
 * back/forward cache; another tab's change to the store loads it too, until `signal` aborts.
 */
export function createSavedSection(signal: AbortSignal): { element: HTMLElement; load(): void } {
  let generation = 0; // bumped by every load: only the latest load's summaries land
  let goneIds = new Set<string>(); // songs the server no longer has, for this visit only

  const cardsEl = el("div", { class: "saved-cards" });
  const element = el(
    "section",
    { class: "saved-section", "data-saved-section": true },
    // The way to all of them is the bar's "Linhas salvas" tab, not a link here.
    el("div", { class: "home-head-row" }, el("h2", { class: "home-heading" }, COPY.heading)),
    cardsEl,
  );
  element.hidden = true;

  let lines: SavedLine[] = [];
  const draw = () => {
    // Keyboard focus on a card stays on that line's card when it is still shown.
    const active = document.activeElement;
    const focused = active instanceof HTMLElement && cardsEl.contains(active) ? active.closest<HTMLElement>("[data-saved-card]") : null;
    element.hidden = lines.length === 0;
    const now = Date.now();
    cardsEl.replaceChildren(...latest(lines, CARDS).map((l) => card(l, goneIds.has(l.trackId), now)));
    if (focused) {
      [...cardsEl.querySelectorAll<HTMLElement>("a[data-saved-card]")]
        .find((c) => c.dataset.track === focused.dataset.track && c.dataset.index === focused.dataset.index)
        ?.focus();
    }
  };

  const load = () => {
    const asked = ++generation;
    lines = readSaved();
    draw();
    const ids = [...new Set(latest(lines, CARDS).map((l) => l.trackId))];
    // An id the server would refuse is a song it does not have; only the others are asked about.
    const asking = ids.filter(isTrackId);
    const refused = ids.filter((id) => !isTrackId(id));
    if (refused.length > 0) {
      goneIds = new Set(refused);
      draw();
    }
    if (asking.length === 0) return;
    getSummaries(asking).then(
      (summaries) => {
        if (asked !== generation || signal.aborted || !element.isConnected) return;
        const merged = mergeSummaries(readSaved(), summaries);
        // A song outside the request is not "gone"; only the asked ones count.
        goneIds = new Set([...merged.gone.filter((id) => asking.includes(id)), ...refused]);
        if (merged.changed) writeSaved(merged.list);
        lines = merged.list;
        draw();
      },
      () => {}, // the stored lines stay, with no error message
    );
  };

  window.addEventListener(
    "storage",
    (e) => {
      // Under the owner view the home is out of the page: nothing to draw.
      if ((e.key === null || e.key === SAVED_KEY) && element.isConnected) load();
    },
    { signal },
  );
  return { element, load };
}
