# letra player v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the v2 player: TIDAL-style layout with the cover-tinted background and verse wipe kept, a share dialog (WhatsApp, Stories card, X, copy link, QR code), and a home at `/` that lists each listener's recently opened songs.

**Architecture:**

- **Server:** one public route, `GET /api/tracks/summary`.
- **Pure modules, tested in vitest:** history store, share links, QR SVG, text wrapping, Stories card layout.
- **DOM work, tested in Playwright:** the player layout, the lyrics behavior, the share dialog and the home.

The v1 structure stays: the `/` page serves the upload template and decides its view in the browser.

**Tech Stack:** Node 22, Fastify 5, Vite 8 with vanilla TypeScript, vitest 5 (node environment, no DOM), Playwright 1.63 (Chromium), `uqr` 0.1.3 (new), `jsqr` 1.4.0 (new, dev only).

**Spec:** `docs/superpowers/specs/2026-11-09-letra-player-v2-design.md` (v2). It amends `docs/superpowers/specs/2026-11-08-letra-web-player-design.md` (v1); v2 wins where they differ.

## Global Constraints

- **Paths:** every path is relative to `app/` unless it starts with `docs/`.
- **TypeScript:** Node 22 ESM, run by type stripping: erasable TypeScript only (no `enum`, `namespace` or parameter properties), and `.ts` extensions in imports.
- **UI copy:** pt-BR, verbatim from spec §10. The spec's English is for docs only.
- **Dependencies:** pinned exactly. Add `"uqr": "0.1.3"` to `dependencies` and `"jsqr": "1.4.0"` to `devDependencies`. Nothing else.
- **Tests:**
  - No network in tests. Unit tests run in vitest's `node` environment (no DOM); DOM behavior is tested in Playwright.
  - Never skip, disable or loosen an existing test to get green. Update selectors only where this plan changes the markup.
- **Never commit** `dist/`, `.data/`, `test-results/`, `playwright-report/` or `*.db`.
- **Third-party assets:** none of TIDAL's or Apple's (names, logos, fonts, icons). Icons are Phosphor fill.
- **Kept from v1:** the accessibility floor (2 px white focus ring with a dark outer ring, hit targets at least 44 px, no horizontal scroll at 360 px wide, reduced motion and reduced transparency respected).
- **Checks before each commit:**

  ```bash
  cd app && npm run typecheck && npm test
  ```

  ```bash
  python3 validate_collection.py --root .
  ```

  The validator runs from the repo root and must stay green.
