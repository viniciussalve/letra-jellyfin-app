# letra: one navigation bar and lighter motion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put one navigation bar with the tabs "Início" and "Linhas salvas" on every screen, and make the app's motion lose no frames by removing the blurs that cost them and softening the curves.

**Architecture:** A shared module builds the bar for both front-end entries (upload and player); each screen passes which tab is current and its own actions. Motion is changed one suspect at a time, each kept only if a measuring script shows it helps.

**Tech Stack:** Vite 8 with vanilla TypeScript and CSS (`.ts` import specifiers), vitest (node, no DOM), Playwright 1.63 with the preinstalled Chromium.

**Spec:** `docs/superpowers/specs/2026-11-11-letra-navigation-and-motion-design.md`

## Decisions where the spec is silent

1. **The bar's look.** The wordmark as it is on the home today (22/28, 700). Tabs are text links, 15/20, 600, in `--text-2`; the current tab is `--text-1` with a 2 px underline 6 px under the text. 44 px tall targets, 20 px between tabs, 28 px between the wordmark and the first tab.
2. **Heading.** The wordmark stays the page's `h1` on the home and the owner view, as today; on `/salvas` and the player it is a plain `span`, since those pages have their own `h1`.
3. **`/salvas` account action.** It shows "Entrar" or "Sair" like the home. "Entrar" opens the same sign-in dialog; after signing in or out the page stays on `/salvas`.
4. **Owner view.** It keeps its own layout under the bar; "Início" is the current tab there, because the owner view is what `/` shows to the owner.
5. **Phones.** One row: wordmark, tabs, actions. The player has three actions and a language pill; under 480 px the wordmark hides on the player only when the row would overflow, tabs never do. The actions keep their 44 px targets.
6. **The measuring script** is committed under `app/scripts/` and is not part of CI.
7. **A change that does not help its number** is reverted in the same task and reported, not kept.

## Global Constraints

- Paths are relative to `app/`. Run npm commands from `app/`.
- No new dependencies.
- UI copy is pt-BR, exactly as quoted. Docs and comments in English.
- Text reaches the page only as text nodes.
- Motion: only `transform`, `translate`, `scale` and `opacity` move; colours may fade. Never `transition: all`. Every duration and easing is a token from `web/shared/tokens.css`. `prefers-reduced-motion: reduce` makes every change immediate.
- Accessibility floor: visible focus ring, 44 px touch targets, no horizontal scroll at 360 px.
- Tests: no network; Playwright with the preinstalled Chromium, `--trace off`, never `playwright install`; every spec imports `test` and `expect` from `test/e2e/helpers.ts`; no fixed sleeps; never loosen a test. An existing test changes only where this plan names the element it tested as removed or moved.
- Never commit `dist/`, `.data/`, `test-results/`, `playwright-report/`, `*.db` or the measuring script's output.
- Every commit message ends with the two attribution lines given in the task dispatch.

## Review Focus

1. **A long title in the player's actions or a long language name** must not push the tabs off a 360 px row. Task 7.
2. **Keyboard order**: the skip link, then the tabs, then the actions, on every screen. Tasks 5 and 7.
3. **The page transition between two pages that both have the bar**: the bar must not flicker or slide. Task 4 and Task 7.
4. **Reduced motion and more contrast** keep working with the new background. Task 2.
5. **A listener with saved lines on the home** still reaches `/salvas` when the section's link is gone. Task 5.

## File Structure

New: `web/shared/nav.ts`, `web/shared/nav.css`, `scripts/perf-motion.mjs`, `test/e2e/nav.spec.ts`.

Changed: `web/shared/background.css`, `web/shared/tokens.css`, `web/shared/base.css`, `web/player/styles.css`, `web/upload/styles.css`, `web/player/main.ts`, `web/player/save-line.ts`, `web/upload/home.ts`, `web/upload/main.ts`, `web/upload/saved-page.ts`, `web/upload/saved-section.ts`, `test/unit/motion-css.test.ts`, the specs that pointed at removed controls, `README.md`.

---

### Task 1: The measuring script and the numbers before

**Files:** Create `scripts/perf-motion.mjs`.

- [ ] **Step 1: Write the script.** It builds nothing itself; it expects `dist/web` built. It starts its own E2E server on port 4398 with the fake engine, uploads `song.mp3` twice, and in Chromium at 390×844 and at 1440×900, device scale 2, CPU throttled 4× (CDP `Emulation.setCPUThrottlingRate`), records with `requestAnimationFrame` timestamps:
  1. home → player: seed the recents, click the tile, record until the cover's transition ends;
  2. player → cover view → player (the full-screen button with the Fullscreen API removed);
  3. the lyrics following four verse changes (seek to 0.6, 2.6, 4.6, 6.6 s, waiting for each move to end).

  For each it prints frames, frames over 16.7 ms, frames over 33 ms and the longest frame, as a Markdown table, and with `--json <file>` writes the same numbers.
