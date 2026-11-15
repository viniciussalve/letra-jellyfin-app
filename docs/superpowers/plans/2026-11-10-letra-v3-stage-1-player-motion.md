# letra v3, stage 1: simpler player and motion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the player show lyrics always, tie the cover view to full screen, drop the "Tocar" and "Letra" pills, widen the lyrics column, and give the whole app one motion system.

**Architecture:** All motion values live as CSS custom properties in `web/shared/tokens.css`; stylesheets only reference them. Two small helpers in a new `web/shared/motion.ts` cover what CSS cannot do alone: a FLIP for the cover and an animated icon swap. The cover view reuses the existing `data-lyrics="off"` layout and is driven by `fullscreenchange`, or by the button itself where the Fullscreen API is missing.

**Tech Stack:** Node 22 (erasable TypeScript, `.ts` import specifiers), Vite 8 with vanilla TS and CSS, Fastify 5, vitest (node environment, no DOM), Playwright 1.63 with the preinstalled Chromium 153.

**Spec:** `docs/superpowers/specs/2026-11-10-letra-v3-design.md`, sections 3 (without "Save control" and "A link to a moment") and 5 (without the save gesture). Stages 2 and 3 get their own plans.

## Amendments after the final review

The plan below is kept as it was executed. The final whole-branch review changed
four things it says; where they differ, this list and the spec win.

- **Full-screen button labels.** `Sair da tela cheia` and `Mostrar letra` were
  dropped. The button keeps one label per mode (`Tela cheia` where full screen
  exists, `Mostrar capa` where it does not) and reports its state with
  `aria-pressed`. Spec sections 3 and 10 carry the final copy.
- **Slider fill.** The `--fill-stop` formula in Task 8 was wrong at both ends
  while the handle is hidden. The shipped one is
  `n * 100% + (0.5 - n) * thumb * thumb-scale`.
- **Dialog exit.** The exit transition in Task 7 exists only where the `overlay`
  property is supported; elsewhere a dialog closes with a cut.
- **The lyrics' return.** Leaving the cover view, the verses no longer fade in
  at once: they wait until the cover has passed them (`--dur-move` minus
  `--dur-fast` side by side, `--dur-move` when stacked). Spec section 5 says
  the same.
- **Home.** The listener home is drawn before the session check unless the
  browser holds the owner hint `letra.owner.v1`, and the tile named for the page
  transition is chosen inside `draw()`, from the referrer only when the
  navigation is not a back or forward traversal.

## Global Constraints

- Paths are relative to `app/`. Run npm commands from `app/`.
- No new dependencies. No animation library.
- UI copy is pt-BR, sentence case. Exact strings for this stage: `Pular a letra`, `Tela cheia`, `Sair da tela cheia`, `Mostrar capa`, `Mostrar letra`.
- Motion: only `transform`, `translate`, `scale`, `opacity` and `filter` move; colors may fade. Never `transition: all`. Every duration and easing in a `transition` or one-shot `animation` is a token from Task 1. Two documented exceptions keep a layout property: the slider track's `height` and the upload bar's `width`.
- `prefers-reduced-motion: reduce` makes every change immediate. The global rule in `web/shared/base.css` stays as it is.
- Accessibility floor: visible focus ring, 44 px touch targets, no horizontal scroll at 360 px.
- Icons come from `@phosphor-icons/core` only. No TIDAL or Apple assets.
- Tests: vitest has no DOM. Playwright uses the preinstalled Chromium; never run `playwright install`; pass `--trace off`. No network in tests. Never loosen a test; change an asserted value only where this plan names it.
- In headless Chromium, Playwright's Escape key does not leave full screen. Tests simulate it with `page.evaluate(() => document.exitFullscreen())`.
- Never commit `dist/`, `.data/`, `test-results/`, `playwright-report/` or `*.db`.
- Every commit message ends with exactly these two lines:

  ```
  Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GJTMuQwCZCPkHBVf6YK4Ji
  ```

- Verify before each commit:

  ```bash
  npm run typecheck && npm test && npm run test:e2e -- --trace off
  ```

  and, from the repo root, `python3 validate_collection.py --root .` (must exit 0).

## Review Focus

Conditions the spec implies but does not spell out, most likely first. Each has a test in the task named.