- **Every commit message ends with:**

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GJTMuQwCZCPkHBVf6YK4Ji
  ```

- **E2E runs:**

  ```bash
  cd app && npm run test:e2e -- <spec file>
  ```

  It builds first. The E2E server trusts `X-Forwarded-For` from loopback (`helpers.randomIp()`). The LRCLIB stub in `test/e2e/server.ts` is keyed by track title.

## Review Focus

Inputs the spec implies but no feature test would hit. Each has a test in the task that owns the code:

1. **Very long titles and artists:** 200 characters, or one unbroken word. Expect ellipses, no horizontal scroll at 360 px, and a share dialog header that does not overflow. Tests: Task 3 (layout at 360 px with a 200-character title) and Task 6 (`wrapLines` with a 200-character word).
2. **Blocked or corrupt storage:** private windows and full quota. Expect the player to work, the home to show its empty state, and no exception to escape. Tests: Task 2 (`recents` with a throwing storage and with malformed JSON).
3. **Tracks without a cover:** expect the QR center tile, the card tile and the home tile instead of a broken image, and a QR that still decodes. Tests: Task 6 (layout with `coverUrl: null`) and Task 7 (dialog on a coverless upload, QR decodes).
4. **CJK verses on the card:** Japanese has no spaces, so wrapping must break by characters and stay within the width. Test: Task 6.
5. **No verse to show:** unsynced, no lyrics, instrumental, or a dots row active. The card has no verse block and the Stories button still works. Tests: Task 6 (layout with `verse: null`) and Task 7 (Stories on an instrumental upload).

---

### Task 1: Public track summaries route

**Files:**

- Modify: `shared/types.ts`, `server/routes/tracks.ts`, `web/shared/api.ts`
- Create: `test/api/summary.test.ts`

**Interfaces:**

- Consumes: `app.db.tracks.get(id): Track | null`; the plugin-level rate-limit `keyGenerator` (it already keys on `CLIENT_IP_HEADER` and then `req.ip`); `AppError`.
- Produces:
  - `type TrackSummary = { id: string; title: string; artist: string; hasCover: boolean; palette: Palette; durationMs: number }` in `shared/types.ts`.
  - `GET /api/tracks/summary?ids=a,b` returns `{ tracks: TrackSummary[] }`.
  - `getSummaries(ids: string[]): Promise<TrackSummary[]>` in `web/shared/api.ts`. It returns `[]` without a request when `ids` is empty.

- [ ] **Step 1: Write the failing API tests** in `test/api/summary.test.ts`, using `makeApp` from `test/api/helpers.ts` and uploading two tracks with the owner cookie the way `tracks.test.ts` does.

  Tests:

  - **`returns summaries in request order and drops unknown ids`:**
    - Request `ids=<b>,<a>,ZZZZZZZZZZ` without a cookie.
    - Expect status 200, `tracks.map(t => t.id)` equal to `[b, a]`, and each item's keys exactly `["artist","durationMs","hasCover","id","palette","title"]` once sorted.
    - Expect `cache-control` to be `no-store`.
  - **`collapses duplicate ids`:** `ids=<a>,<a>` returns one track.
  - **`rejects bad input`:** each of `ids=` (empty), no `ids`, 51 valid-looking ids, and `ids=abc` gets 400 with `{ error: { code: "bad_request", message: "Pedido inválido. Confira os dados e tente de novo." } }`.
  - **`limits each client to 60 requests a minute`:** with `CLIENT_IP_HEADER: "x-real-ip"`, 60 requests from `203.0.113.9` get 200, the 61st gets 429, and a request from `203.0.113.10` gets 200.

- [ ] **Step 2: Run it and see it fail.**

  ```bash
  cd app && npx vitest run test/api/summary.test.ts
  ```

  Expected: FAIL (404 on the route).

- [ ] **Step 3: Implement the route** in `server/routes/tracks.ts`, outside the owner scope.

  - Query parsing: split `ids` on `,`, trim, dedupe and keep the first-seen order. Each id must match `/^[0-9A-Za-z]{10}$/`, with 1 to 50 ids.
  - Errors: throw `new AppError(400, "bad_request", "Pedido inválido. Confira os dados e tente de novo.")`.
  - Rate limit: `config: { rateLimit: { max: 60, timeWindow: "1 minute" } }`. It reuses the 429 handling the global error handler already has.
  - Response: set `Cache-Control: no-store`.
  - Add `TrackSummary` to `shared/types.ts` and `getSummaries` to `web/shared/api.ts`. The client function builds `ids` with `encodeURIComponent` and returns `body.tracks`.

- [ ] **Step 4: Run the tests and the suite.**

  ```bash
  cd app && npx vitest run test/api/summary.test.ts && npm run typecheck && npm test
  ```

  Expected: PASS.

- [ ] **Step 5: Commit**, with the message "Add GET /api/tracks/summary for listener homes".

### Task 2: Shared groundwork: toast, dialog, history store, icons

**Files:**

- Create: `web/shared/toast.ts`, `web/shared/dialog.ts`, `web/shared/recents.ts`, `test/unit/recents.test.ts`
- Modify: `web/upload/dialogs.ts` (import and re-export the moved helpers so existing importers keep working), `web/shared/icons.ts`

**Interfaces:**

- **Moved unchanged out of `web/upload/dialogs.ts`:**
  - `web/shared/toast.ts`: `mountToast(): HTMLDivElement`, `toast(content: string | Node, ms?: number): void`, `copyText(text: string): Promise<boolean>`, `copyLink(url: string): Promise<void>`.
  - `web/shared/dialog.ts`: `openDialog(dialog: HTMLDialogElement, initial: HTMLElement, fallback?: () => HTMLElement | null): Promise<string>`, now exported.
- **`web/shared/recents.ts`:**
  - `type Recent = { id: string; title: string; artist: string; hasCover: boolean; at: number }`
  - `const RECENTS_KEY = "letra.recents.v1"`, `const RECENTS_MAX = 50`
  - `type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">`
  - `defaultStore(): KeyValueStore | null`: `window.localStorage`, or `null` when touching it throws.
  - `readRecents(store?: KeyValueStore | null): Recent[]`
  - `recordVisit(track: Pick<Recent, "id" | "title" | "artist" | "hasCover">, now?: number, store?: KeyValueStore | null): Recent[]`: returns the new list.
  - `mergeSummaries(list: Recent[], summaries: TrackSummary[]): Recent[]`: keeps list order and `at`, drops ids absent from `summaries`, updates `title`, `artist` and `hasCover`.
  - `saveRecents(list: Recent[], store?: KeyValueStore | null): void`, `clearRecents(store?: KeyValueStore | null): void`
  - Every function swallows store exceptions; a store that throws reads as `[]`.
- **`IconName` gains** `"house" | "whatsapp-logo" | "instagram-logo" | "x-logo"`, imported from `@phosphor-icons/core/assets/fill/<name>-fill.svg?raw`.