- [ ] **Step 2: Run it three times** on the code as it is and put the median table in the task report as "before".
- [ ] **Step 3: Commit** `Add a script that measures dropped frames in three interactions`.

### Task 2: A background with no live blur

**Files:** `web/shared/background.css`, `test/unit/motion-css.test.ts`, `test/e2e/player.spec.ts` (only where it reads the field's filter).

- [ ] **Step 1: Tests.** Unit: `the background field has no filter`. E2E: `the background drifts on transform alone` (its computed `filter` is `none` and it has a running animation whose only property is `transform`); `reduced motion stops the drift` and the more-contrast test stay green.
- [ ] **Step 2: Change** `.bg-field`: drop `filter: blur(48px)`; widen the four radial gradients so their edges are as soft as the blur made them (each gradient's ellipse about 1.5× and ending at `transparent 100%`); keep `inset: -30%`, the drift and `will-change: transform`.
- [ ] **Step 3: Measure** with the script (three runs) and compare the look in a screenshot pair before/after at both sizes; put both in the report. If the numbers do not improve, revert and report.
- [ ] **Step 4:** `npm run typecheck && npm test && npm run test:e2e`, then commit `Draw the background without a live blur`.

### Task 3: Verses and icons without blur

**Files:** `web/player/styles.css`, `web/upload/styles.css`, `web/player/lyrics-view.ts` (the `data-blur` attribute), `test/unit/motion-css.test.ts`, `test/e2e/player.spec.ts` (`inactive verses are dimmed, scaled and blurred by distance from the active one` becomes `…dimmed and scaled by distance…`, with the blur assertions replaced by `filter` is `none`).

- [ ] **Step 1: Tests.** Unit: `no blur on verses or icon swaps` (the stylesheets hold no `filter: blur` rule for `.verse` or `.icon`). E2E as named above; distance keeps showing: opacity steps .5, .4, .3 by distance 1, 2, 3+ (replacing the three blur levels).
- [ ] **Step 2: Change.** Remove the three `[data-blur]` filter rules and the `--blur-*` tokens' uses; map distance to opacity instead. Remove `filter: blur(2px)` from `.icon.is-entering, .icon.is-leaving` in both stylesheets.
- [ ] **Step 3: Measure** (three runs), report; revert if no gain.
- [ ] **Step 4:** full suite; commit `Show a verse's distance with opacity, not blur`.

### Task 4: One movement curve and a lighter page transition

**Files:** `web/shared/tokens.css`, `web/shared/base.css`, `web/player/styles.css`, `web/shared/motion.ts` (defaults), `test/unit/motion-css.test.ts`, `test/e2e/page-transition.spec.ts`, `test/e2e/cover-view.spec.ts` (only the easing strings they assert).

- [ ] **Step 1: Tests.** Unit: `--ease-move` is `cubic-bezier(.2, 0, 0, 1)` and is the easing of the cover's view-transition group, the cover-view FLIP default and the lyrics' follow. E2E: `the page transition moves the cover and fades the rest in 120 ms` (the root pseudo-elements' duration is `--dur-fast`; the cover group's is `--dur-move` with `--ease-move`).
- [ ] **Step 2: Change.** Add `--ease-move`; use it where `--ease-in-out` moved things (the token `--ease-in-out` stays for anything else that uses it). The root cross-fade takes `--dur-fast`. `.bg` gets `view-transition-name: backdrop` on both entries so the background is one shared element during the transition and not part of the root fade.
- [ ] **Step 3: Measure** (three runs), report.
- [ ] **Step 4:** full suite; commit `Use one curve for movement and fade the page change faster`.

### Task 5: The bar, on the home and on `/salvas`

**Files:** Create `web/shared/nav.ts`, `web/shared/nav.css`, `test/e2e/nav.spec.ts`. Modify `web/upload/home.ts`, `web/upload/saved-page.ts`, `web/upload/saved-section.ts`, `web/upload/main.ts` (only what `/salvas` needs for the account action), `web/upload/styles.css`, `web/upload/saved.css`, and the specs that used `[data-home]` on `/salvas` or the "Ver todas" link.

**Interfaces — Produces:**

```ts
// web/shared/nav.ts
export type NavCurrent = "home" | "saved" | null;
/** The app's one navigation bar: wordmark, the two tabs, then this screen's actions. */
export function navBar(o: { current: NavCurrent; actions?: Node[]; heading?: boolean }): HTMLElement;
```

Structure (hooks for the tests):

```
header.nav-bar[data-nav]
  h1.nav-wordmark | span.nav-wordmark        "letra"        (h1 when heading is true)
  nav[aria-label="Principal"]
    a.nav-tab[data-tab="home"][href="/"]           "Início"          aria-current="page" when current
    a.nav-tab[data-tab="saved"][href="/salvas"]    "Linhas salvas"
  div.nav-actions                                   the actions
```

- [ ] **Step 1: Tests** (`test/e2e/nav.spec.ts`):
  1. `the home has the bar with Início current`.
  2. `/salvas has the bar with Linhas salvas current and no house icon`.
  3. `the bar sits in the same place on the home and on /salvas` (wordmark and both tabs: same left and top, at 1440 and 390 wide).
  4. `the tabs are 44 px targets and the row does not scroll at 360 px`.
  5. `one click from the home reaches /salvas, with or without saved lines`.
  6. `the home's saved-lines section has no link of its own to the page` (the heading and the cards stay; `Ver todas` is gone).
  7. `/salvas shows Entrar to a listener and Sair to the owner; signing in there stays on /salvas`.
  8. `keyboard: the tabs come before the actions`.
- [ ] **Step 2:** see them fail; build `nav.ts`/`nav.css` and use them in the two screens. The space for the account action on `/salvas` is reserved until the session answers.
- [ ] **Step 3:** update the specs that pointed at the removed controls (`saved-page.spec.ts` `[data-home]` cases, `home-saved.spec.ts` "Ver todas" cases): each becomes the same claim through the tab, or is removed with its replacement in `nav.spec.ts` named in the report.
- [ ] **Step 4:** full suite; commit `Add the navigation bar to the home and the saved lines page`.

### Task 6: The bar on the owner view

**Files:** `web/upload/main.ts`, `web/upload/styles.css`, `test/e2e/nav.spec.ts`, `test/e2e/upload.spec.ts` (`owner view: a Linhas salvas pill beside Sair leads to the saved lines` becomes `owner view: the Linhas salvas tab leads to the saved lines`).

- [ ] **Step 1: Tests:** `the owner view has the bar with Início current and Sair at the right`; `the owner view has no Linhas salvas pill`; `the bar sits in the same place on the owner view as on the home`.
- [ ] **Step 2:** replace the `h1.brand` and `.owner-actions` with `navBar({ current: "home", actions: [leave], heading: true })`; keep the page's grid under it.
- [ ] **Step 3:** full suite; commit `Use the navigation bar on the owner view`.

### Task 7: The bar on the player

**Files:** `web/player/main.ts`, `web/player/styles.css`, `web/player/layout-order.ts`, `web/player/save-line.ts`, `test/e2e/nav.spec.ts`, and the player specs that used `[data-home]`.

- [ ] **Step 1: Tests:**
  1. `the player has the bar with neither tab current, and its actions at the right` (translate, language, share, full screen, in that order).
  2. `the player has no house icon; Início leads home and Linhas salvas leads to /salvas`.
  3. `the bar sits in the same place on the player as on the home` (tabs: same left and top at 1440; at 390 the tabs' top).
  4. `the not-found page has the bar`.
  5. `the cover view hides the bar and brings it back`.
  6. `keyboard on the player: skip link, Início, Linhas salvas, then the actions`.
  7. `at 360 px with a long language name the tabs stay on the row` (set the language pill's text to "Português (Brasil)"; no horizontal scroll; both tabs visible).
  8. `the first-save toast says "Linha salva. Elas ficam em Linhas salvas."`.
  9. `home → player: the bar does not move during the page transition` (the wordmark's box is the same before and after; the nav has its own `view-transition-name`).
- [ ] **Step 2:** build: `navBar({ current: null, actions: [translateGroup, share, fullscreen] })` replaces `.top-bar`; the phone layout's order (`layout-order.ts`) keeps Tab order equal to visual order; the toast's text changes in `save-line.ts`.
- [ ] **Step 3:** update the player specs that used the house icon to use the tab.
- [ ] **Step 4:** full suite; commit `Use the navigation bar on the player`.

### Task 8: Docs and the checks

**Files:** `README.md`.

- [ ] **Step 1:** README: one paragraph on the bar (the two tabs, where the screen's actions go) and one on `scripts/perf-motion.mjs` (what it measures, how to run it). Fix sentences that mention the house icon, "Ver todas" or the pill beside "Sair".
- [ ] **Step 2:** `npm run typecheck && npm test && npm run test:e2e`; `npx playwright test nav --trace off --repeat-each 5 --workers 2`; from the repository root `python3 validate_collection.py --root .`.
- [ ] **Step 3:** run the measuring script three times and put the final table next to Task 1's in the report.
- [ ] **Step 4:** commit `Document the navigation bar and the motion measurements`.

---

## Stage verification (the controller, after the last task)

- The full suite, the repeated run, the Docker smoke test.
- The before/after table of the measuring script in the pull request.
- Screenshots for the owner: the bar on the five screens at 1440 and 390 wide; the background before and after; a verse column before and after.
- The pull request says what was not checked: Safari, Firefox, the owner's own devices.