1. **Leaving full screen without the button** (Esc or the browser's own UI): the lyrics come back and the button reads "Tela cheia" again. Task 3.
2. **Toggling fast or mid-animation** (the cover view, play and pause): the page ends in the state of the last toggle, with one icon and the cover on its layout box. Tasks 2 and 6.
3. **Resizing across 1024 px, or rotating a phone, while in the cover view:** the cover view stays, its controls stay reachable and focus is kept. Task 3.
4. **Reopening a dialog while it is still closing:** it opens and stays open. Task 7.
5. **Two home tiles carrying the transition name** after going to a song, coming back and picking another: the page transition must still run. Task 9.

## File Structure

| File | Responsibility |
|---|---|
| `web/shared/tokens.css` (modify) | The motion tokens. |
| `web/shared/motion.ts` (create) | `token`, `tokenMs`, `flip`, `swapIcon`, `enableActiveStates`. |
| `web/shared/base.css` (modify) | The view-transition rules shared by both pages. |
| `web/shared/dialog.ts` (modify) | Keeps a closed dialog in the page until its exit ends. |
| `web/player/main.ts` (modify) | Cover view, no pills, skip link, icon swaps. |
| `web/player/layout-order.ts` (modify) | No `lyricsToggle`. |
| `web/player/styles.css`, `web/upload/styles.css` (modify) | Tokens everywhere, press states, column, cover view, toasts, dialogs, menu, tiles, slider handle. |
| `web/upload/home.ts` (modify) | Names the tile cover for the page transition. |
| `server/lib/render.ts`, `server/app.ts` (modify) | Marks the page script render-blocking. |
| `test/unit/motion-css.test.ts` (create) | Scans the stylesheets for the motion rules. |
| `test/e2e/motion.spec.ts`, `test/e2e/cover-view.spec.ts`, `test/e2e/page-transition.spec.ts` (create) | Browser tests for this stage. |
| `test/e2e/player.spec.ts`, `share.spec.ts`, `translation.spec.ts` (modify) | Tests of the removed pills and the old widths. |

---

### Task 1: Motion tokens and press feedback

**Files:**
- Modify: `web/shared/tokens.css`, `web/player/styles.css`, `web/upload/styles.css`
- Create: `web/shared/motion.ts`, `test/unit/motion-css.test.ts`, `test/e2e/motion.spec.ts`
- Modify: `web/player/main.ts`, `web/upload/main.ts` (one call each)

**Interfaces:**
- Produces: the CSS custom properties below, used by every later task.
- Produces, in `web/shared/motion.ts`:
  - `token(name: string): string` — the trimmed computed value of a custom property on `:root`, e.g. `token("--ease-in-out")`.
  - `tokenMs(name: string): number` — the same, parsed to milliseconds (`"400ms"` → `400`, `".2s"` → `200`).
  - `enableActiveStates(): void` — adds one passive, empty `touchstart` listener to `document`, which iOS Safari needs before it applies `:active`.

- [ ] **Step 1: Write the failing unit test** in `test/unit/motion-css.test.ts`

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../../web/${p}`, import.meta.url), "utf8");
const SHEETS = ["shared/base.css", "shared/background.css", "player/styles.css", "upload/styles.css"];
const tokens = read("shared/tokens.css");
// Continuous loops, not transitions: they keep their own timing.
const LOOPS = ["drift", "dot-pulse", "breathe", "share-spin"];

describe("motion tokens", () => {
  it("defines the durations and easings", () => {
    for (const line of [
      "--dur-fast: 120ms;", "--dur-exit: 150ms;", "--dur-base: 200ms;", "--dur-move: 400ms;", "--dur-spring: 350ms;",
      "--ease-out: cubic-bezier(.22, 1, .36, 1);", "--ease-in-out: cubic-bezier(.65, 0, .35, 1);",
      "--ease-spring: cubic-bezier(.34, 1.56, .64, 1);",
    ]) expect(tokens).toContain(line);
  });
  it("replaces the spring with linear() where it is supported", () => {
    expect(tokens).toMatch(/@supports \(transition-timing-function: linear\(0, 1\)\)\s*\{\s*:root\s*\{\s*--ease-spring: linear\(0, 0\.051,/);
  });
});

describe("stylesheets", () => {
  const declarations = SHEETS.flatMap((sheet) =>
    [...read(sheet).matchAll(/(transition|animation)\s*:\s*([^;}]+)[;}]/g)].map((m) => ({ sheet, prop: m[1]!, value: m[2]!.trim() })),
  );
  it("never uses transition: all", () => {
    for (const d of declarations) if (d.prop === "transition") expect(d.value, d.sheet).not.toMatch(/(^|,\s*)all\b/);
  });
  it("takes every duration and easing from a token", () => {
    for (const d of declarations) {
      if (d.value === "none" || LOOPS.some((name) => d.value.includes(name))) continue;
      const bare = d.value.replace(/var\(--[\w-]+\)/g, "").replace(/\b0s\b/g, "");
      expect(bare, `${d.sheet}: ${d.prop}: ${d.value}`).not.toMatch(/\d*\.?\d+m?s\b|\bease\b|ease-in|ease-out|cubic-bezier|\blinear\b(?!\s*\()/);
    }
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run test/unit/motion-css.test.ts`
Expected: FAIL (tokens missing; raw durations such as `.15s ease` found).

- [ ] **Step 3: Add the tokens** to `:root` in `web/shared/tokens.css`, after the lyrics block

```css
  /* motion (spec v3 §5) */
  --dur-fast: 120ms;   /* press, hover */
  --dur-exit: 150ms;   /* anything leaving; icon swaps */
  --dur-base: 200ms;   /* icons, toasts, dialogs and menus entering */
  --dur-move: 400ms;   /* the cover changing place; page transition */
  --dur-spring: 350ms; /* the save pop */
  --ease-out: cubic-bezier(.22, 1, .36, 1);
  --ease-in-out: cubic-bezier(.65, 0, .35, 1);
  --ease-spring: cubic-bezier(.34, 1.56, .64, 1);
```

In the lyrics block of the same `:root`, name the follow scroll's existing timing (same values as today):

```css
  --lyrics-follow: 500ms;
  --lyrics-follow-ease: cubic-bezier(.22, .61, .36, 1);
```

and, after the `:root` block:

```css
/* A spring with 12% overshoot (damping ratio .56) where linear() exists. */
@supports (transition-timing-function: linear(0, 1)) {
  :root {
    --ease-spring: linear(0, 0.051, 0.178, 0.344, 0.52, 0.686, 0.83, 0.945, 1.028, 1.082, 1.111, 1.12, 1.115, 1.1, 1.08, 1.059, 1.039, 1.021, 1.007, 0.997, 0.99, 0.987, 0.986, 0.986, 1);
  }
}
```

- [ ] **Step 4: Replace every raw duration and easing** in `web/player/styles.css` and `web/upload/styles.css` with tokens

| Today | Becomes |
|---|---|
| Hover and state fades of `background-color`, `color`, `border-color`, `box-shadow`, `opacity` (`.15s ease`, `.2s ease`) | `var(--dur-fast) var(--ease-out)` |
| Press `transform .12s ease` | `var(--dur-fast) var(--ease-out)` |
| Slider track `height .15s ease`; upload bar `width .2s ease` | same property, `var(--dur-fast) var(--ease-out)` |
| `.verse-translation` `opacity .5s ease` | `opacity var(--lyrics-duration) var(--lyrics-ease)` |
| The verses' follow `translate 500ms cubic-bezier(.22, .61, .36, 1)` (both lists) | `translate var(--lyrics-follow) var(--lyrics-follow-ease)` |
| Cover and lyrics `left`/`width`/`height`/`transform` `.5s var(--lyrics-ease)` | `var(--dur-move) var(--ease-in-out)` (Task 6 removes them) |
| Lyrics-off fades `.35s ease` and their `visibility` delays | `var(--dur-exit) var(--ease-out)`; the `visibility` entry is written `visibility 0s var(--dur-exit)` when delayed and `visibility 0s` when not, with no `linear` keyword (Task 6 refines) |
| Toast `.25s ease`; `dialog-in .2s ease-out`; `share-pop`, `share-fade`, `share-up` | `var(--dur-base) var(--ease-out)` (Task 7 refines) |

Leave the loops (`drift`, `dot-pulse`, `breathe`, `share-spin`), the `--lyrics-*` values and the reduced-motion blocks alone.

- [ ] **Step 5: Add press feedback**

- Buttons with a surface, `:active:not(:disabled)` → `transform: scale(.97)`: `.glass-btn`, `.glass-pill`, `.white-pill`, `.text-pill`, `.back-pill`, `.share-action`, `.alert-btn`.
- Bare-icon buttons → `scale(.94)`: `.transport-btn` (today `.9`), and `.share-close` and `.row-btn` if they draw no background (else `.97`).
- Each gets `transform var(--dur-fast) var(--ease-out)` in its `transition` list.
- No press scale on `.menu-row`, `.home-clear` or `.verse`.

- [ ] **Step 6: Create `web/shared/motion.ts`** with `token`, `tokenMs` and `enableActiveStates` as in Interfaces, and call `enableActiveStates()` once at startup in `web/player/main.ts` and `web/upload/main.ts`.

- [ ] **Step 7: Write the browser tests** in `test/e2e/motion.spec.ts`

```ts
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { uploadFixture } from "./helpers.ts";

async function open(page: Page, request: APIRequestContext, file = "song.mp3") {
  const track = await uploadFixture(request, file);
  await page.goto(track.shareUrl);
  await expect(page.locator("[data-play]")).toBeVisible();
  return track;
}
const scaleOf = (page: Page, selector: string) =>
  page.locator(selector).evaluate((e) => new DOMMatrixReadOnly(getComputedStyle(e).transform).a);
async function press(page: Page, selector: string) {
  const b = (await page.locator(selector).boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
}

test("tokens are on the page", async ({ page, request }) => {
  await open(page, request);
  const read = (name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
  expect(await read("--dur-fast")).toBe("120ms");
  expect(await read("--dur-move")).toBe("400ms");
  expect(await read("--ease-spring")).toMatch(/^linear\(0, 0\.051/);
});

test("a glass button presses to .97 and a transport button to .94", async ({ page, request }) => {
  await open(page, request);
  await press(page, "[data-share]");
  await expect.poll(() => scaleOf(page, "[data-share]")).toBeCloseTo(0.97, 2);
  await page.mouse.move(0, 0); // release off the button: no click, so the dialog stays closed
  await page.mouse.up();
  await expect.poll(() => scaleOf(page, "[data-share]")).toBe(1);
  await press(page, "[data-back]");
  await expect.poll(() => scaleOf(page, "[data-back]")).toBeCloseTo(0.94, 2);
  await page.mouse.up();
});

test("reduced motion: transitions are immediate", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, request);
  const durations = await page.locator("[data-share]").evaluate((e) => getComputedStyle(e).transitionDuration);
  for (const d of durations.split(",")) expect(parseFloat(d)).toBeLessThan(0.001);
});
```

- [ ] **Step 8: Run everything**

Run: `npm run typecheck && npm test && npm run build && npx playwright test test/e2e/motion.spec.ts --trace off`
Expected: PASS. Then the full `npm run test:e2e -- --trace off`: PASS (no existing test asserts the old durations; if one does, update its value to the token's).

- [ ] **Step 9: Commit** — `Add motion tokens and press feedback`

---

### Task 2: Animated icon swap

**Files:**
- Modify: `web/shared/motion.ts`, `web/player/main.ts`, `web/player/styles.css`, `web/upload/styles.css`
- Test: `test/e2e/motion.spec.ts`

**Interfaces:**
- Consumes: `tokenMs` from Task 1.
- Produces: `swapIcon(button: HTMLElement, name: IconName): void` in `web/shared/motion.ts`. After it returns, the button holds exactly one `.icon` that is not `.is-leaving`, with `data-icon="<name>"`. A call with the name already shown does nothing.

- [ ] **Step 1: Write the failing tests** (append to `test/e2e/motion.spec.ts`)

```ts
const icons = (page: Page, selector: string) =>
  page.locator(`${selector} .icon`).evaluateAll((nodes) => nodes.map((n) => ({ name: n.getAttribute("data-icon"), leaving: n.classList.contains("is-leaving") })));

test("play and pause swap with a short cross-fade and end with one icon", async ({ page, request }) => {
  await open(page, request);
  await page.locator("[data-play]").click();
  await expect(page.locator("[data-play]")).toHaveAttribute("aria-label", "Pausar");
  expect((await icons(page, "[data-play]")).filter((i) => !i.leaving)).toEqual([{ name: "pause", leaving: false }]);
  await expect.poll(() => icons(page, "[data-play]")).toEqual([{ name: "pause", leaving: false }]);
});

test("toggling fast ends with one icon for the final state", async ({ page, request }) => {
  await open(page, request);
  const play = page.locator("[data-play]");
  for (let i = 0; i < 5; i++) await play.click({ delay: 0 });
  await expect(play).toHaveAttribute("aria-label", "Pausar"); // 5 clicks: playing
  await expect.poll(() => icons(page, "[data-play]")).toEqual([{ name: "pause", leaving: false }]);
});

test("the volume icon shows mute at zero", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, request);
  const slider = page.getByRole("slider", { name: "Volume" });
  await slider.fill("0");
  await expect.poll(() => icons(page, ".volume")).toEqual([{ name: "speaker-mute", leaving: false }]);
  await slider.fill("0.6");
  await expect.poll(() => icons(page, ".volume")).toEqual([{ name: "speaker", leaving: false }]);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npm run build && npx playwright test test/e2e/motion.spec.ts --trace off`
Expected: FAIL (`data-icon` is null; the volume icon never changes).

- [ ] **Step 3: Implement `swapIcon`**

- The entering icon is appended with class `is-entering`; one animation frame later the class is removed. The old icon gets `is-leaving` and is removed on its `transitionend` or after `tokenMs("--dur-exit") + 50` ms, whichever comes first. Any icon already `is-leaving` is removed at the start of a call.
- CSS, in both stylesheets' `.icon` rule:

```css
.icon { grid-area: 1 / 1; transition: opacity var(--dur-exit) var(--ease-out), scale var(--dur-exit) var(--ease-out), filter var(--dur-exit) var(--ease-out); }
.icon.is-entering, .icon.is-leaving { opacity: 0; scale: .9; filter: blur(2px); }
```

- `.volume` needs its icon in a one-cell grid wrapper so both icons overlap; `.glass-btn` and `.transport-btn` already are grids.

- [ ] **Step 4: Use it** in `web/player/main.ts`: delete the local `setIcon`; play and pause and the full-screen button call `swapIcon`; the volume handler calls `swapIcon(volumeIconHolder, audio.volume === 0 ? "speaker-mute" : "speaker")`.

- [ ] **Step 5: Run** `npm run typecheck && npm test && npm run test:e2e -- --trace off`. Expected: PASS.

- [ ] **Step 6: Commit** — `Cross-fade icons when they swap`

---

### Task 3: Lyrics always on; the cover view follows full screen

**Files:**
- Modify: `web/player/main.ts`, `web/player/layout-order.ts`, `web/player/styles.css`, `README.md` (only if it mentions the "Letra" pill or the `L` key)
- Create: `test/e2e/cover-view.spec.ts`
- Modify: `test/e2e/player.spec.ts`, `test/e2e/share.spec.ts`

**Interfaces:**
- Consumes: `swapIcon` from Task 2.
- Produces, inside `renderPlayer`: `setCoverView(on: boolean): void`. It is the only writer of `app.dataset.lyrics` (`"off"` when on). Tasks 4 and 6 extend it.

- [ ] **Step 1: Write the failing tests** in `test/e2e/cover-view.spec.ts`

Shared helpers: `open` as in `motion.spec.ts`; and

```ts
const noFullscreenApi = (page: Page) =>
  page.addInitScript(() => Object.defineProperty(Document.prototype, "fullscreenEnabled", { get: () => false }));
const refuseFullscreen = (page: Page) =>
  page.addInitScript(() => { Element.prototype.requestFullscreen = () => Promise.reject(new TypeError("denied")); });
const player = (page: Page) => page.locator(".player");
const button = (page: Page) => page.locator("[data-fullscreen]");
const isFullscreen = (page: Page) => page.evaluate(() => document.fullscreenElement !== null);
```

Tests, each asserting exactly this:

1. `there is no lyrics pill and L does nothing`: `[data-lyrics-toggle]` has count 0; after `keyboard.press("l")`, `.player` still has `data-lyrics="on"` and `[data-lyrics-state]` is visible.
2. `full screen shows the cover view`: at 1440×900, click the button → `isFullscreen` true; `data-lyrics="off"`; `[data-lyrics-state]` hidden; button `aria-pressed="true"` and `aria-label="Sair da tela cheia"`; the cover is a square of `Math.min(0.62 * innerHeight, 640, innerWidth - 144)` px (±1) whose center is within 2 px of the stage's center.
3. `leaving full screen by Esc brings the lyrics back`: after test 2's click, `page.evaluate(() => document.exitFullscreen())` → `data-lyrics="on"`, lyrics visible, `aria-pressed="false"`, `aria-label="Tela cheia"`.
4. `F toggles it`: `keyboard.press("f")` → `data-lyrics="off"`; again → `"on"`.
5. `translation is out of reach in the cover view`: enter the cover view → `.translate-group` not visible and has the `inert` attribute, `section.lyrics` has `inert`; `keyboard.press("t")` leaves `[data-translate]` at `aria-pressed="false"`.
6. `without the Fullscreen API the button toggles the cover in the page`: with `noFullscreenApi`, at 390×844 → the button is visible with `aria-label="Mostrar capa"`; click → `data-lyrics="off"`, `aria-label="Mostrar letra"`, `aria-pressed="true"`, `isFullscreen` false; click → `"on"`.
7. `a refused full-screen request changes nothing`: with `refuseFullscreen`, click → `data-lyrics` stays `"on"`, `aria-pressed="false"`.
8. `resizing across 1024 px keeps the cover view`: with `noFullscreenApi` at 1440×900, focus the button and press Enter → `"off"`; `setViewportSize(390, 844)` → still `"off"`, `.bottom-row [data-fullscreen]` has count 1, the button is focused, lyrics hidden; back to 1440×900 → still `"off"`, `header.top-bar [data-fullscreen]` count 1, button focused.
9. `a song with no lyrics still has the cover view`: open `"Letra Fixtures - Sem Tags.mp3"` uploaded as `"Letra Fixtures - Instrumental Teste.mp3"` (see `open` in `player.spec.ts` for the two-name upload), with `noFullscreenApi` → click toggles `data-lyrics` to `"off"` and back.

- [ ] **Step 2: Run them and see them fail**

Run: `npm run build && npx playwright test test/e2e/cover-view.spec.ts --trace off`
Expected: FAIL (the pill exists; full screen does not change `data-lyrics`; the button is hidden without the API).

- [ ] **Step 3: Change `web/player/main.ts`**

- Remove `lyricsToggle`, `toggleLyrics`, `COPY.lyrics`, `COPY.lyricsPill`, and the `l`/`L` case. Fix the shortcuts comment.
- `COPY` gains `exitFullscreen: "Sair da tela cheia"`, `showCover: "Mostrar capa"`, `showLyrics: "Mostrar letra"`.
- The full-screen button is never hidden. `const canFullscreen = document.fullscreenEnabled;` its label is `fullscreen`/`exitFullscreen` when true, `showCover`/`showLyrics` when false.
- `setCoverView(on)`: sets `app.dataset.lyrics`; sets the button's `aria-pressed`, label and icon (`corners-in` when on); sets `lyrics.inert` and `translateGroup.inert` to `on`.
- The click and the `f` key: with the API, `requestFullscreen()` or `exitFullscreen()`, with `.catch(() => {})`; without it, `setCoverView(app.dataset.lyrics === "on")`.
- `fullscreenchange` calls `setCoverView(document.fullscreenElement !== null)`.
- The `t` case does nothing while `app.dataset.lyrics === "off"`.

- [ ] **Step 4: Change `web/player/layout-order.ts`**: remove `lyricsToggle` from `LayoutParts` and from both branches (`bottomRow.append(translateGroup, fullscreen)`; `topActions.prepend(translateGroup)`).

- [ ] **Step 5: Change `web/player/styles.css`**

- Wide: `--cover-off: min(62vh, 640px, calc(100vw - 144px));`.
- Stacked `.bottom-row`: `display: flex; justify-content: space-between; align-items: center;`. Delete the `[data-lyrics-toggle]` rule and the grid-column rules of its neighbors. The stacked `.language-menu` opens up from the left: `top: auto; bottom: calc(100% + 8px); left: 0; right: auto; transform: none;`.

- [ ] **Step 6: Update the existing tests** that used the removed pill or key

| Test | Change |
|---|---|
| `player.spec.ts` "lyrics pill toggles" and "lyrics toggle hides the column and centers the cover" | Delete; `cover-view.spec.ts` replaces them. |
| "wide layout: cover left…", "focus order on wide screens", "focus order follows the visual order on phones" | Remove `[data-lyrics-toggle]` from the selector lists. |
| "phone layout" | Replace the pill assertions with: `.bottom-row` holds `.translate-group` at the left edge and `[data-fullscreen]` at the right edge (within 1 px of the row's content box). |
| "resizing across 1024 px reorders without losing focus" | Use `[data-fullscreen]` as the focused control, with `noFullscreenApi`; the final Enter sets `aria-pressed="true"`. |
| "keyboard: Space toggles, ArrowRight seeks +5 s, L toggles lyrics" | Rename to end "…, L does nothing"; assert `data-lyrics` stays `"on"`. |
| "shortcuts keep working after using a slider" | Use `f` with `noFullscreenApi` in place of `l`, asserting `data-lyrics`. |
| `share.spec.ts` line ~410 | Press `f` and assert `[data-fullscreen]` keeps `aria-pressed="false"` while the dialog is open. |

- [ ] **Step 7: Run** `npm run typecheck && npm test && npm run test:e2e -- --trace off`. Expected: PASS.

- [ ] **Step 8: Commit** — `Show lyrics always; make full screen the cover view`

---

### Task 4: No "Tocar" pill; a skip link

**Files:**
- Modify: `web/player/main.ts`, `web/player/styles.css`
- Modify: `test/e2e/player.spec.ts`, `test/e2e/translation.spec.ts`, `test/e2e/cover-view.spec.ts`

**Interfaces:**
- Consumes: `setCoverView` from Task 3 (it also hides the skip link).
- Produces: `a[data-skip-lyrics]` before `section.lyrics`; the play button has `id="play"`.

- [ ] **Step 1: Write the failing tests** (in `player.spec.ts`, using its helpers)

```ts
test("there is no Tocar pill; the play button starts playback", async ({ page, request }) => {
  await open(page, request);
  await expect(page.locator("[data-play-pill]")).toHaveCount(0);
  await page.locator("[data-play]").click();
  await expect.poll(async () => (await audioState(page)).paused).toBe(false);
});

test("the skip link sits before the lyrics, is not a Tab stop and moves focus to play", async ({ page, request }) => {
  await open(page, request);
  const skip = page.locator("[data-skip-lyrics]");
  await expect(skip).toHaveText("Pular a letra");
  await expect(skip).toHaveAttribute("tabindex", "-1");
  const order = ["[data-skip-lyrics]", "[data-verse]", "[data-play]"];
  expect(await domOrder(page, order)).toEqual(order);
  const box = (await skip.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(1);
  expect(box.height).toBeLessThanOrEqual(1);
  await skip.evaluate((a: HTMLAnchorElement) => a.click());
  await expect(page.locator("[data-play]")).toBeFocused();
});

test("no skip link when the song has no verses", async ({ page, request }) => {
  await open(page, request, "Letra Fixtures - Sem Tags.mp3", "Letra Fixtures - Instrumental Teste.mp3");
  await expect(page.locator("[data-skip-lyrics]")).toHaveCount(0);
});
```

And in `cover-view.spec.ts`: `the skip link is hidden in the cover view` — with `noFullscreenApi`, enter the cover view → `[data-skip-lyrics]` has the `hidden` attribute; leave → it does not.

- [ ] **Step 2: Run them and see them fail**

Run: `npm run build && npx playwright test test/e2e/player.spec.ts -g "Tocar pill|skip link" --trace off`
Expected: FAIL.

- [ ] **Step 3: Implement**

- Remove the pill element, its listeners, the `pill.hidden` lines, and the `.play-pill` rules (including the two focus rules that name it). `.back-pill` keeps the shared declarations.
- Add `COPY.skipLyrics = "Pular a letra"`. When the lyrics state is `synced` or `unsynced`, insert `el("a", { class: "skip-lyrics", href: "#play", tabindex: "-1", "data-skip-lyrics": true }, COPY.skipLyrics)` in the stage before `lyrics`. The play button gets `id="play"`. The link's click handler prevents the default and focuses the play button.
- `.skip-lyrics` is visually hidden with the same clip technique as `.sr-only` in `web/upload/styles.css`.
- `setCoverView(on)` sets `skip.hidden = on`.

- [ ] **Step 4: Update the existing tests**

| Test | Change |
|---|---|
| The five "`…: the Tocar pill sits above the first verse, over no verse`", "the Tocar pill sits above the intro row too", "the Tocar pill comes before the verses in reading and Tab order" | Delete. |
| "opens with cover, title and lyrics; play pill starts playback" | Rename to "…; the play button starts playback"; click `[data-play]`. |
| `player.spec.ts` "Media Session metadata after play", `translation.spec.ts` line ~172 | Click `[data-play]` in place of the pill. |
| "lyrics language is set on the verses only" | Remove the pill expectation. |
| "wide: from share, Tab reaches the transport within 4 presses" | Keep as is: it must still pass. |

- [ ] **Step 5: Run** `npm run typecheck && npm test && npm run test:e2e -- --trace off`. Expected: PASS.

- [ ] **Step 6: Commit** — `Remove the Tocar pill; add a skip link past the lyrics`

---

### Task 5: Wider column and the save gutter

**Files:**
- Modify: `web/player/styles.css`
- Modify: `test/e2e/player.spec.ts`

**Interfaces:**
- Produces: `--save-gutter` on `.lyrics` (40 px wide, 36 px stacked), the space stage 2 puts the save icon in.

- [ ] **Step 1: Write the failing test** (in `player.spec.ts`)

```ts
for (const [width, height, column] of [[1024, 768, 389.12], [1440, 900, 520], [1920, 1080, 520]] as const) {
  test(`wide: the lyrics column is ${column} px at ${width} px, with a 40 px gutter`, async ({ page, request }) => {
    await page.setViewportSize({ width, height });
    await open(page, request);
    const lyrics = (await box(page, "section.lyrics"))!;
    expect(lyrics.width).toBeCloseTo(column, 0);
    const list = await page.locator(".lyrics-list").evaluate((e) => {
      const s = getComputedStyle(e);
      return { width: e.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight), gutter: parseFloat(s.paddingRight) };
    });
    expect(list.gutter).toBe(40);
    expect(list.width).toBeCloseTo(column - 32 - 40, 0); // 16 px of column padding each side
  });
}

test("phones: a 36 px gutter and no horizontal scroll at 360 px", async ({ page, request }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await open(page, request);
  expect(await page.locator(".lyrics-list").evaluate((e) => parseFloat(getComputedStyle(e).paddingRight))).toBe(36);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npm run build && npx playwright test test/e2e/player.spec.ts -g "lyrics column is|36 px gutter" --trace off`
Expected: FAIL (440 px; no gutter).

- [ ] **Step 3: Implement**: on wide, `--column: min(520px, 38vw);`. `.lyrics { --save-gutter: 40px; }`, `36px` in the stacked block. `.lyrics-list { padding-inline-end: var(--save-gutter); }`.

- [ ] **Step 4: Update** any existing assertion of a 440 px or 34vw column in `player.spec.ts` to the new values. The centering tests (`the cover + lyrics group is centered at …`) must pass unchanged.

- [ ] **Step 5: Run** `npm run test:e2e -- --trace off`. Expected: PASS.

- [ ] **Step 6: Commit** — `Widen the lyrics column and reserve the save gutter`

---

### Task 6: The cover-view transition

**Files:**
- Modify: `web/shared/motion.ts`, `web/player/main.ts`, `web/player/styles.css`
- Modify: `test/unit/motion-css.test.ts`, `test/e2e/cover-view.spec.ts`, `test/e2e/player.spec.ts`

**Interfaces:**
- Consumes: `token`, `tokenMs` (Task 1); `setCoverView` (Task 3).
- Produces: `flip(el: HTMLElement, change: () => void, o?: { duration?: string; easing?: string }): void` in `web/shared/motion.ts`. It measures `el`, cancels any FLIP still running on it, runs `change`, measures again and plays the difference with `el.animate` on `transform`, origin top left. Defaults: `--dur-move`, `--ease-in-out`. With reduced motion, or when either box is empty, it only runs `change`.

- [ ] **Step 1: Write the failing tests**

In `test/unit/motion-css.test.ts`, inside `describe("stylesheets")`:

```ts
it("moves nothing by a layout property", () => {
  const ALLOWED = [/slider-runnable-track[^}]*transition:\s*height/, /\.bar-fill[^}]*transition:\s*width/];
  for (const sheet of SHEETS) {
    const css = ALLOWED.reduce((text, ok) => text.replace(ok, ""), read(sheet));
    expect(css, sheet).not.toMatch(/transition\s*:[^;}]*\b(left|right|top|bottom|width|height|margin|padding|inset)\b/);
  }
});
```

In `test/e2e/cover-view.spec.ts`, all with `noFullscreenApi` at 1440×900, where `rect` returns the cover's `getBoundingClientRect()` as `{ x, y, width, height }` and `settled` awaits `Promise.all(cover.getAnimations().map((a) => a.finished))`:

1. `the cover moves by transform`: before the click, record `start`; click; then the cover has exactly one running animation whose keyframes carry `transform`; `getComputedStyle(cover).transitionProperty` names none of `left`, `width`, `height`.
2. `it ends on the layout box`: after `settled`, the cover is the centered square from Task 3's test 2 and has no animations.
3. `toggling mid-way reverses from where the cover is`: click; wait 150 ms; record `mid` (its width is strictly between `start.width` and the final width); click; within the same task record `after`: each of x, y, width is within 2 px of `mid`. After `settled`, the rect equals `start` within 1 px.
4. `reduced motion: no animation`: with `emulateMedia({ reducedMotion: "reduce" })`, after the click the cover has 0 animations and is already on the final box.
5. `coming back, the lyrics are at the playing verse`: set the audio time to 4.6 s (the helper pattern from `player.spec.ts`: `document.querySelector("audio").currentTime = …`), enter and leave the cover view; then the verse with `data-state="active"` has its top between 20% and 40% of the column's height.
6. `the lyrics fade over the tokens`: `section.lyrics` has `transition-duration` containing `0.15s` in the cover view and `0.2s` outside it.

In `player.spec.ts`, replace "resizing keeps the lyrics column glued to the cover while they slide" with `resizing: the column stays glued to the cover, with no slide`: after `setViewportSize(1150, 900)` and one animation frame, the gap from the cover's right edge to the column's left edge is 56 px (±1), and neither element has a running animation or transition.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run test/unit/motion-css.test.ts; npm run build && npx playwright test test/e2e/cover-view.spec.ts --trace off`
Expected: FAIL (`left`, `width`, `height` transitions; no animation object).

- [ ] **Step 3: Implement `flip`** as in Interfaces. Keep the running animation per element in a `WeakMap<HTMLElement, Animation>`; measure the first box before cancelling it.

- [ ] **Step 4: Change `web/player/styles.css`**

- The cover is centered without transforms, so the FLIP is the only transform on it: wide `top: calc(50% - var(--cover) / 2); left: var(--group-left);`; cover view `top: calc(50% - var(--cover-off) / 2); left: calc(50% - var(--cover-off) / 2);`. Remove `transform: translateY(-50%)`, `translate(-50%, -50%)` and the cover's `transition`.
- Remove `left` from the wide `.lyrics` transition.
- Lyrics and translation group, wide: leaving `opacity var(--dur-exit) var(--ease-out), visibility 0s var(--dur-exit)`; returning `opacity var(--dur-base) var(--ease-out), visibility 0s`.

- [ ] **Step 5: Use it**: in `setCoverView`, wrap the `app.dataset.lyrics` write in `flip(cover, () => { … })`. After leaving the cover view, call the lyrics view's `update` with the current time so it follows at once.

- [ ] **Step 6: Run** `npm run typecheck && npm test && npm run test:e2e -- --trace off`. Expected: PASS.

- [ ] **Step 7: Commit** — `Move the cover with a FLIP when the view changes`

---

### Task 7: Toasts, dialog exits and the language menu

**Files:**
- Modify: `web/shared/dialog.ts`, `web/player/styles.css`, `web/upload/styles.css`
- Modify: `test/e2e/motion.spec.ts`

**Interfaces:**
- Consumes: `tokenMs` (Task 1).
- Produces: `openDialog` keeps its signature. After `close`, focus returns and the promise resolves at once; the element is removed when its exit transition ends, or after `tokenMs("--dur-exit") + 50` ms, and only if it is not open again.

- [ ] **Step 1: Write the failing tests** (append to `test/e2e/motion.spec.ts`)

```ts
const dialogState = (page: Page) =>
  page.evaluate(() => {
    const d = document.querySelector<HTMLDialogElement>("dialog.share-dialog");
    return d ? { open: d.open, shown: getComputedStyle(d).display !== "none" } : null;
  });

/** Stretches the exit so the test can look at the dialog while it leaves. */
const slowExit = (page: Page) => page.evaluate(() => document.documentElement.style.setProperty("--dur-exit", "1000ms"));

test("the share dialog plays an exit before it leaves the page", async ({ page, request }) => {
  await open(page, request);
  await page.locator("[data-share]").click();
  await expect(page.locator("dialog.share-dialog")).toBeVisible();
  await slowExit(page);
  await page.locator("dialog.share-dialog .share-close").click();
  expect(await dialogState(page)).toEqual({ open: false, shown: true }); // still drawn while it fades
  await expect(page.locator("[data-share]")).toBeFocused();
  await expect.poll(() => dialogState(page)).toBeNull();
});

test("reopening the dialog while it closes keeps it open", async ({ page, request }) => {
  await open(page, request);
  const share = page.locator("[data-share]");
  await share.click();
  await slowExit(page);
  await page.locator("dialog.share-dialog .share-close").click();
  await share.click(); // inside the 1 s exit
  await page.waitForTimeout(1500);
  expect(await dialogState(page)).toEqual({ open: true, shown: true });
});

test("reduced motion: the dialog leaves at once", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, request);
  await page.locator("[data-share]").click();
  await page.locator("dialog.share-dialog .share-close").click();
  await expect.poll(() => dialogState(page), { timeout: 300 }).toBeNull();
});

test("the toast enters over --dur-base and leaves over --dur-exit", async ({ page, request }) => {
  await open(page, request);
  const toast = page.locator("[data-toast]");
  expect(await toast.evaluate((e) => getComputedStyle(e).transitionDuration)).toContain("0.15s");
  await page.evaluate(() => document.querySelector("[data-toast]")!.classList.add("is-shown"));
  expect(await toast.evaluate((e) => getComputedStyle(e).transitionDuration)).toContain("0.2s");
});

test("the language menu grows from its button's corner", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, request);
  await page.locator("[data-translate]").click();
  await page.locator("[data-language]").click();
  const menu = page.locator(".language-menu");
  await expect(menu).toBeVisible();
  const origin = await menu.evaluate((e) => getComputedStyle(e).transformOrigin.split(" ").map(parseFloat));
  const width = (await menu.boundingBox())!.width;
  expect(origin[0]).toBeCloseTo(width, 0); // right
  expect(origin[1]).toBe(0);               // top
  await expect.poll(() => menu.evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npm run build && npx playwright test test/e2e/motion.spec.ts --trace off`
Expected: FAIL (the dialog is gone at once; durations are equal; origin is the center).

- [ ] **Step 3: Implement**

- `web/shared/dialog.ts`: as in Interfaces.
- Dialogs (`.dialog` in `web/upload/styles.css`, `.share-dialog` in `web/player/styles.css`): replace the `[open]` keyframe animations with transitions. Closed state: `opacity: 0; scale: .96;` and `transition: opacity var(--dur-exit) var(--ease-out), scale var(--dur-exit) var(--ease-out), overlay var(--dur-exit) allow-discrete, display var(--dur-exit) allow-discrete;`. Open state: `opacity: 1; scale: 1; transition-duration: var(--dur-base);`. Entry values in `@starting-style`. The same three for `::backdrop`, with opacity only. On phones the share sheet uses `translate: 0 100%` in place of the scale. Delete `@keyframes dialog-in`, `share-pop`, `share-fade`, `share-up` and the reduced-motion lines that only switched them off.
- Toast (both stylesheets): hidden state `opacity` and `transform` over `var(--dur-exit) var(--ease-out)`, `visibility 0s var(--dur-exit)`; `.is-shown` over `var(--dur-base)`, `visibility 0s`. The toast element is mounted at startup by `mountToast()`; if a page does not call it at startup, make it.
- `.language-menu`: `transform-origin: top right;` (stacked: `bottom left`). Shown: `opacity: 1; scale: 1;`, `transition: opacity var(--dur-exit) var(--ease-out), scale var(--dur-exit) var(--ease-out), display var(--dur-fast) allow-discrete;`. `[hidden]`: `display: none; opacity: 0; scale: .96; transition-duration: var(--dur-fast);`. Entry values in `@starting-style`.

- [ ] **Step 4: Run** `npm run typecheck && npm test && npm run test:e2e -- --trace off`. Expected: PASS. Existing share and sign-in dialog tests must pass unchanged.

- [ ] **Step 5: Commit** — `Give dialogs an exit; time toasts and the language menu from the tokens`

---

### Task 8: Home tiles and the slider handle

**Files:**
- Modify: `web/upload/styles.css`, `web/player/styles.css`, `web/player/main.ts`
- Modify: `test/e2e/motion.spec.ts`

**Interfaces:**
- Produces: sliders with class `range` carry `--fill-n` (a number from 0 to 1) next to the existing `--fill` percentage; `--thumb-scale` is `1` while the handle shows.

- [ ] **Step 1: Write the failing tests** (append to `test/e2e/motion.spec.ts`; the home helpers `upload` and `visit` are copied from `home.spec.ts`)

```ts
test("a home tile lifts its cover under the pointer and presses in", async ({ page, request }) => {
  const track = await upload(request, "Faixa do teste");
  await visit(page, track);
  await page.goto("/");
  const tile = page.locator("a[data-recent]").first();
  await tile.hover();
  await expect.poll(() => tile.locator(".home-cover > *").evaluate((e) => getComputedStyle(e).scale)).toBe("1.02");
  await page.mouse.down();
  await expect.poll(() => tile.evaluate((e) => getComputedStyle(e).scale)).toBe("0.98");
  await page.mouse.move(0, 0);
  await page.mouse.up();
});

test("the progress handle shows on hover, on focus and while dragging", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, request);
  const bar = page.locator("[data-progress]");
  const shown = () => bar.evaluate((e) => getComputedStyle(e).getPropertyValue("--thumb-scale").trim());
  expect(await shown()).toBe("0");
  await bar.hover();
  expect(await shown()).toBe("1");
  await page.mouse.move(0, 0);
  expect(await shown()).toBe("0");
  await bar.focus();
  await page.keyboard.press("ArrowRight"); // keyboard modality
  expect(await shown()).toBe("1");
});