- [ ] **Step 1: Write the failing unit tests** in `test/unit/recents.test.ts`, with an in-memory `KeyValueStore` fake and a throwing fake.

  Tests:

  - **`records newest first and moves a repeat to the front`:** visits a@1, b@2, then a@3 give ids `["a","b"]`, with a's `at` equal to 3.
  - **`keeps at most 50`:** after 51 visits, the length is 50 and the oldest is gone.
  - **`refreshes title, artist and hasCover on a repeat visit`.**
  - **`reads malformed JSON as empty`:** stored `"{not json"` gives `[]`. Also `[{"id":1}]` gives `[]`; entries with the wrong field types are dropped.
  - **`a throwing store reads empty and never throws`:** `readRecents`, `recordVisit`, `saveRecents` and `clearRecents` with the throwing fake: no exception, reads `[]`.
  - **`mergeSummaries drops deleted ids, updates fields, keeps order and at`.**
  - **`uses the key letra.recents.v1`.**

- [ ] **Step 2: Run it and see it fail.**

  ```bash
  cd app && npx vitest run test/unit/recents.test.ts
  ```

  Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `recents.ts`, move the toast and dialog helpers, and add the icons.

  `web/upload/dialogs.ts` re-exports `toast`, `mountToast`, `copyText` and `copyLink` from `../shared/toast.ts`, and uses `openDialog` from `../shared/dialog.ts`.

- [ ] **Step 4: Run the suite and the existing E2E upload spec** (the moved helpers must behave the same).

  ```bash
  cd app && npm run typecheck && npm test && npm run test:e2e -- upload.spec.ts
  ```

  Expected: PASS.

- [ ] **Step 5: Commit**, with the message "Share toast and dialog helpers; add the listener history store".

### Task 3: Player layout and tokens (spec §4 Tokens, Type, Layout)

**Files:**

- Modify: `web/shared/tokens.css`, `web/shared/base.css`, `web/shared/background.css`, `web/player/main.ts`, `web/player/styles.css`
- Test: `test/e2e/player.spec.ts` (update and extend)

**Interfaces:**

- Consumes: `IconName` `"house"` (Task 2).
- Produces the player markup later tasks rely on:
  - `a.glass-btn[data-home][href="/"][aria-label="Início"]` in the top bar.
  - `button[data-lyrics-toggle]`: now a text pill reading "Letra", with `aria-pressed` and `aria-label` "Mostrar ou ocultar a letra".
  - `button[data-share]`, still wired to the old `mountShare` until Task 7.
  - `header.top-bar` holds the home button on the left; on the right, `[data-translate]`, `[data-language]`, `[data-lyrics-toggle]`, `[data-share]` and `[data-fullscreen]`.
  - `footer.bottom-bar` holds `.now` (title and artist), `.transport-area` (the transport and `.progress-row`: elapsed, `[data-progress]`, remaining) and `.volume`.
  - `.stage` holds `[data-cover]` and the lyrics `section.lyrics`.
  - Existing data attributes keep their names.

- [ ] **Step 1: Write the failing E2E tests** in `test/e2e/player.spec.ts`, against a track uploaded with `helpers.uploadFixture`.

  Tests:

  - **`wide layout: cover left, lyrics beside it, bottom bar` (1440×900):**
    - `[data-cover]` is square with a width of at most 426;
    - `section.lyrics` starts to the right of the cover's right edge, with a width of at most 440;
    - `footer.bottom-bar` is at the bottom with a height of 96;
    - `[data-home]` has `href="/"`.
  - **`phone layout` (390×844):** header with home, a 48 px cover and share; the progress bar sits above the transport; `[data-lyrics-toggle]` has the text "Letra".
  - **`no horizontal scroll at 360 px with a 200-character title`:**
    - Rename the track through `PATCH /api/tracks/:id` with `"T".repeat(200)` as the title.
    - Then `document.documentElement.scrollWidth <= 360`, and the bottom-bar title has `text-overflow: ellipsis`.
  - **`lyrics pill toggles`:** clicking `[data-lyrics-toggle]` flips `aria-pressed`, and the computed background turns white (`rgb(255, 255, 255)`) when on.
  - **`page background is veiled`:** `body` background color `rgb(0, 0, 0)`, and the veil layer's opacity or color matches `--veil` (`rgba(0, 0, 0, 0.55)`).
  - Update the existing tests' selectors only where the markup moved.

- [ ] **Step 2: Run them and see the new ones fail.**

  ```bash
  cd app && npm run test:e2e -- player.spec.ts
  ```

  Expected: the new tests FAIL.

- [ ] **Step 3: Implement.**

  - **Tokens:** copy the spec §4 token block into `tokens.css`. Remove `--text-verse-dim` and the glass-blur tokens. Keep the focus ring, `--danger` and the reduced-transparency fallbacks.
  - **Font:** in `base.css`, import `@fontsource-variable/inter/opsz.css` instead of the package root, and add `font-optical-sizing: auto`.
  - **Veil:** in `background.css`, add a `--veil` layer over `.bg-field`.
  - **Markup:** restructure `renderPlayer` in `main.ts` to the markup above. Behavior, keyboard shortcuts and Media Session stay as they are.
  - **CSS:** rewrite `web/player/styles.css` to the spec §4 Layout values:
    - cover `min(426px, 30vw, calc(100vh - 260px))`, 72 px from the left, `--radius-cover`;
    - lyrics `min(440px, 34vw)`, 72 px after the cover, with a 64 px top and bottom fade (`mask-image`) and 184 px of bottom padding;
    - top bar 64 px; bottom bar 96 px; progress `min(560px, 40vw)` with `--bar-height`, growing to 6 px while hovered or dragged;
    - lyrics off: the cover centered at `min(480px, 50vh)`;
    - phones below 640 px, and tablets from 640 to 1023 px with a 64 px cover and the wide verse size;
    - type sizes from the spec §4 Type table.

