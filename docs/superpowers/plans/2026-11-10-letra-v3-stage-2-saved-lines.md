# letra v3, stage 2: saved lines — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a listener save a verse in the player, see it as saved, find it on the home and on a new `/salvas` page, and open the song at that verse from there.

**Architecture:** Saved lines live in the browser (`localStorage`), behind a pure module shaped like `recents.ts`. The player gets a save icon inside each verse, one real button after the lyrics and the `S` key, all calling one small module. The home section and the `/salvas` page are drawn by the upload entry from the same store, refreshed from the existing summary route. The server only gains the `/salvas` route.

**Tech Stack:** Node 22 (erasable TypeScript, `.ts` import specifiers), Vite 8 with vanilla TS and CSS, Fastify 5, vitest (node environment, no DOM), Playwright 1.63 with the preinstalled Chromium 153.

**Spec:** `docs/superpowers/specs/2026-11-10-letra-v3-design.md`: the "Save control" and "A link to a moment" parts of section 3, sections 4, 6 and 7, and the save gesture from section 5. The translate button on a saved line (section 8) is stage 3 and is not built here.

## Decisions where the spec is silent

The spec does not settle these. Each is decided here so that every task has one answer; the owner can reverse any of them in review.

1. **Where the icon sits.** The verse box grows into the gutter stage 1 reserved, and the icon sits inside it, after the text. The saved background therefore covers the text and the icon as one shape. The text keeps its width.
2. **Unsynced lyrics.** Their verses are not buttons, so each verse with text gets a real save button of its own (named with the line). The buttons are one Tab stop, moved with ↑ and ↓. There is no extra button after the lyrics. Where hover does not exist, the icon shows on the verse the listener tapped last; the first verse starts as that one.
3. **`S` on unsynced lyrics** acts on the verse whose save button has focus, else on the tapped verse.
4. **Links to a moment** round the verse's time up to a tenth of a second, so the link always lands on that verse.
5. **A line of a song the server no longer has** is plain text, not a link. Its remove button stays.
6. **The remove button on `/salvas`** is named "Remover linha salva" (the spec's text) and described by its line (`aria-describedby`).
7. **After "Desfazer"**, focus goes to the restored line.
8. **The undo toast** pauses its 5 seconds while the pointer is over it or focus is inside it. The first-save toast and the two error toasts stay 4 seconds.
9. **Headings on the home.** The wordmark becomes the page's `h1`, as in the owner view; "Linhas salvas" and "Ouvidas recentemente" are `h2`.
10. **Home cards** press to `scale(.98)`, like the tiles.
11. **`/salvas` does not pair the cover** in the page transition; the pages cross-fade.

## Global Constraints

- Paths are relative to `app/`. Run npm commands from `app/`.
- No new dependencies. No animation library.
- UI copy is pt-BR, sentence case. The saved thing is always a "linha", never a "verso". Every string comes from section 10 of the spec, character for character; the ones this stage uses are quoted in the tasks.
- Text from the store or the server reaches the page only as text nodes (`el()` children or `textContent`), never as HTML.
- Motion: only `transform`, `translate`, `scale`, `opacity` and `filter` move; colors may fade. Never `transition: all`. Every duration and easing in a `transition` or one-shot `animation` is a token from `web/shared/tokens.css`, or a custom property built only from them.
- `prefers-reduced-motion: reduce` makes every change immediate. The global rule in `web/shared/base.css` stays as it is.
- Accessibility floor: visible focus ring, 44 px touch targets, no horizontal scroll at 360 px.
- Icons come from `@phosphor-icons/core` only. No TIDAL or Apple assets.
- Storage keys: `letra.saved.v1` (the lines) and `letra.saved.hint.v1` (the first-save toast was shown). Reads and writes never throw.
- Tests: vitest has no DOM. Playwright uses the preinstalled Chromium; never run `playwright install`; pass `--trace off`. No network in tests. Never loosen a test; change an asserted value only where this plan names it. No fixed sleeps in new tests: wait on a condition, or drive time with `page.clock`.
- The fixture `song.mp3` has four synced lines, at 0.5, 2.5, 4.5 and 6.5 s, and lasts 8 s: "Primeiro verso da música", "Segundo verso, um pouco mais longo para quebrar a linha em telas estreitas", "Terceiro verso", "Último verso".
- Never commit `dist/`, `.data/`, `test-results/`, `playwright-report/` or `*.db`.
- Every commit message ends with the two attribution lines given in the task dispatch (`Co-Authored-By` and `Claude-Session`), exactly as given there.

## Review Focus

Inputs the spec implies and a listener will meet. Each has its test in the task named.

1. **A line edited after it was saved** (same index, new text): the verse does not show as saved, the old record stays on `/salvas`, and saving the new text replaces it. Tasks 2 and 4.
2. **Storage that reads but refuses writes** (full, or blocked by the browser): the "blocked" toast shows and nothing looks saved. Tasks 2 and 4.
3. **A click on the icon of a verse that is not playing, and Enter on a verse**: the first saves and must not seek; the second seeks and must not save. Task 4.
4. **More songs than the summary route takes at once (50)**: the refresh goes in batches, and a failed one leaves the stored details. Task 6.
5. **Line text with markup characters** (`<b>`, `&`): drawn as text on `/salvas` and on the home cards. Tasks 6 and 8.

## File Structure

New:

- `web/shared/saved.ts`: the store and its pure helpers (labels, grouping, links). No DOM.
- `web/player/save-line.ts`: wires the store to the player: the toggle, the button after the lyrics, the announcements and toasts, the pop.
- `web/upload/saved-page.ts`: the `/salvas` page.
- `web/upload/saved-section.ts`: the home section.
- `web/upload/saved.css`: styles of the page and the section.
- `test/unit/saved.test.ts`, `test/e2e/moment.spec.ts`, `test/e2e/save-line.spec.ts`, `test/e2e/saved-page.spec.ts`, `test/e2e/home-saved.spec.ts`.

Changed:

- `web/player/lyrics-view.ts`: the icon in each verse, the saved state, which verse the keyboard acts on.
- `web/player/timing.ts`, `web/player/main.ts`: `?t=`; the `S` key; mounting `save-line.ts`.
- `web/player/styles.css`: the icon, the saved look, the pop, the pill.
- `web/shared/icons.ts`: `bookmark-simple` (regular) and `bookmark-simple-fill`.
- `web/shared/toast.ts`: options with a duration and an action button.
- `web/shared/motion.ts`, `server/lib/render.ts`, `server/app.ts`: leftovers from stage 1's review (Task 1).
- `web/upload/main.ts`, `web/upload/home.ts`, `web/upload/styles.css`: the `/salvas` path, the home section, the toast action.
- `server/routes/pages.ts`, `server/lib/render.ts`: `GET /salvas`.
- `test/e2e/helpers.ts`: `setLyrics`, `savedLine`, `seedSaved`.
- `README.md`: saved lines.

---

### Task 1: Leftovers from stage 1's review

Small fixes the final review of stage 1 left for this plan. Nothing here changes what a listener sees.

**Files:**
- Modify: `web/shared/motion.ts`, `server/lib/render.ts`, `server/app.ts`
- Test: `test/unit/render.test.ts`, `test/unit/motion-css.test.ts`, `test/e2e/motion.spec.ts`, `test/e2e/cover-view.spec.ts`, `test/e2e/player.spec.ts`

**Interfaces:**
- Produces: `flip(el: HTMLElement, change: () => void, o?: { duration?: string; easing?: string }): void`, where `duration` and `easing` are now **token names** (defaults `"--dur-move"` and `"--ease-in-out"`). No caller passes options today.

- [ ] **Step 1: Write the failing tests**

  - `test/unit/render.test.ts`, `blockRendering marks a module script whatever the order of its attributes`:

    ```ts
    expect(blockRendering('<script crossorigin type="module" src="/a.js"></script>')).toContain('blocking="render"');
    expect(blockRendering('<script src="/a.js"></script>')).toBe('<script src="/a.js"></script>');
    const once = blockRendering('<script type="module" src="/a.js"></script>');
    expect(blockRendering(once)).toBe(once);
    ```

  - `test/unit/motion-css.test.ts`: add `"--lyrics-follow: 500ms;"` and `"--lyrics-follow-ease: cubic-bezier(.22, .61, .36, 1);"` to the list in "defines the durations and easings".
  - `test/e2e/cover-view.spec.ts`, `the cover runs no animation when the page loads`: an init script wraps `Element.prototype.animate` and counts the calls made on `[data-cover]`. With `noFullscreenApi`, after the player is drawn at 1440×900 the count is 0; after a click on the full-screen button it is 1.
  - `test/e2e/motion.spec.ts`, `a swapping icon starts its fade in the same frame`: in one `page.evaluate`, set the volume slider to 0 and dispatch `input`, then read `.volume-icon .icon`. There are two icons, the old one has `is-leaving`, and the new one has a running transition (`getAnimations().length > 0`) without waiting a frame.

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run test/unit/render.test.ts test/unit/motion-css.test.ts` and `npm run build && npx playwright test test/e2e/cover-view.spec.ts test/e2e/motion.spec.ts --trace off`
  Expected: the new render test and the two new E2E tests fail; the token test passes already (the tokens exist).

- [ ] **Step 3: Implement**

  - `flip`: options are token names; the duration is read with `tokenMs`; delete `parseDuration`. Return after `change()` without animating when the box did not move: `|dx| < 0.5`, `|dy| < 0.5`, `|sx − 1| < 0.001` and `|sy − 1| < 0.001`.
  - `swapIcon`: commit the entering icon's start state with an explicit reflow (`void next.offsetWidth`) and remove `is-entering` in the same task. No `requestAnimationFrame`.
  - `blockRendering`: match a `<script>` tag that has `type="module"` anywhere among its attributes and no `blocking` attribute.
  - `server/app.ts`: move the `./lib/render.ts` import down among the other `./lib/` imports.
  - `test/e2e/player.spec.ts`, "resizing: the column stays glued to the cover, with no slide": delete the step that waits for the page's own entrance animations. Nothing animates at load now, and the test must pass without it.

- [ ] **Step 4: Run the checks**

  Run: `npm run typecheck && npm test && npm run test:e2e -- --trace off`
  Expected: all pass.

- [ ] **Step 5: Commit**

  `git commit -m "Tidy the motion helpers and the render-blocking marker after stage 1's review"`

---

### Task 2: The saved-lines store

**Files:**
- Create: `web/shared/saved.ts`
- Test: `test/unit/saved.test.ts`

**Interfaces:**
- Consumes: `KeyValueStore`, `defaultStore` from `web/shared/recents.ts`; `TrackSummary` from `shared/types.ts`.
- Produces:

  ```ts
  export type SavedLine = {
    trackId: string; title: string; artist: string; hasCover: boolean;
    index: number;            // position in track.lyrics.lines
    t: number | null;         // ms; null for unsynced lyrics
    text: string;             // a copy of the line as saved
    lang: string | null;      // track.lyricsLang at save time
    tr: { lang: string; text: string } | null;
    at: number;               // epoch ms
  };
  export type SaveResult = "saved" | "full" | "blocked";
  export type SavedSong = { trackId: string; title: string; artist: string; hasCover: boolean; latest: number; lines: SavedLine[] };
  export const SAVED_KEY = "letra.saved.v1";
  export const SAVED_HINT_KEY = "letra.saved.hint.v1";
  export const SAVED_MAX = 1000;

  export function readSaved(store?: KeyValueStore | null): SavedLine[];
  export function isSaved(list: SavedLine[], trackId: string, index: number, text: string): boolean;
  export function saveLine(line: Omit<SavedLine, "at">, now?: number, store?: KeyValueStore | null): SaveResult;
  export function removeLine(trackId: string, index: number, store?: KeyValueStore | null): SavedLine | null;
  export function restoreLine(line: SavedLine, store?: KeyValueStore | null): SaveResult;
  export function setLineTranslation(trackId: string, index: number, tr: SavedLine["tr"], lang?: string | null, store?: KeyValueStore | null): void;
  export function mergeSummaries(list: SavedLine[], summaries: TrackSummary[]): { list: SavedLine[]; gone: string[] };
  export function groupBySong(list: SavedLine[]): SavedSong[];
  export function latest(list: SavedLine[], count: number): SavedLine[];
  export function savedLabel(at: number, now: number, form: "page" | "card"): string;
  export function lineHref(line: Pick<SavedLine, "trackId" | "t">): string;
  export function countLabel(lines: number, songs: number): string;
  export function linesLabel(lines: number): string;
  ```

  `store` defaults to `defaultStore()` everywhere, as in `recents.ts`.

**Rules the tests pin:**

- One record per `(trackId, index)`. Saving that position again replaces the record (new text, new `at`).
- `saveLine` answers `"full"` when the list has `SAVED_MAX` records and the position is new; replacing still works at the limit. It answers `"blocked"` when there is no store or the write throws; nothing is kept then.
- `removeLine` returns the removed record, or null. `restoreLine` puts a record back with its own `at`, under the same limit and blocked rules.
- `readSaved` drops, one by one, any record that is not a well-formed `SavedLine` (`index` a non-negative integer; `t` a number or null; `lang` a string or null; `tr` null or two strings), and any later record for a position already read. Unreadable JSON, or JSON that is not an array, reads as empty.
- `setLineTranslation` sets or clears `tr`; when `lang` is passed (null included) it replaces the record's `lang` too. A position that is not saved changes nothing. Stage 3 uses it.
- `mergeSummaries` copies `title`, `artist` and `hasCover` from the summaries onto the matching records. `gone` holds each `trackId` in the list that has no summary, once.
- `groupBySong`: songs by their most recent `at`, newest first; inside a song, lines by `index`. `latest(list, n)`: the `n` records with the largest `at`, newest first.
- Ties in `at` are broken by `trackId`, then `index`, so the order never depends on storage order.
- `lineHref`: `/t/<id>` when `t` is null, else `/t/<id>?t=<s>`, with `<s>` the time in seconds **rounded up** to one decimal and no trailing `.0`. The id is URI-encoded.
- `savedLabel` compares calendar days in local time; the day-before rule wins over the other-year rule. Months are fixed: `jan.`, `fev.`, `mar.`, `abr.`, `mai.`, `jun.`, `jul.`, `ago.`, `set.`, `out.`, `nov.`, `dez.`.

- [ ] **Step 1: Write the failing tests**

  `test/unit/saved.test.ts`, with an in-memory `KeyValueStore` like the one in `test/unit/recents.test.ts`. Tests, by name:

  - `saves a line and reads it back`
  - `saving the same position again replaces the record`
  - `isSaved needs the same track, index and text`
  - `an edited line: the old text is no longer saved, and saving the new text replaces it` (Review Focus 1)
  - `removeLine returns the record and restoreLine puts it back with its date`
  - `at 1000 records a new line is refused and nothing is removed; replacing still works`
  - `no store reads as empty; no store, or one that refuses writes, answers blocked and keeps nothing` (Review Focus 2)
  - `bad records are dropped one by one; a repeated position keeps the first`
  - `text that is not JSON, or not a list, reads as empty`
  - `setLineTranslation sets and clears the translation and can correct the language`
  - `mergeSummaries refreshes the details and names the songs the server no longer has`
  - `groupBySong orders songs by the latest save and lines by index`
  - `latest gives the newest records first`
  - `savedLabel`, `lineHref`, `countLabel and linesLabel`, with these values:

    ```ts
    const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();
    const now = at(2026, 11, 10, 15);
    expect(savedLabel(at(2026, 11, 10, 0, 1), now, "page")).toBe("Salva hoje");
    expect(savedLabel(at(2026, 11, 10, 0, 1), now, "card")).toBe("Hoje");
    expect(savedLabel(at(2026, 11, 9, 23, 59), now, "page")).toBe("Salva ontem");
    expect(savedLabel(at(2026, 11, 9, 23, 59), now, "card")).toBe("Ontem");
    expect(savedLabel(at(2026, 11, 2), now, "page")).toBe("Salva em 2 de nov.");
    expect(savedLabel(at(2026, 5, 20), now, "card")).toBe("20 de mai.");
    expect(savedLabel(at(2025, 12, 3), now, "page")).toBe("Salva em 3 de dez. de 2025");
    expect(savedLabel(at(2025, 12, 3), now, "card")).toBe("3 de dez. de 2025");
    // one minute apart, across midnight and across the year
    expect(savedLabel(at(2025, 12, 31, 23, 59), at(2026, 1, 1, 0, 0), "page")).toBe("Salva ontem");
    // a clock set back: a date after "now" is still a date, never an error
    expect(savedLabel(at(2026, 11, 12), now, "card")).toBe("12 de nov.");

    expect(lineHref({ trackId: "KyD0ZYYTz6", t: null })).toBe("/t/KyD0ZYYTz6");
    expect(lineHref({ trackId: "KyD0ZYYTz6", t: 0 })).toBe("/t/KyD0ZYYTz6?t=0");
    expect(lineHref({ trackId: "KyD0ZYYTz6", t: 2500 })).toBe("/t/KyD0ZYYTz6?t=2.5");
    expect(lineHref({ trackId: "KyD0ZYYTz6", t: 83_000 })).toBe("/t/KyD0ZYYTz6?t=83");
    expect(lineHref({ trackId: "KyD0ZYYTz6", t: 83_449 })).toBe("/t/KyD0ZYYTz6?t=83.5");

    expect(countLabel(10, 4)).toBe("10 linhas em 4 músicas");
    expect(countLabel(1, 1)).toBe("1 linha em 1 música");
    expect(countLabel(3, 1)).toBe("3 linhas em 1 música");
    expect(linesLabel(1)).toBe("1 linha");
    expect(linesLabel(4)).toBe("4 linhas");
    ```

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run test/unit/saved.test.ts`
  Expected: FAIL, the module does not exist.

- [ ] **Step 3: Implement `web/shared/saved.ts`**

  Pure functions over a `KeyValueStore`, safe to import in node, in the style of `recents.ts`.

- [ ] **Step 4: Run the checks**

  Run: `npm run typecheck && npx vitest run test/unit/saved.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  `git commit -m "Add the saved-lines store"`

---

### Task 3: A link to a moment (`?t=`)

**Files:**
- Modify: `web/player/timing.ts`, `web/player/main.ts`
- Test: `test/unit/timing.test.ts`, `test/api/pages.test.ts`, `test/e2e/moment.spec.ts` (new)

**Interfaces:**
- Produces: `export function startAt(search: string, durationMs: number): number | null` in `timing.ts`: the position in ms asked by the query string, or null.

- [ ] **Step 1: Write the failing tests**

  - `test/unit/timing.test.ts`, `startAt reads seconds with at most one decimal, inside the song`:

    ```ts
    expect(startAt("?t=83.5", 200_000)).toBe(83_500);
    expect(startAt("?t=0", 200_000)).toBe(0);
    expect(startAt("?t=12&x=1", 200_000)).toBe(12_000);
    for (const bad of ["", "?x=5", "?t=", "?t=abc", "?t=-3", "?t=+5", "?t=1.25", "?t=1e3", "?t=200", "?t=999"]) {
      expect(startAt(bad, 200_000), bad).toBeNull();
    }
    ```

  - `test/api/pages.test.ts`, `the server ignores ?t=`: the body of `GET /t/<id>?t=5` equals the body of `GET /t/<id>`.
  - `test/e2e/moment.spec.ts`:
    1. `?t= opens the song paused at that verse`: open `${track.shareUrl}?t=2.5`. The verse with `data-index="1"` has `data-state="active"`; `[data-elapsed]` reads `0:02`; the audio is paused. Click play: `audio.currentTime` is at least 2.5 a moment later and never below it.
    2. `a bad ?t= is ignored`: for `t=abc`, `t=-1`, `t=1.25` and `t=999`, the page opens with `[data-elapsed]` at `0:00`, `audio.currentTime` 0 and no verse active.
    3. `the share link never carries t`: opened with `?t=2.5`, the share dialog's copy-link button puts exactly `track.shareUrl` on the clipboard (as the copy test in `share.spec.ts` reads it).

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run test/unit/timing.test.ts` and `npm run build && npx playwright test test/e2e/moment.spec.ts --trace off`
  Expected: the unit test fails (`startAt` is not exported) and E2E test 1 fails. The API test and E2E tests 2 and 3 pass already; they pin behavior that must not change.

- [ ] **Step 3: Implement**

  - `startAt`: the first `t` parameter must match `^\d+(\.\d)?$`; the result is null when it does not, or when it is at or past `durationMs`.
  - `main.ts`, in `renderPlayer`, after the `player.onTime` listener is registered: `const start = startAt(location.search, track.durationMs)`; when it is not null, `player.seek(start)`. Nothing calls play. If the browser only takes the position once the file's metadata has loaded, seek again on `loadedmetadata`, once.

- [ ] **Step 4: Run the checks**

  Run: `npm run typecheck && npm test && npx playwright test test/e2e/moment.spec.ts test/e2e/player.spec.ts --trace off`
  Expected: PASS.

- [ ] **Step 5: Commit**

  `git commit -m "Open a song at a moment with ?t="`

---

### Task 4: The save control in the player

Structure and behavior. How it looks and moves is Task 5; until then the icon is unstyled and always visible.

**Files:**
- Create: `web/player/save-line.ts`, `test/e2e/save-line.spec.ts`
- Modify: `web/shared/icons.ts`, `web/player/lyrics-view.ts`, `web/player/main.ts`, `web/player/styles.css` (only the two visually hidden elements below), `test/e2e/helpers.ts`

**Interfaces:**
- Consumes: Task 2's store.
- Produces:

  ```ts
  // web/shared/icons.ts: two new names
  "bookmark-simple"       // assets/regular/bookmark-simple.svg
  "bookmark-simple-fill"  // assets/fill/bookmark-simple-fill.svg

  // web/player/lyrics-view.ts
  export type SaveTarget = { index: number; text: string; t: number | null; translation: { lang: string; text: string } | null };
  // Options gains:
  onSave(index: number): void;   // the icon of that verse was clicked or tapped
  onTargetChange(): void;        // the verse the keyboard acts on changed
  // LyricsView gains:
  target(): SaveTarget | null;                    // the verse the keyboard acts on
  targetAt(index: number): SaveTarget | null;     // a verse with text, by its index in the lyrics
  setSaved(indexes: ReadonlySet<number>): void;   // which verses show as saved

  // web/player/save-line.ts
  export type SaveLine = { toggle(index?: number): void; sync(): void };
  export function mountSaveLine(track: TrackDTO, view: LyricsView, column: HTMLElement): SaveLine;

  // test/e2e/helpers.ts
  export async function setLyrics(request: APIRequestContext, track: TrackDTO, text: string): Promise<TrackDTO>; // PUT /api/tracks/:id/lyrics { text }
  ```

  `onTargetChange` fires while `createLyricsView` is still running, so the callback in `main.ts` must tolerate `mountSaveLine` not having run yet.

**The page structure the tests rely on:**

- Every verse with text gets the class `has-save` and, as its last child, a `.verse-save` holding two icons: `iconEl("bookmark-simple", "icon save-outline")` and `iconEl("bookmark-simple-fill", "icon save-filled")`. Break rows and the dots rows get none.
  - Synced lyrics (the verse is a `button`): `span.verse-save[aria-hidden="true"]`.
  - Unsynced lyrics (the verse is a `div`): `button.verse-save[type="button"]` with `aria-pressed` and the name `Salvar linha: {linha}` or `Remover linha salva: {linha}`. These buttons are one Tab stop (roving `tabindex`, ↑ and ↓), like the synced verses.
- A saved verse has the attribute `data-saved`.
- Unsynced only: a click or tap on a verse outside its button marks it `data-picked`, one at a time; the first verse with text starts picked.
- Synced only: `button.save-pill[data-save-line]` in the lyrics column, right after the scroller and before the "Voltar ao verso atual" pill. It has `aria-pressed` and the same two names. It is the next Tab stop after the verses.
- `div[data-save-status][role="status"][aria-live="polite"]`, empty at first, in the column from the start.
- Both the pill and the status are visually hidden with the clip the player already uses for `.skip-lyrics`. Task 5 shows the pill on focus.

**Behavior:**

- A click or tap on `.verse-save` toggles that verse's save. It does not seek, does not start playback and does not change which verse the column follows.
- A click anywhere else on a synced verse seeks, as today. Enter and Space on a verse seek; they never save.
- `target()`: on synced lyrics, the verse that holds the roving tab stop (the last focused verse while focus is in the list, else the playing verse, else the first). On unsynced lyrics, the verse whose save button has focus, else the picked verse.
- `toggle(index)` acts on `targetAt(index)`; `toggle()` on `target()`. With no such verse it does nothing.
- The pill acts on `target()`. Its name and `aria-pressed` follow the target and its saved state; `sync()` refreshes them. With no target it is `hidden`.
- On unsynced lyrics `setSaved` also sets each save button's `aria-pressed` and name.
- The `S` key (in `main.ts`'s key handler, no modifiers, not on repeat) calls `toggle()`. It does nothing in the cover view, while a dialog is open, while a `[role="menu"]` is showing, or in a text field.
- The record saved: `trackId`, `title`, `artist`, `hasCover` from the track; `index`, `t` and `text` from the verse; `lang: track.lyricsLang`; `tr` from the translation shown under that verse at that moment (its text and its `lang` attribute), else null.
- A verse shows as saved when the store has a record with this track, its index and its exact text. The set is worked out at mount, after every toggle, on a `storage` event for `letra.saved.v1` (or with a null key) and on `pageshow` from the back/forward cache.
- After a save the status says `Linha salva`; after a removal, `Linha removida`. The same text twice in a row is still announced (empty the region, then fill it in the next frame).
- The first save on a device shows the toast `Linha salva. Elas ficam em Início › Linhas salvas.` for 4 s and sets `letra.saved.hint.v1`. Later saves show no toast.
- `"full"`: toast `Você chegou ao limite de 1000 linhas salvas. Remova algumas para salvar novas.` for 4 s. `"blocked"`: toast `Não foi possível salvar neste navegador.` for 4 s. Neither marks the verse nor announces a save.
- The toast region is mounted when the player is drawn (`mountToast()`), so it exists before it is filled.

- [ ] **Step 1: Write the failing tests**

  `test/e2e/save-line.spec.ts`. `stored(page)` reads and parses `letra.saved.v1`. Tests:

  1. `clicking the icon saves the verse and does not seek`: click the icon of verse 1. The verse has `data-saved`; the audio is paused at 0; the store holds one record with `trackId`, `title`, `artist`, `hasCover`, `index: 1`, `t: 2500`, the verse's text, `lang` equal to the track's `lyricsLang`, `tr: null` and a numeric `at`.
  2. `clicking it again removes the save`.
  3. `Enter on a verse seeks and does not save` (Review Focus 3): focus verse 1 by keyboard, press Enter. The audio is at 2.5 s or later; the store is empty.
  4. `S saves the focused verse, else the playing one`: with keyboard focus on verse 2, `s` saves index 2. With focus on the page body and the audio sought to 4.6 s, `s` saves the verse at 4.5 s.
  5. `S does nothing in the cover view, under the share dialog or with the language menu open`: with `noFullscreenApi`; the store stays empty in the three cases.
  6. `the button after the lyrics is the next Tab stop, names the line and toggles it`: from a focused verse, Tab lands on `[data-save-line]`. Its name is `Salvar linha: ` plus that verse's text and `aria-pressed` is `false`. Enter: `aria-pressed` is `true`, the name starts with `Remover linha salva: `, the verse has `data-saved`.
  7. `every save and removal is announced`: `[data-save-status]` reads `Linha salva`, then `Linha removida`; saving two verses one after the other fills it twice (a `MutationObserver` in the page counts two fills).
  8. `the first-save toast shows once per browser`: the first save shows the toast with the exact text and sets `letra.saved.hint.v1`. After a reload, saving another verse leaves `[data-toast]` without `is-shown`.
  9. `at the limit, the message shows and nothing is saved`: an init script stores 1000 well-formed records for other tracks. Clicking an icon shows the limit text; the verse has no `data-saved`; the store still has 1000.
  10. `when the browser refuses the write, the message shows and nothing looks saved` (Review Focus 2): an init script makes `Storage.prototype.setItem` throw. The blocked text shows; no `data-saved`; `[data-save-status]` stays empty.
  11. `the translation on screen is stored with the line`: turn the translation on, wait for the line under verse 1, save it. The record's `tr` has that text and the language's code.
  12. `two tabs stay in step`: two pages of the same context on the same song. Saving in one marks the verse in the other; removing clears it.
  13. `a line edited after it was saved no longer shows as saved` (Review Focus 1): save verse 1; with `setLyrics`, send the same four timed lines with the second one's text changed to `Outro texto`; reload. Verse 1 has no `data-saved`; the store still holds the old record. Saving it now leaves one record, with the text `Outro texto`.
  14. `unsynced lyrics: each line has its own save button, and they are one Tab stop`: after `setLyrics(request, track, "Linha um\nLinha dois\n\nLinha três")`. There are three `button.verse-save`; exactly one has `tabindex="0"`; ArrowDown moves focus to the next; Enter gives `aria-pressed="true"` and the name `Remover linha salva: Linha dois`; the record has `t: null` and the `index` of that line in `track.lyrics.lines` (read from what `setLyrics` returns); the page has no `[data-save-line]`.
  15. `unsynced lyrics: S acts on the tapped verse`: click the text `Linha três`, press `s`: the store has one record, with that text.

- [ ] **Step 2: Run them and see them fail**

  Run: `npm run build && npx playwright test test/e2e/save-line.spec.ts --trace off`
  Expected: FAIL, there is no `.verse-save`.

- [ ] **Step 3: Implement**

  Icons, then `lyrics-view.ts` (structure, `onSave`, the target, `setSaved`), then `save-line.ts`, then `main.ts` (mount, `S`).

- [ ] **Step 4: Run the checks**

  Run: `npm run typecheck && npm test && npm run test:e2e -- --trace off`
  Expected: all pass, the stage-1 specs included (the verses now hold one more child; no existing assertion changes).

- [ ] **Step 5: Commit**

  `git commit -m "Save a verse from the player: icon, button after the lyrics and the S key"`

---

### Task 5: The saved look and the save gesture

**Files:**
- Modify: `web/player/styles.css`, `web/player/save-line.ts`
- Test: `test/e2e/save-line.spec.ts`

**Interfaces:**
- Consumes: Task 4's structure (`has-save`, `.verse-save`, `.save-outline`, `.save-filled`, `data-saved`, `data-picked`, `.save-pill`).
- Produces: the class `is-popping` on a `.verse-save`, set by `save-line.ts` only when the listener saves (never at load, never from another tab), and removed when the animation ends.

**Values:**

- **Box.** `.verse.has-save` is `position: relative` and `isolation: isolate`, and grows into the gutter: `margin-inline-end: calc(-12px - var(--save-gutter))`, `padding-inline-end: calc(12px + var(--save-gutter))`, `max-width: calc(100% + 24px + var(--save-gutter))`. `.lyrics-list` keeps its `padding-inline-end: var(--save-gutter)`, so the text width and stage 1's gutter tests do not change.
- **Icon.** `.verse-save` is 44 by 44 px, absolutely placed, centered in that right padding (`inset-inline-end: calc((12px + var(--save-gutter) - 44px) / 2)`) and on the verse's first line (`top: calc(var(--verse-pad) + (1lh - 44px) / 2)`). Glyph 22 px. The two icons sit on top of each other. Outline: `rgb(255 255 255 / .72)`; filled: `var(--text-1)`. As a `button` (unsynced) it has no border or background of its own and the page's focus ring.
- **When it shows.** Hidden means `opacity: 0` and `pointer-events: none`. It shows (`opacity: 1`, `pointer-events: auto`):
  - inside `@media (hover: hover)`, on the hovered verse;
  - on a verse with `:focus-visible`, and on a `.verse-save` with `:focus-visible`;
  - inside `@media (hover: none)`, on the verse with `data-state="active"` and on the verse with `data-picked`;
  - always on a verse with `data-saved`.
  It appears and leaves by opacity over `--dur-fast` with `--ease-out`.
- **Saved.** On `[data-saved]`, `.save-filled` has opacity 1 and `.save-outline` opacity 0. The background is a `::before` on the verse: `inset: 0`, `z-index: -1`, `border-radius: inherit` (14 px), `background: rgb(255 255 255 / .08)`, opacity 0 to 1. Entering, the fill and the background take `--dur-base`; leaving, `--dur-exit`; both `--ease-out`.
- **Pop.** `.verse-save.is-popping .save-filled { animation: save-pop var(--dur-spring) var(--ease-spring); }`, with `@keyframes save-pop { from { transform: scale(.6); } }`. Removing a save has no pop.
- **Press.** `.verse-save:active` scales to `.94` over `--dur-fast`.
- **The pill.** `.save-pill` looks and sits like `.back-pill`. It is visually hidden until `:focus-visible`. While it shows, the back pill after it is transparent (`.save-pill:focus-visible ~ .back-pill { opacity: 0; }`).

- [ ] **Step 1: Write the failing tests**

  In `test/e2e/save-line.spec.ts`:

  16. `the icon shows under the pointer, on keyboard focus and on a saved verse`: at 1440×900 the icon of verse 1 has opacity 0; hovering the verse brings it to 1; moving away, back to 0; keyboard focus on the verse, 1; once saved, 1 with the pointer elsewhere.
  17. `without hover the icon shows on the playing verse, and a tap where a hidden one sits seeks`: a touch context (`hasTouch`, `isMobile`, 390×844). With the audio at 4.6 s only verse 2's icon has opacity 1. A tap at the center of verse 0's icon box makes verse 0 the playing one and saves nothing. A tap on its icon now saves it.
  18. `the icon is a 44 px target inside the verse, clear of the text`: its box is 44 by 44; its left edge is at or after the right edge of `.verse-text`; its right edge is inside the verse's box. Checked at 1440×900 and 360×640.
  19. `a saved verse has the filled icon and the soft background`: `.save-filled` opacity 1, `.save-outline` 0; the verse's `::before` has `background-color: rgba(255, 255, 255, 0.08)`, opacity 1 and a 14 px radius.
  20. `saving pops with the spring; removing does not`: right after a save, `.save-filled` has a running animation named `save-pop` lasting 350 ms. Right after the removal it has none, and the transition of its opacity lasts 0.15 s.
  21. `a mark that arrives from the store does not pop`: reload a page with a saved verse: no `save-pop` animation runs.
  22. `a saved verse that is not playing still dims and blurs`: verse 0 saved, the audio at 4.6 s: verse 0 has opacity below 1 and `data-blur` other than `"0"`.
  23. `the save pill shows only with keyboard focus, and the back pill gives way`: focused by Tab its box is inside the lyrics column with opacity 1, and the back pill (made visible by a wheel scroll first) has opacity 0; after Shift+Tab the save pill is clipped again.
  24. `reduced motion: saving runs no pop`: with `reducedMotion: "reduce"`, right after a save every animation on `.save-filled` lasts 1 ms at most.
  25. `no horizontal scroll at 360 px with a saved verse`: `document.documentElement.scrollWidth` is 360.

- [ ] **Step 2: Run them and see them fail**

  Run: `npm run build && npx playwright test test/e2e/save-line.spec.ts --trace off`
  Expected: tests 16 to 23 fail; 1 to 15 still pass.

- [ ] **Step 3: Implement the styles and the `is-popping` class**

- [ ] **Step 4: Run the checks**

  Run: `npm run typecheck && npm test && npm run test:e2e -- --trace off`
  Expected: all pass, including `test/unit/motion-css.test.ts` and the two gutter tests in `player.spec.ts`, unchanged.

- [ ] **Step 5: Commit**

  `git commit -m "Style the save icon, the saved verse and the save pop"`

---

### Task 6: The `/salvas` page

Route, page and its data. Removing a line is Task 7; until then the bookmark button is drawn and does nothing.

**Files:**
- Create: `web/upload/saved-page.ts`, `web/upload/saved.css`, `test/e2e/saved-page.spec.ts`
- Modify: `server/routes/pages.ts`, `server/lib/render.ts`, `web/upload/main.ts`, `test/api/pages.test.ts`, `test/unit/motion-css.test.ts`, `test/e2e/helpers.ts`

**Interfaces:**
- Consumes: Task 2's store; `getSummaries` from `web/shared/api.ts`; `formatTime` from `web/shared/format.ts`.
- Produces:

  ```ts
  // server/lib/render.ts
  export function renderUploadPage(template: string, title?: string): string; // title defaults to "letra"
  // web/upload/saved-page.ts
  export function renderSavedPage(app: HTMLElement): void;
  // test/e2e/helpers.ts
  export function savedLine(track: TrackDTO, index: number, over?: Partial<SavedLine>): SavedLine; // text and t from track.lyrics, at: Date.now()
  export function seedSaved(page: Page, lines: SavedLine[]): Promise<void>; // init script; writes once per tab (a sessionStorage flag), so reloads keep what the page changed
  ```

**Server:**

- `GET /salvas` answers the upload template with the title `Linhas salvas — letra` and the same `noindex` tag as `/`. With no front-end build it answers the same 503 as `/`.
- `web/upload/main.ts`: when the path is `/salvas` (a trailing slash allowed), `boot` draws `renderSavedPage(app)` and returns, before any session work. Signed in or not, the page is the same.

**Page structure** (the attributes are the tests' hooks):

```
div.home-page.saved-page[data-saved-view]
  header.home-header > a.saved-home[data-home][href="/"][aria-label="Início"]   (house icon)
  div.saved-col
    div.saved-head > h1[tabindex="-1"] "Linhas salvas" + p[data-saved-count]
    section.saved-song[data-song][data-id]                       one per song
      a.saved-song-head[data-song-head][href="/t/<id>"]          a div when the song is gone
        div.saved-cover (the cover image, or a tile with the music-note icon)
        div.saved-meta > h2 (title) + p (artist, or "Música indisponível")
        span[data-song-count]
      ul.saved-lines
        li.saved-line[data-line][data-index]
          a.saved-line-link[data-line-link][href=lineHref(line)]  a span when the song is gone
            span.saved-q[data-line-text][id]
            span.saved-tr[data-line-translation][lang]            only when the record has `tr`
          div.saved-line-meta
            time.saved-when[data-saved-when][datetime][title]
            span.saved-time[data-line-time]                       play icon + formatTime(t); absent when t is null or the song is gone
          div.saved-acts
            button.saved-act[data-remove][aria-label="Remover linha salva"][aria-describedby=<id of the text>]   (bookmark-simple-fill)
    div.saved-empty[data-saved-empty]
      bookmark-simple icon, p "Nenhuma linha salva ainda. No player, toque no marcador ao lado de um verso para guardá-lo aqui.", a[href="/"] "Ir para o início"
```

- The count: `countLabel(lines, songs)`. Each song: `linesLabel(n)`.
- `time`: `datetime` is the ISO form of `at`; the text is `savedLabel(at, Date.now(), "page")`; `title` is the full local date and time (`toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "short" })`).
- With no lines, only the top row, the title and the empty block show; the count is hidden.
- `app.className` is `"upload home"`, as `renderHome` sets it, so the page gets the home's background and box.

**Data:**

- On load the page draws from the store at once. Then it asks `getSummaries` for the songs' ids in batches of at most 50, all at the same time. When every batch has answered, it applies `mergeSummaries`, writes the refreshed list back to the store and redraws; the `gone` ids mark their songs unavailable for this visit only. If any batch fails, nothing changes and no message shows.
- The page loads again on `pageshow` from the back/forward cache and on a `storage` event for `letra.saved.v1` (or with a null key). Only the latest load's answer is applied.
- A redraw keeps keyboard focus on the same line when it is still there.

**Styles** (`web/upload/saved.css`, imported by `saved-page.ts`; these are the values of the mockup the owner approved):

```css
.saved-col { max-width: 680px; margin: 0 auto; }
.saved-head { margin-bottom: 36px; }
.saved-head h1 { margin: 0; font-size: 24px; line-height: 28px; font-weight: 700; letter-spacing: -.01em; }
.saved-head p { margin: 4px 0 0; color: var(--text-2); font-size: 14px; line-height: 20px; font-weight: 500; }
.saved-song { margin-bottom: 40px; }
.saved-song-head { display: flex; align-items: center; gap: 14px; margin-bottom: 10px; }
.saved-cover { flex: none; width: 48px; height: 48px; border-radius: 4px; }          /* the tile's icon is 22px */
.saved-meta { min-width: 0; flex: 1; }
.saved-meta h2 { margin: 0; font-size: 17px; line-height: 22px; font-weight: 600; }
.saved-meta p { margin: 0; color: var(--text-2); font-size: 14px; line-height: 20px; font-weight: 500; }
[data-song-count] { color: var(--text-2); font-size: 14px; line-height: 20px; font-weight: 500; }
.saved-lines { margin: 0; padding: 0; list-style: none; border-top: 1px solid var(--hairline); }
.saved-line {
  display: grid; grid-template-columns: minmax(0, 1fr) auto auto;
  grid-template-areas: "text time acts" "when time acts";
  column-gap: 12px; align-items: center;
  margin: 0 -12px; padding: 12px 4px 12px 12px; border-radius: var(--radius-row);
}
.saved-line + .saved-line { box-shadow: 0 -1px 0 var(--hairline); }
.saved-line-link { grid-area: text; min-width: 0; }
.saved-line-meta { display: contents; }
.saved-q { display: block; font-size: 20px; line-height: 26px; font-weight: 600; letter-spacing: -.01em; text-wrap: pretty; }
.saved-tr { display: block; margin-top: 2px; color: var(--text-2); font-size: 15px; line-height: 20px; font-weight: 500; }
.saved-when { grid-area: when; margin-top: 4px; color: rgb(175 175 182 / .75); font-size: 13px; line-height: 18px; font-weight: 500; }
.saved-time { grid-area: time; display: inline-flex; align-items: center; gap: 6px; color: var(--text-2); font-size: 13px; line-height: 18px; font-weight: 500; font-variant-numeric: tabular-nums; }
.saved-time .icon { font-size: 11px; opacity: 0; }
.saved-acts { grid-area: acts; display: flex; }
.saved-act { display: grid; place-items: center; width: 44px; height: 44px; border: 0; border-radius: 50%; background: none; color: var(--text-1); font-size: 20px; }
.saved-song.is-gone h2, .saved-song.is-gone .saved-q { color: var(--text-2); }
@media (max-width: 639px) {
  .saved-head h1 { font-size: 22px; line-height: 26px; }
  .saved-q { font-size: 18px; line-height: 24px; }
  .saved-line { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "text text" "meta acts"; row-gap: 2px; padding: 14px 4px 6px 12px; }
  .saved-line-meta { grid-area: meta; display: flex; align-items: center; gap: 14px; }
  .saved-when { margin: 0; }
  .saved-time .icon { opacity: 1; font-size: 10px; }
}
```

On top of that:

- Inside `@media (hover: hover)`, a hovered row gets `background: var(--row-hover)`, loses its hairline and the next row's, shows the play icon and turns the time `var(--text-1)`. The row's background and the icon's opacity change over `--dur-fast` with `--ease-out`.
- `.saved-act` presses to `scale(.94)` over `--dur-fast` and has the page's focus ring; links have it too.
- The empty block is centered like `.home-empty`, with a 48 px icon and its link styled like the home's text links.
- `.saved-home` is the player's home button: a 44 px circle filled with `var(--glass-fill)`, a 20 px icon, `var(--text-1)`, pressing to `scale(.97)` over `--dur-fast`, with the page's focus ring. (The upload sheet's own `.glass-btn` is a smaller circle and is not used here.)

- [ ] **Step 1: Write the failing tests**

  - `test/api/pages.test.ts`:
    - `GET /salvas serves the page titled Linhas salvas — letra, with noindex`: 200, `<title>Linhas salvas — letra</title>`, the robots tag.
    - add `/salvas` to the URLs checked by `missing front-end build answers 503`.
  - `test/unit/motion-css.test.ts`: add `"upload/saved.css"` to `SHEETS`.
  - `test/e2e/saved-page.spec.ts`, seeding with `seedSaved`:
    1. `songs come by the latest save and lines by their place in the lyrics`: song A with lines 2 and 0 saved long ago, song B with one line saved now. The page lists B, then A with line 0 before line 2.
    2. `the counts use singular and plural`: `3 linhas em 2 músicas`; song counts `2 linhas` and `1 linha`. With one line: `1 linha em 1 música`.
    3. `a line links to the song at its verse, and the header to the song`: hrefs `/t/<id>?t=2.5` and `/t/<id>`; a record with `t: null` links to `/t/<id>`. Clicking the line opens the player with verse 1 active and the audio paused.
    4. `dates read hoje, ontem, the day and month, and the year when it is another`: with `page.clock.install` at 10 Nov 2026, 15:00 local, the four `time` elements read `Salva hoje`, `Salva ontem`, `Salva em 2 de nov.` and `Salva em 3 de dez. de 2025`; each has an ISO `datetime` and a `title`.
    5. `a stored translation shows under its line, in its language`: `[data-line-translation]` has the text and `lang="pt-BR"`.
    6. `a song the server no longer has is marked and keeps its lines`: delete the track through the API after seeding. Its header is not a link and reads `Música indisponível`; its line is not a link and has no time; its remove button is there.
    7. `the empty page explains itself and links home`: the exact text; the link goes to `/`; no count shows.
    8. `details are refreshed from the server and written back`: seeded with an old title, the page shows the server's title and the store has it.
    9. `a failed refresh keeps what is stored, with no message`: with the summary route aborted, the old title stays and `[data-toast]` never gets `is-shown`.
    10. `more than 50 songs are asked for in batches` (Review Focus 4): 60 records with made-up ids (10 letters and digits each). Two summary requests go out, none with more than 50 ids; all 60 songs read `Música indisponível`.
    11. `line text is drawn as text` (Review Focus 5): a record whose text is `<b>negrito</b> & <img src=x onerror=alert(1)>` shows exactly that text; the line holds no `b` or `img` element.
    12. `a save in another tab appears`: a second page saves a verse in the player; the first page, left open on `/salvas`, lists it.
    13. `one column of at most 680 px, with the spec's type`: at 1440×900 `.saved-col` is 680 px wide and centered; the title is `24px/28px 700`, a line `20px/26px 600`, a translation `15px/20px 500`, the date and the time `13px/18px 500`. At 390×844 the title is `22px/26px` and a line `18px/24px`.
    14. `under the pointer a row gets a background and a play glyph`: the play icon's opacity goes from 0 to 1 and the row's background becomes `rgba(255, 255, 255, 0.08)`.
    15. `the remove button is a 44 px target named by the spec and described by its line`: 44 by 44; the name `Remover linha salva`; `aria-describedby` points at the line's text.
    16. `no horizontal scroll at 360 px`.
    17. `signed in, the path still shows the saved page`: with the owner's session in the context, `/salvas` shows `[data-saved-view]` and never the owner view.

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run test/api/pages.test.ts` and `npm run build && npx playwright test test/e2e/saved-page.spec.ts --trace off`
  Expected: FAIL: 404 on `/salvas`.

- [ ] **Step 3: Implement**

  The route and the title, the entry's path check, then the page and its styles.

- [ ] **Step 4: Run the checks**

  Run: `npm run typecheck && npm test && npm run test:e2e -- --trace off`
  Expected: all pass.

- [ ] **Step 5: Commit**

  `git commit -m "Add the /salvas page: saved lines by song"`

---

### Task 7: Removing a line, with undo

**Files:**
- Modify: `web/shared/toast.ts`, `web/upload/saved-page.ts`, `web/upload/saved.css`, `web/upload/styles.css`
- Test: `test/e2e/saved-page.spec.ts`

**Interfaces:**
- Produces:

  ```ts
  // web/shared/toast.ts
  export type ToastOptions = { ms?: number; action?: { label: string; run(): void } };
  export function toast(content: string | Node, options?: number | ToastOptions): void; // a number is still the duration
  ```

  With an `action`, the toast gets the class `has-action` and a `button.toast-action[data-toast-action]` after the content. A click runs `run()` and hides the toast at once. While the pointer is over the toast or focus is inside it, the countdown is stopped; it starts again, whole, when both have left. A new toast replaces the content and the action of the one showing.

**Behavior:**

- A click on `[data-remove]` removes the record from the store with no question. The row fades out over `--dur-exit` (class `is-leaving`) and is then taken out; with reduced motion it is taken out at once. The counts are redrawn, and a song with no line left goes too. With nothing left, the empty block shows.
- The toast reads `Linha removida` with the action `Desfazer`, for 5 s.
- `Desfazer` calls `restoreLine` with the removed record, redraws, and moves focus to that line's link (its remove button when the song is gone).
- After a removal, focus goes to the next row's link (the next line in reading order, in the same song or the next), else to the previous row's, else to the page's `h1`.
- Removing a second line replaces the toast: only the last removal can be undone.
- Styles, in `web/upload/styles.css` next to `.toast`: `.toast.has-action` is an inline flex row, centered, with a 16 px gap, no block padding and 8 px at its end; `.toast-action` is 44 px tall with 12 px side padding, no border or background, `var(--text-1)`, weight 600, underlined 3 px below the text, with the page's focus ring and a `var(--row-hover)` pill background under the pointer.

- [ ] **Step 1: Write the failing tests**

  In `test/e2e/saved-page.spec.ts`:

  18. `removing asks nothing: the row goes, the counts change, the store forgets it`.
  19. `Desfazer puts the line back where it was, with its date`: same position among its song's lines, the same `at` in the store, and focus on its link.
  20. `focus goes to the next row, then to the previous, then to the title`: with three lines, remove the middle one (focus on the third's link), then the third (focus on the first's), then the first (focus on the `h1`).
  21. `the undo stays 5 seconds, and longer under the pointer`: with `page.clock`: shown at 4.9 s, hidden at 5.1 s. In a second removal, hovering the toast and running 8 s leaves it shown; moving away and running 5.1 s hides it.
  22. `only the last removal can be undone`: remove two lines, press Desfazer: one line comes back, the second removed.
  23. `removing the last line shows the empty page`.
  24. `reduced motion: the row is gone at once`: with `reducedMotion: "reduce"`, the row is out of the page in the same turn as the click (checked inside one `page.evaluate` after two animation frames).
  25. `the player no longer shows the line as saved`: after removing on `/salvas`, the song's page has no `data-saved` on that verse.
  26. `Desfazer is a 44 px target reached by Tab`: its box is at least 44 px tall; Tab from the focused row reaches it before leaving the page.

- [ ] **Step 2: Run them and see them fail**

  Run: `npm run build && npx playwright test test/e2e/saved-page.spec.ts --trace off`
  Expected: tests 18 to 26 fail; 1 to 17 pass.

- [ ] **Step 3: Implement**

  `toast.ts` first (existing callers pass a number or nothing and keep working), then the page.

- [ ] **Step 4: Run the checks**

  Run: `npm run typecheck && npm test && npm run test:e2e -- --trace off`
  Expected: all pass, including the toast tests in `share.spec.ts` and `home.spec.ts`.

- [ ] **Step 5: Commit**

  `git commit -m "Remove a saved line, with undo"`

---

### Task 8: Saved lines on the home

**Files:**
- Create: `web/upload/saved-section.ts`, `test/e2e/home-saved.spec.ts`
- Modify: `web/upload/home.ts`, `web/upload/saved.css`

**Interfaces:**
- Consumes: Task 2's store (`readSaved`, `latest`, `mergeSummaries`, `lineHref`, `savedLabel`); `getSummaries`; Task 6's `seedSaved` and `savedLine`.
- Produces: `export function createSavedSection(signal: AbortSignal): { element: HTMLElement; load(): void }` in `saved-section.ts`. `home.ts` places `element` between the header and the "Ouvidas recentemente" row, calls `load()` from its own `load` (at mount and on `pageshow` from the back/forward cache) and passes the signal of the controller it already aborts when the home is drawn again.

**Structure:**

```
section.saved-section[data-saved-section]                     hidden when nothing is saved
  div.home-head-row
    h2.home-heading "Linhas salvas"
    a.home-clear[data-saved-all][href="/salvas"] "Ver todas (N)"      N = every saved line; as a link it is an inline-flex box, centered, with no underline
  div.saved-cards
    a.saved-card[data-saved-card][href=lineHref(line)]          a div when the song is gone
      span.saved-card-q (the line)
      span.saved-card-by
        span.saved-cover (32 px: the cover image, or a tile with the music-note icon)
        span.saved-card-who > b (title) + i (artist, or "Música indisponível")
        time.saved-card-when[datetime][title]                   savedLabel(at, now, "card")
```

- The cards are `latest(list, 3)`.
- The section asks `getSummaries` for its cards' songs (at most 3 ids), applies `mergeSummaries`, writes the list back and redraws; a `gone` song's card is not a link. A failed request changes nothing.
- The section also loads on a `storage` event for `letra.saved.v1` (or a null key); that listener is its own and ends with `signal`. Only the latest load's answer is applied.
- In `home.ts`: the wordmark becomes `h1.home-wordmark` and "Ouvidas recentemente" an `h2` with the same class and `tabindex` as today. "Limpar histórico" keeps clearing only the listening history.

**Styles** (`web/upload/saved.css`; the mockup's values):

```css
.saved-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-bottom: 56px; }
.saved-card { display: grid; align-content: space-between; gap: 20px; min-height: 148px; padding: 18px 18px 16px; border-radius: var(--radius-panel); background: rgb(255 255 255 / .08); }
.saved-card-q { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; font-size: 19px; line-height: 25px; font-weight: 600; letter-spacing: -.01em; }
.saved-card-by { display: flex; align-items: center; gap: 10px; min-width: 0; }
.saved-card .saved-cover { width: 32px; height: 32px; border-radius: 3px; }
.saved-card-who { min-width: 0; flex: 1; }
.saved-card-who b, .saved-card-who i { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-style: normal; font-size: 13px; line-height: 18px; }
.saved-card-who b { font-weight: 600; }
.saved-card-who i { color: var(--text-2); font-weight: 500; }
.saved-card-when { color: var(--text-2); font-size: 13px; line-height: 18px; font-weight: 500; }
@media (max-width: 639px) {
  .saved-cards { grid-template-columns: 1fr; gap: 10px; margin-bottom: 40px; }
  .saved-card { min-height: 0; gap: 14px; padding: 16px; }
  .saved-card-q { -webkit-line-clamp: 2; font-size: 17px; line-height: 23px; }
}
```

A card that is a link presses to `scale(.98)` over `--dur-fast` with `--ease-out`, gets `background: rgb(255 255 255 / .12)` under the pointer (inside `@media (hover: hover)`, over `--dur-fast`) and has the page's focus ring.

- [ ] **Step 1: Write the failing tests**

  `test/e2e/home-saved.spec.ts`:

  1. `the section shows only when a line is saved, above the listening history`: absent from view with an empty store; with one line, its heading is above "Ouvidas recentemente" on the page.
  2. `it shows the three latest lines, newest first, and links to all of them`: five lines seeded; three cards in the order of their dates; the link reads `Ver todas (5)` and goes to `/salvas`.
  3. `a card opens the song at its verse`: href `/t/<id>?t=2.5`; after the click the player shows verse 1 active, paused.
  4. `a card of a removed song is not a link and says so`: `Música indisponível` in place of the artist; the element is not an anchor.
  5. `Limpar histórico leaves the saved lines`: after it, the cards and the store are as before.
  6. `saved lines show even with no listening history`: the section shows and, under it, the history's empty text.
  7. `cards: three in a row on wide screens, stacked on phones`: at 1440×900 the three share one top and each line is `19px/25px 600` clamped to 3 lines; at 390×844 they share one left edge and the line is `17px/23px` clamped to 2.
  8. `dates on cards use the short form`: with `page.clock`: `Hoje`, `Ontem`, `2 de nov.`.
  9. `line text is drawn as text` (Review Focus 5): the markup record from Task 6's test 11 shows as written.
  10. `the wordmark is the page's h1 and the two sections are h2`.
  11. `a save in another tab appears on the home`.
  12. `no horizontal scroll at 360 px with three cards`.

- [ ] **Step 2: Run them and see them fail**

  Run: `npm run build && npx playwright test test/e2e/home-saved.spec.ts --trace off`
  Expected: FAIL: no `[data-saved-section]`.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the checks**

  Run: `npm run typecheck && npm test && npm run test:e2e -- --trace off`
  Expected: all pass, `home.spec.ts` and `page-transition.spec.ts` included, unchanged.

- [ ] **Step 5: Commit**

  `git commit -m "Show the latest saved lines on the home"`

---

### Task 9: Docs and the stage's checks

**Files:**
- Modify: `README.md` (in `app/`)

- [ ] **Step 1: Document saved lines in `app/README.md`**

  A short "Saved lines" section: what a listener can do (the icon, the `S` key, `/salvas`, the home section); that the lines live in the browser's `localStorage` on that device, up to 1000, and are not sent to the server; the `?t=` link. Add `S` wherever the README lists the player's keys.

- [ ] **Step 2: Run everything**

  Run, from `app/`:

  ```bash
  npm run typecheck && npm test && npm run test:e2e -- --trace off
  npx playwright test test/e2e/save-line.spec.ts test/e2e/saved-page.spec.ts test/e2e/home-saved.spec.ts test/e2e/moment.spec.ts --repeat-each=5 --workers=2 --trace off
  bash scripts/docker-smoke.sh
  ```

  and, from the repository root, `python3 validate_collection.py --root .`.
  Expected: every command passes; the repeated run has no failure.

- [ ] **Step 3: Commit**

  `git commit -m "Document saved lines"`

## Stage verification (the controller, after the last task)

- The full suite, the repeated run and the Docker smoke test above, on the branch head.
- Captures for the owner at device scale factor 2: the player with a hovered verse, a saved verse and the focused save pill (1440×900); the playing verse's icon on a phone (390×844); `/salvas` and the home with saved lines at both sizes, next to the approved mockups; frozen frames of the save pop (0, 60, 120, 180, 240 and 350 ms) and of a row leaving.
- The pull request says what was not checked: how the pop feels at speed, Safari and Firefox, VoiceOver on an iPhone.