test("the fill follows the handle's center", async ({ page, request }) => {
  await open(page, request);
  const bar = page.locator("[data-progress]");
  expect(await bar.evaluate((e) => getComputedStyle(e).getPropertyValue("--fill-n").trim())).toBe("0");
  await page.evaluate(() => { const a = document.querySelector("audio")!; a.currentTime = a.duration / 2; });
  await expect.poll(async () => Number(await bar.evaluate((e) => getComputedStyle(e).getPropertyValue("--fill-n")))).toBeCloseTo(0.5, 1);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npm run build && npx playwright test test/e2e/motion.spec.ts -g "home tile|progress handle|handle's center" --trace off`
Expected: FAIL.

- [ ] **Step 3: Implement**

- Tiles: `.home-cover > * { transition: scale var(--dur-base) var(--ease-out); }`; under `@media (hover: hover)`, `.home-tile:hover .home-cover > * { scale: 1.02; }`; `.home-tile { transition: scale var(--dur-fast) var(--ease-out); }` and `.home-tile:active { scale: .98; }`.
- Slider: `.range { --thumb: 12px; --thumb-scale: 0; --fill-n: 0; }`. The WebKit and Firefox thumbs become `width: var(--thumb); height: var(--thumb); border-radius: 50%; background: var(--bar-fill); scale: var(--thumb-scale); transition: scale var(--dur-fast) var(--ease-out);`, vertically centered on the track (`margin-top: calc((var(--bar) - var(--thumb)) / 2)` on WebKit). `--thumb-scale: 1` for `.range[data-dragging]`, `.range:active`, `.range:focus-visible`, and `.range:hover` under `@media (hover: hover)`.
- The WebKit track's gradient stops at the handle's center: `calc(var(--thumb) / 2 + (100% - var(--thumb)) * var(--fill-n))` in place of `var(--fill)`.
- `web/player/main.ts`: where `--fill` is set (position and volume), also set `--fill-n` to the same ratio as a plain number with four decimals at most.

- [ ] **Step 4: Run** `npm run typecheck && npm test && npm run test:e2e -- --trace off`. Expected: PASS ("progress slider has a 44 px hit target on phones" unchanged).

- [ ] **Step 5: Commit** — `Lift home tiles on hover; give the sliders a handle`

---

### Task 9: The page transition between home and player

**Files:**
- Modify: `web/shared/base.css`, `web/player/styles.css`, `web/upload/home.ts`, `server/lib/render.ts`, `server/app.ts`
- Create: `test/e2e/page-transition.spec.ts`
- Modify: the unit test file that covers `server/lib/render.ts` (create `test/unit/render.test.ts` if none exists)

**Interfaces:**
- Produces: `blockRendering(template: string): string` in `server/lib/render.ts` — adds `blocking="render"` to every `<script type="module"` tag that lacks it. `loadTemplates` in `server/app.ts` applies it to both templates.

- [ ] **Step 1: Write the failing tests**

Unit:

```ts
import { describe, expect, it } from "vitest";
import { blockRendering } from "../../server/lib/render.ts";

describe("blockRendering", () => {
  const tag = '<script type="module" crossorigin src="/assets/player-abc.js"></script>';
  it("marks the page's module script render-blocking", () => {
    expect(blockRendering(`<head>${tag}</head>`)).toBe('<head><script type="module" blocking="render" crossorigin src="/assets/player-abc.js"></script></head>');
  });
  it("is idempotent and leaves other scripts alone", () => {
    const data = '<script id="letra-data" type="application/json">{}</script>';
    const once = blockRendering(`${data}${tag}`);
    expect(blockRendering(once)).toBe(once);
    expect(once).toContain(data);
  });
});
```

Browser, `test/e2e/page-transition.spec.ts` (helpers `upload` and `visit` as in `home.spec.ts`):

```ts
/** Records, at the moment each page is first shown, whether a view transition runs and what it can pair. */
const record = (page: Page) =>
  page.addInitScript(() => {
    addEventListener("pagereveal", (e) => {
      const named = [...document.querySelectorAll<HTMLElement>("*")].filter((n) => getComputedStyle(n).getPropertyValue("view-transition-name") === "cover");
      (window as unknown as { __reveal: unknown }).__reveal = {
        transition: (e as unknown as { viewTransition: unknown }).viewTransition !== null,
        cover: document.querySelector("[data-cover]") !== null,
        named: named.length,
        namedId: named[0]?.closest("[data-id]")?.getAttribute("data-id") ?? null,
      };
    });
  });
const reveal = (page: Page) => page.evaluate(() => (window as unknown as { __reveal: Record<string, unknown> }).__reveal);
```

1. `home to player: the transition runs and the cover is there to pair`: seed two visited tracks A and B; `record`; `goto("/")`; click A's tile; on the player, `reveal` is `{ transition: true, cover: true, named: 1, namedId: null }`.
2. `player to home: the tile of the song we came from carries the name`: continuing, click `[data-home]`; on the home, `reveal` has `transition: true`, `named: 1`, `namedId: A.id`.
3. `picking another song after coming back still transitions`: continuing, click B's tile; on the player `transition: true`, `named: 1`. Then `page.goBack()`; on the home `named` is 1 (never 2).
4. `reduced motion: plain navigation`: with `emulateMedia({ reducedMotion: "reduce" })`, click a tile → the player loads and `reveal.transition` is false.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run test/unit/render.test.ts; npm run build && npx playwright test test/e2e/page-transition.spec.ts --trace off`
Expected: FAIL (`blockRendering` missing; `transition` false).

- [ ] **Step 3: Implement**

- `blockRendering`, and its use in `loadTemplates`.
- `web/shared/base.css`:

```css
@media (prefers-reduced-motion: no-preference) {
  @view-transition { navigation: auto; }
}
::view-transition-old(root), ::view-transition-new(root) { animation-duration: var(--dur-base); }
::view-transition-group(cover) { animation-duration: var(--dur-move); animation-timing-function: var(--ease-in-out); }
```

- `web/player/styles.css`: `.cover { view-transition-name: cover; }`.
- `web/upload/home.ts`: at most one tile cover carries `view-transition-name: cover`, set inline on its `.home-cover`:
  - on a tile's click, that tile (cleared from every other);
  - on each draw, the tile whose id is in the path of `navigation.activation?.from?.url ?? document.referrer` when that is a same-origin `/t/<id>`, unless a later click named another.

- [ ] **Step 4: Run** `npm run typecheck && npm test && npm run test:e2e -- --trace off`. Expected: PASS.

If test 1 or 2 cannot pass in Chromium with the render-blocking script (the cover or the tile is not in the page at `pagereveal`), do not add another mechanism. Keep the `@view-transition` rule and the root cross-fade, remove the `cover` names and tests 1 to 3's `cover`/`named` expectations, and report DONE_WITH_CONCERNS with what `reveal` showed. Spec §13 names this fallback.

- [ ] **Step 5: Commit** — `Carry the cover between the home and the player`

---

## Stage verification

After Task 9, before the pull request:

```bash
npm run typecheck && npm test && npm run test:e2e -- --trace off
bash scripts/docker-smoke.sh   # in the Claude sandbox: NODE_IMAGE=letra-node-ca bash scripts/docker-smoke.sh
```

and, from the repo root, `python3 validate_collection.py --root .`.

Capture for the owner, at device scale factor 2: the player at 1440×900 and 390×844 (lyrics view and cover view), and six frames, 80 ms apart, of entering the cover view at 1440×900.

Not covered by tests, to say plainly in the pull request: how the motion feels; VoiceOver on an iPhone; the page transition in Safari.