- [ ] **Step 4: Run the player, translation and full E2E specs.**

  ```bash
  cd app && npm run test:e2e -- player.spec.ts translation.spec.ts translation-off.spec.ts && npm run typecheck && npm test
  ```

  Expected: PASS.

- [ ] **Step 5: Commit**, with the message "Restyle the player after TIDAL's now-playing view".

### Task 4: Lyrics behavior: dim and scale, intro dots, current verse (spec §4 Lyrics behavior)

**Files:**

- Modify: `web/player/timing.ts`, `web/player/lyrics-view.ts`, `web/player/styles.css`
- Modify: `test/unit/timing.test.ts`, `test/e2e/server.ts` (add a stub record), `test/e2e/player.spec.ts`

**Interfaces:**

- Produces:
  - In `timing.ts`: `INTRO_MIN_MS = 3000` and `hasIntro(lines: Line[]): boolean`. It is true when the first line with a non-null `t` and non-blank text starts at `INTRO_MIN_MS` or later.
  - `LyricsView` gains `current(): { verse: string | null; translation: string | null }`. It returns the active verse's text and its shown translation line. It returns `{ verse: null, translation: null }` when lyrics are unsynced, none or instrumental, when nothing is active yet, or when the intro row or a break is active.
  - Markup:
    - `.verse` elements keep `data-state="past|active|future"`.
    - The intro row is `div.verse.is-dots[data-intro][aria-hidden="true"]` holding three `i.dot` elements; it is the list's first child, and it is "active" from 0 ms until the first verse.
    - Breaks also render as `.is-dots` with three `i.dot` elements, replacing the `"•••"` text.

- [ ] **Step 1: Write the failing tests.**

  - **Unit, in `timing.test.ts`:**
    - `hasIntro` is false when the first verse is at 2999 and true at 3000.
    - A leading blank line or a `t: null` line is skipped when finding the first verse.
  - **E2E stub:** in `test/e2e/server.ts`, add a record for the title "Intro Longa" with `syncedLyrics` `["[00:04.00]Primeiro verso depois da introdução", "[00:06.00]Segundo verso"].join("\n")`.
  - **E2E, in `player.spec.ts`:**
    - **`intro dots before the first verse`:** upload `"Letra Fixtures - Sem Tags.mp3"` as `"Letra Fixtures - Intro Longa.mp3"`. `[data-intro]` is visible with `data-state="active"`, and 3 `i.dot` elements, before playing.
    - **`inactive verses are dimmed and scaled, not blurred`:** for a future verse, the computed `opacity` is `"0.55"`, the `transform` matrix scale is 0.9, and `filter` is `"none"`.
    - **`clicking a verse seeks`:** kept from v1; still passes.
    - **`reduced motion`:** with `page.emulateMedia({ reducedMotion: "reduce" })`, a future verse has no `transform` (`"none"`) and the dots have `animation-name: none`.

- [ ] **Step 2: Run them and see them fail.**

  ```bash
  cd app && npx vitest run test/unit/timing.test.ts
  ```

  ```bash
  cd app && npm run test:e2e -- player.spec.ts
  ```

  Expected: the new tests FAIL.

- [ ] **Step 3: Implement.**

  - **`hasIntro`.**
  - **The intro row:** built when `hasIntro(lines)`. Its active span runs from 0 to the first verse's `t`.
  - **Breaks:** rendered with the shared dots element.
  - **`current()`:** reads `active` and the translation span under it.
  - **Remove the cascade:** drop `CASCADE_MS` and `CASCADE_MAX_STEPS` and the per-verse delay. Keep the 500 ms FLIP scroll to 30%.
  - **Remove the blur:** drop the blur, the `in-view` observer and their CSS.
  - **CSS, with the spec values:**
    - inactive verses: `opacity: var(--verse-dim-opacity)` and `transform: scale(var(--verse-dim-scale))` from the left;
    - transitions: `var(--lyrics-duration) var(--lyrics-ease)`, with `--lyrics-dim-delay` on dimming only;
    - mouse hover on an inactive verse: opacity 0.8;
    - the wipe's unsung part: `--verse-unsung`;
    - dots: 0.3em circles pulsing on a 1.6 s ease-in-out loop, with 0.2 s and 0.4 s delays;
    - reduced motion: no transform, no animation and no wipe;
    - reduced transparency or `prefers-contrast: more`: inactive verses at 0.7.

