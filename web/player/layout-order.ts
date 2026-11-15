/**
 * Below 1024 px the player stacks its controls (styles.css): the title and artist in a
 * header row beside the small cover, under the navigation bar, and the progress bar above
 * the transport. CSS can draw them there, but focus and screen readers follow the DOM, so
 * this moves the same nodes (never copies) to match what is drawn, and back on wide screens.
 * The bar's actions (translation, share, full screen) stay in the bar on every width.
 */

/** The stacked layout's media query in styles.css. */
const STACKED = "(max-width: 1023px)";

export type LayoutParts = {
  /** The player bar; on wide screens it starts with the title and artist. */
  bottomBar: HTMLElement;
  /** The cover; when stacked the title and artist follow it, so they are read before the lyrics. */
  cover: HTMLElement;
  /** Title and artist. */
  now: HTMLElement;
  transport: HTMLElement;
  progressRow: HTMLElement;
};

export function mountLayoutOrder(parts: LayoutParts, query: MediaQueryList = matchMedia(STACKED)): void {
  const { bottomBar, cover, now, transport, progressRow } = parts;
  let stacked = false; // the markup starts in the wide order

  const apply = () => {
    if (query.matches === stacked) return;
    stacked = query.matches;
    // Moving a node blurs it; give focus back to whatever had it.
    const focused = document.activeElement;
    if (stacked) {
      cover.after(now);
      transport.before(progressRow);
    } else {
      bottomBar.prepend(now);
      progressRow.before(transport);
    }
    if (focused instanceof HTMLElement && focused.isConnected && document.activeElement !== focused) {
      focused.focus({ preventScroll: true });
    }
  };

  query.addEventListener("change", apply);
  apply();
}