- [ ] **Step 4: Run the tests again.**

  ```bash
  cd app && npx vitest run test/unit/timing.test.ts && npm run test:e2e -- player.spec.ts translation.spec.ts && npm run typecheck && npm test
  ```

  Expected: PASS.

- [ ] **Step 5: Commit**, with the message "Dim and scale inactive verses, add intro dots, drop blur and cascade".

### Task 5: QR code and share links (pure modules)

**Files:**

- Create: `web/player/qr.ts`, `web/player/share-links.ts`, `test/unit/qr.test.ts`, `test/unit/share-links.test.ts`
- Modify: `package.json`, `package-lock.json` (add `uqr` 0.1.3 with `npm install --save-exact uqr@0.1.3`)

**Interfaces:**

- **`share-links.ts`** (the input type is `type ShareTarget = { title: string; artist: string; shareUrl: string }`):
  - `shareText(t: ShareTarget): string` returns `${title} — ${artist}`.
  - `whatsappUrl(t: ShareTarget): string` returns `https://wa.me/?text=` + `encodeURIComponent(shareText(t) + "\n" + t.shareUrl)`.
  - `xUrl(t: ShareTarget): string` returns `https://x.com/intent/tweet?text=` + `encodeURIComponent(shareText(t))` + `&url=` + `encodeURIComponent(t.shareUrl)`.
- **`qr.ts`:**
  - `qrMatrix(text: string): boolean[][]`: `encode(text, { ecc: "H", border: 0 }).data` from `uqr`.
  - `qrSvg(text: string, opts?: { size?: number; centerFraction?: number; centerMarginPx?: number }): string`. The defaults are `size` 240, `centerFraction` 0.22 and `centerMarginPx` 6. It returns SVG markup with a `viewBox`, white background and no border:
    - each dark module outside the finder patterns and outside the center box is a `<circle>` with radius `0.41 × module` (82% of the module size), `fill="#000"`;
    - each of the three finder patterns is two rounded `<rect>` elements (a 7×7 ring drawn as a stroked rect, and a 3×3 inner block), with `rx` at 30% of their side;
    - the center box, `centerFraction × size + 2 × centerMarginPx` wide, is left empty.
  - `qrCenterBox(size: number, centerFraction?: number, centerMarginPx?: number): { x: number; y: number; width: number }`: the cleared square in SVG units, which the dialog uses to place the cover.

- [ ] **Step 1: Write the failing unit tests.**

  - **`share-links`:**
    - With title `Ação & "Reação"`, artist `Zé`, and URL `https://x.y/t/AbC123defG`:
      - `whatsappUrl` decodes back (`decodeURIComponent` of the `text` param) to `Ação & "Reação" — Zé\nhttps://x.y/t/AbC123defG`;
      - `xUrl`'s `URL.searchParams` give `text` and `url` exactly.
    - A newline in a title survives the round trip.
  - **`qr`:**
    - `qrMatrix` of a 48-character URL is square, at least 25×25, and has its finder corners dark at `[0][0]`, `[0][n-1]` and `[n-1][0]`.
    - `qrSvg` output contains exactly 6 finder `rect` elements, and no `circle` whose center is inside `qrCenterBox(240)`.
    - Every circle's radius equals `0.41 × (240 / n)`, within 1e-6.
    - `qrSvg` starts with `<svg` and contains `viewBox="0 0 240 240"`.

- [ ] **Step 2: Run them and see them fail.**

  ```bash
  cd app && npx vitest run test/unit/qr.test.ts test/unit/share-links.test.ts
  ```

  Expected: FAIL.

- [ ] **Step 3: Install `uqr` and implement both modules.**

- [ ] **Step 4: Run them again with the suite.**

  ```bash
  cd app && npx vitest run test/unit/qr.test.ts test/unit/share-links.test.ts && npm run typecheck && npm test
  ```

  Expected: PASS.

- [ ] **Step 5: Commit**, with the message "Add QR SVG and share link builders".

### Task 6: Stories card: wrapping, layout, drawing (spec §6)

**Files:**

- Create: `web/shared/wrap.ts`, `web/player/story-card.ts`, `test/unit/wrap.test.ts`, `test/unit/story-card.test.ts`

**Interfaces:**

- **`wrap.ts`:** `wrapLines(text: string, maxWidth: number, measure: (s: string) => number, maxLines: number): string[]`.
  - It breaks at spaces.
  - A word wider than `maxWidth` alone is broken by characters; this also covers CJK runs with no spaces.
  - When the text overflows `maxLines`, the last line is trimmed until `line + "…"` fits, then gets `"…"`.
- **`story-card.ts`:**
  - `type StoryData = { title: string; artist: string; palette: Palette; coverUrl: string | null; verse: string | null; translation: string | null }`
  - `STORY`: frozen constants from spec §6.
    - Canvas: `width 1080`, `height 1920`, safe area `safeTop 220` and `safeBottom 1700`.
    - Cover: `cover 680`, `coverTop 260`.
    - Title: `titleY 1010`, `titleFont "700 56px"`, `titleLine 64`.
    - Artist: `artistFont "500 44px"`, `artistLine 52`, `artistColor "#D0D0D6"`.
    - Verse: `verseY 1170`, `verseFont "700 64px"`, `verseLine 76`, `verseMax 4`.
    - Translation: `transFont "700 44px"`, `transLine 56`, `transMax 3`, `transAlpha 0.75`.
    - Wordmark: `wordmarkY 1640`, `wordmarkFont "700 36px"`, `wordmarkAlpha 0.6`.
    - Other values: `veil 0.45`, `textWidth 920`.
  - `type StoryLayout = { title: string; artist: string; verseLines: string[]; translationLines: string[] }`
  - `layoutStoryCard(data: StoryData, measure: (text: string, font: string) => number): StoryLayout`:
    - title and artist cut to one line with an ellipsis;
    - verse at most 4 lines and translation at most 3, at `textWidth`;
    - an empty verse or translation gives `[]`.
  - `drawStoryCard(ctx: CanvasRenderingContext2D, data: StoryData, cover: CanvasImageSource | null): void`. It paints, from back to front:
    - the palette as four radial gradients over the darkest color, then the veil;
    - the cover with its shadow, or the music-note tile when there is no cover;
    - the texts;
    - the wordmark "letra".
  - `makeStoryCard(data: StoryData, fileName: string): Promise<File>`:
    - It awaits `document.fonts.load` for `500 44px "Inter Variable"` and `700 64px "Inter Variable"`.
    - It loads the cover (same origin), draws on a 1080×1920 canvas and returns `toBlob("image/png")` as a `File` named `fileName`.
    - It rejects when the cover fails to load or the blob is null.

- [ ] **Step 1: Write the failing unit tests**, with `measure = (s) => s.length * 10`, so each character is 10 units.

  Tests:

  - **`wrapLines breaks at spaces`:** `"aaa bbb ccc"`, width 70, maxLines 3 gives `["aaa bbb", "ccc"]`.
  - **`ellipsis on the last allowed line`:** 3 lines of overflow with maxLines 2: the last line ends with `"…"` and fits the width.
  - **`a 200-character word breaks by characters`:** every line is at most the width, and the joined lines without `"…"` start with the word's prefix.
  - **`Japanese without spaces wraps within the width`:** `"夜空に浮かぶ星のように君を想う"` at width 60: every line measures at most 60.
  - **`layoutStoryCard`:**
    - With `verse: null`, `verseLines` and `translationLines` are `[]`.
    - With a verse and a translation, both are non-empty and capped at 4 and 3 lines.
    - `coverUrl: null` does not change the text layout.
    - A 200-character title gives one line ending with `"…"`.

- [ ] **Step 2: Run them and see them fail.**

  ```bash
  cd app && npx vitest run test/unit/wrap.test.ts test/unit/story-card.test.ts
  ```

  Expected: FAIL.

- [ ] **Step 3: Implement** `wrapLines`, `layoutStoryCard`, `drawStoryCard` and `makeStoryCard`. Drawing and canvas export are exercised in Task 7's E2E.

- [ ] **Step 4: Run them again with the suite.**

  ```bash
  cd app && npx vitest run test/unit/wrap.test.ts test/unit/story-card.test.ts && npm run typecheck && npm test
  ```

  Expected: PASS.

- [ ] **Step 5: Commit**, with the message "Add the Stories card layout and renderer".

### Task 7: Share dialog (spec §5, §6 behavior)

**Files:**

- Create: `web/player/share-dialog.ts`, `test/e2e/share.spec.ts`
- Delete: `web/player/share.ts`
- Modify: `web/player/main.ts`, `web/player/styles.css`, `package.json` and `package-lock.json` (add `jsqr` 1.4.0 to `devDependencies`, exact)

**Interfaces:**

- Consumes:
  - `openDialog` and `toast`/`copyText` (Task 2);
  - `qrSvg` and `qrCenterBox` (Task 5);
  - `shareText`, `whatsappUrl` and `xUrl` (Task 5);
  - `makeStoryCard` and `StoryData` (Task 6);
  - `LyricsView.current()` (Task 4).
- Produces `mountShareDialog(button: HTMLButtonElement, track: TrackDTO, view: Pick<LyricsView, "current">): void`, plus this markup:
  - `dialog[data-share-dialog]`, labelled by its title element;
  - `[data-share-qr]`, which wraps the SVG and the center cover;
  - `a[data-share-action="whatsapp"]` and `a[data-share-action="x"]`, both with `target="_blank" rel="noopener"`;
  - `button[data-share-action="stories"]`, `button[data-share-action="copy"]`, and `button[data-share-action="more"]` (the last absent when `navigator.share` is not a function);
  - `button[data-share-close]`.

- [ ] **Step 1: Write the failing E2E tests** in `test/e2e/share.spec.ts`. On desktop Chromium, `navigator.share` is undefined, so "Mais…" is absent.

  Tests:

  - **`opens from the share button and closes with Esc, returning focus`.**
  - **`header shows title and artist; the dialog's accessible name is the title`.**
  - **`WhatsApp and X links are exact`:** compare each `href` with the `whatsappUrl` and `xUrl` formula built in the test from the track DTO.
  - **`copy link shows the toast`:** grant clipboard permissions; the toast text is "Link copiado", and `navigator.clipboard.readText()` equals `shareUrl`.
  - **`the QR decodes to the share URL`:**
    - Screenshot `[data-share-qr]`.
    - Decode the PNG with `jsqr`: read the pixels with `sharp(buffer).ensureAlpha().raw()`, since sharp is already a dependency.
    - The result equals `shareUrl`.
    - Run it for a covered track and for a coverless upload.
  - **`Stories downloads a 1080×1920 PNG on desktop`:**
    - Wait for the button to be enabled, then click it inside `page.waitForEvent("download")`.
    - The suggested name is `letra-<id>.png`; `sharp(file).metadata()` gives width 1080, height 1920 and format png.
    - The toast reads "Imagem salva. Poste nos Stories pelo celular."
    - Run it also for an instrumental upload (`"Letra Fixtures - Instrumental Teste.mp3"`).
  - **`the old header share sheet is gone`:** there is exactly one `[data-share]` button and it opens the dialog.
  - **`phone renders the dialog as a bottom sheet`** (390×844): the dialog's bottom edge equals the viewport height, and its width equals the viewport width.

- [ ] **Step 2: Run them and see them fail.**

  ```bash
  cd app && npm run test:e2e -- share.spec.ts
  ```

  Expected: FAIL.

- [ ] **Step 3: Implement `share-dialog.ts`** with the spec §5 markup and CSS.

  - **Opening:**
    - Read `view.current()`, then start `makeStoryCard` with `{ ..., verse, translation }` and `fileName` `letra-${track.id}.png`.
    - Disable the Stories button and set `aria-busy` until the card is ready.
    - On rejection, keep the button enabled. A click then shows "Não deu para gerar a imagem. Tente de novo." and retries the build.
  - **Stories click:**
    - Call `void copyText(shareUrl)`, without awaiting it.
    - If `navigator.canShare?.({ files: [file] })`, await `navigator.share({ files: [file] })` and show "Link copiado. Adicione o adesivo de link no Instagram."; ignore `AbortError`.
    - Otherwise, download through an object-URL anchor with `download=letra-<id>.png` and show "Imagem salva. Poste nos Stories pelo celular."
  - **Copy link:** v1's `copyLink` behavior.
  - **Mais…:** `navigator.share({ title, text: shareText(track), url })`; ignore `AbortError`.
  - **QR:** `[data-share-qr]` holds the white square (radius 20, padding 20) with `qrSvg(shareUrl)`. Over it, at `qrCenterBox`, sits the cover image (radius 8) or the music-note tile on `--mesh-1`.
  - **Wiring:** in `main.ts`, replace `mountShare` with `mountShareDialog(share, track, view)` and delete `share.ts`.

- [ ] **Step 4: Run the share spec and the full E2E suite.**

  ```bash
  cd app && npm run test:e2e && npm run typecheck && npm test
  ```

  Expected: PASS.

- [ ] **Step 5: Commit**, with the message "Add the share dialog with QR code and Stories card".

### Task 8: Listener home, sign-in dialog, visit recording (spec §7)

**Files:**

- Create: `web/upload/home.ts`, `test/e2e/home.spec.ts`
- Modify: `web/upload/main.ts`, `web/upload/login.ts`, `web/upload/styles.css`, `web/player/main.ts`
- Modify: `test/e2e/upload.spec.ts` (sign in through the dialog), `test/e2e/helpers.ts` (add a helper if one makes UI sign-in shorter)

**Interfaces:**

- Consumes: `readRecents`, `recordVisit`, `mergeSummaries`, `saveRecents` and `clearRecents` (Task 2); `getSummaries` (Task 1); `openDialog` and `toast` (Task 2).
- Produces:
  - `renderHome(app: HTMLElement, opts: { onSignedIn(): void }): void` in `home.ts`.
  - `openSignIn(onSignedIn: () => void): void` in `login.ts`. It replaces `renderLogin` and keeps its copy, error message and focus behavior.
  - Markup:
    - `[data-home-view]`, with `[data-sign-in]` (the "Entrar" pill) and `h1` "Ouvidas recentemente";
    - `[data-clear-recents]`, present only when the list is not empty;
    - `[data-recents]`, a grid of `a[data-recent][data-id][href="/t/<id>"]` tiles;
    - `[data-recents-empty]`, with the text "As músicas que você abrir por um link aparecem aqui.";
    - `dialog[data-sign-in-dialog]`.
  - The player calls `recordVisit(track)` once on load, before audio starts.

- [ ] **Step 1: Write the failing E2E tests** in `test/e2e/home.spec.ts`, in a fresh browser context.

  Tests:

  - **`a new listener sees the empty state and Entrar`.**
  - **`opened songs appear newest first`:**
    - Upload two tracks through the API, open `/t/<a>` and then `/t/<b>`, then go to `/`.
    - The tile order is `[b, a]` and the tiles show title and artist.
    - Clicking a tile navigates to `/t/<id>`.
  - **`the player's home button leads to the listener home`.**
  - **`a deleted song drops off after the summary refresh`:** the owner deletes `a` through the API; reloading `/` shows only `b`.
  - **`a renamed song shows its new title`.**
  - **`Limpar histórico empties the list`:** shows the toast "Histórico apagado" and then the empty state.
  - **`summary failure keeps the stored list`:** `page.route("**/api/tracks/summary**", r => r.abort())`; the tiles still render from storage.
  - **`blocked storage`:** with `addInitScript` making `localStorage` access throw, the player plays and the home shows the empty state with no page error (`page.on("pageerror")` gets nothing).
  - **`owner signs in from the dialog and gets the upload view`:**
    - Click `[data-sign-in]`, type the password, and submit.
    - `.upload` appears without a navigation.
    - A wrong password shows "Senha incorreta."
  - Update `upload.spec.ts` to sign in through the dialog.

- [ ] **Step 2: Run them and see them fail.**

  ```bash
  cd app && npm run test:e2e -- home.spec.ts
  ```

  Expected: FAIL.

- [ ] **Step 3: Implement.**

  - **`main.ts` boot:** `owner` gives `showApp` as before; otherwise `renderHome`.
  - **Signing in:** `openSignIn` success calls `boot(true)`. The v1 `sessionNotKept` copy still applies when the session check after sign-in says signed out.
  - **`renderHome`:**
    - Render from `readRecents()` at once.
    - Call `getSummaries` with the ids, then `mergeSummaries`, `saveRecents` and re-render; on failure, keep the render.
  - **Page and grid styles** (in `web/upload/styles.css`):
    - page: `--bg`, content up to 1200 px wide and centered;
    - grid: `repeat(auto-fill, minmax(160px, 1fr))` with 24 px gaps, or 2 columns with 16 px gaps below 640 px;
    - tiles: covers with radius 4, or the palette tile for coverless tracks; one-line ellipsis title.
  - **`web/player/main.ts`:** `recordVisit({ id, title, artist, hasCover })` after `readData()` succeeds.

- [ ] **Step 4: Run the home and upload specs, then the full E2E suite.**

  ```bash
  cd app && npm run test:e2e -- home.spec.ts upload.spec.ts && npm run test:e2e && npm run typecheck && npm test
  ```

  Expected: PASS.

- [ ] **Step 5: Commit**, with the message "Add the listener home and move sign-in into a dialog".

### Task 9: Owner view restyle, docs, final verification

**Files:**

- Modify: `web/upload/styles.css`, `web/upload/list.ts` (markup only if the row needs it), `README.md` (add a "Sharing" section)
- Modify: `docs/superpowers/specs/2026-11-09-letra-player-v2-design.md` (§9: `jsqr`'s license is Apache-2.0, not MIT)
- Test: `test/e2e/upload.spec.ts`

**Interfaces:** none new.

- [ ] **Step 1: Write the failing E2E checks** in `upload.spec.ts`, signed in at 1440×900.

  - The drop panel's computed background is `rgb(20, 20, 22)` (`--surface`), with a dashed border.
  - Each "Enviadas" row is 56 px tall with a 40 px cover.
  - `document.documentElement.scrollWidth <= 360` at a width of 360.

- [ ] **Step 2: Run them and see them fail.**

  ```bash
  cd app && npm run test:e2e -- upload.spec.ts
  ```

  Expected: the new checks FAIL.

- [ ] **Step 3: Implement the owner restyle** from spec §7 "Owner view":

  - `--bg`, with the wordmark on the left and "Sair" on the right;
  - drop panel `--surface`, radius 16, 1 px dashed hairline border;
  - rows 56 px tall with a 40 px cover (radius 2) and the duration in tabular figures. Behavior is unchanged.

  Add a short "Sharing" section to `README.md` covering three points:

  - what the share dialog offers;
  - that listener history lives in their browser;
  - that `GET /api/tracks/summary` is public, limited to 60 requests a minute and returns only summaries for known ids.

  Fix the `jsqr` license line in the spec.

- [ ] **Step 4: Run the full verification.**

  ```bash
  cd app && npm ci && npm run typecheck && npm test && npm run test:e2e && bash scripts/docker-smoke.sh
  ```

  ```bash
  python3 validate_collection.py --root . && python3 -m unittest discover -s tests -b
  ```

  The validator and the Python suite run from the repo root.

  Expected: everything passes. `docker-smoke.sh` needs a running Docker daemon; if it cannot run in the sandbox, say so, and the `app.yml` CI job is the proof.

- [ ] **Step 5: Commit**, with the message "Restyle the owner view and document sharing".
