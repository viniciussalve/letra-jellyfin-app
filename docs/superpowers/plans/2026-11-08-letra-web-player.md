# letra web player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `app/`: a Docker-packaged web app where the owner uploads a song and gets a link that opens a full-screen player with synced lyrics, a karaoke wipe and an optional translation.

**Architecture:** One Node 22 process (Fastify) serves a JSON API, the audio files and two Vite-built pages (upload, player). The server runs TypeScript directly through Node's type stripping, so only the front end has a build step. SQLite and the uploaded files live in `DATA_DIR`. Lyrics come from the file's tags or LRCLIB. Translations come from Claude, then LibreTranslate, and are cached per track and language.

**Tech Stack:** Node 22 (ESM, type stripping) and TypeScript 7.0.2. Server: fastify 5.12.8, @fastify/multipart 10.1.8, @fastify/static 10.1.10, @fastify/cookie 11.1.5, @fastify/rate-limit 11.2.2, music-metadata 12.3.5, better-sqlite3 13.0.3, sharp 0.35.5, @anthropic-ai/sdk 1.6.0. Front end: vite 8.3.6, @fontsource-variable/inter 5.3.0, @phosphor-icons/core 2.1.1. Tests: vitest 5.1.0 and @playwright/test 1.63.0 (matches the preinstalled Chromium). Dev only: node-id3 0.2.9, @types/better-sqlite3 9.6.0, @types/node 22.x.

**Spec:** `docs/superpowers/specs/2026-11-08-letra-web-player-design.md`. Read it with this plan; sections are cited as "spec §N".

## Global Constraints

- All paths are relative to `app/` unless they start with `docs/` or `.github/`. Run commands from `app/`.
- Node 22, `"type": "module"`. Server code must be erasable TypeScript (no `enum`, `namespace` or constructor parameter properties). Relative imports use the `.ts` extension. Server start: `node server/index.ts`.
- tsconfig: `target es2023`, `module/moduleResolution nodenext`, `strict`, `noEmit`, `allowImportingTsExtensions`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `skipLibCheck`, `lib ["es2023","dom","dom.iterable"]`, `types ["node","vite/client"]`.
- UI copy is Brazilian Portuguese and must use the exact strings in spec §7 and §8. Code, comments and docs are in English.
- When tags have no artist and the file name has no ` - `, the artist is "Artista desconhecido".
- Limits and values: `MAX_UPLOAD_MB` 100 (1 MB = 1,048,576 bytes); LRCLIB timeout 5 s; ±3 s duration match; 2 concurrent translation calls; 14 languages (spec §6); last-verse end `min(start + 6000 ms, duration)`; active verse at 30% of the lyrics column.
- Claude translation: model `ANTHROPIC_MODEL` (default `claude-opus-5-5`), `max_tokens` 16000, `output_config.effort` `"medium"`, structured output through `output_config.format` (`json_schema`), `betas: ["server-side-fallback-2026-07-01"]` with `fallbacks: "default"`. Check `stop_reason === "refusal"` before reading content.
- Tests make no network calls. LRCLIB is reached through an injected `fetch` or a local stub (`LRCLIB_URL`); translation uses `TRANSLATOR=fake`.
- Never commit generated files: `dist/`, `.data/`, `test-results/`, `playwright-report/`, `*.db`.
- No Apple name, logo, SF Pro font files or SF Symbols. Icons come from `@phosphor-icons/core` (fill weight); the font is the system stack, then Inter (spec §7 Tokens).
- Repo checks stay green after every commit. From the repo root, `python3 validate_collection.py --root .` must exit 0 (`app/` and `docs/` are already ignored).
- Commit subjects are sentence-case imperatives, matching the repo history. Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GJTMuQwCZCPkHBVf6YK4Ji
  ```

## Review Focus

1. Tag or lyrics text that contains HTML (`</script><img src=x onerror=alert(1)>`). Expected: rendered as text in the page head, the embedded JSON and the DOM, and never executed. Owners: Task 10 (server render) and Task 12 (DOM uses `textContent`).
2. Unsafe or unusual file names (`../../etc/x.mp3`, `Música – Ação.MP3`). Expected: the file is stored only as `audio/<id>.mp3` (lowercase extension), and the title keeps its accents. Owners: Task 3 (`splitFileName`) and Task 8.
3. An upload above the limit, or one that aborts mid-stream. Expected: 413 with the size message, and no partial file left in `audio/`. Owner: Task 8.
4. A translation engine fails while two requests wait on it. Expected: both get the 503, the failure is not cached, and the next request calls the engine again. Owner: Task 9.
5. Range requests at the edges: `bytes=-500`, `bytes=0-` and `bytes=999999999-`. Expected: 206 with the correct `Content-Range` for the first two, 416 for the last. Owner: Task 8.

---

### Task 1: Scaffold `app/`, config, ids and health check

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `shared/types.ts`, `server/config.ts`, `server/lib/ids.ts`, `server/app.ts`, `server/routes/health.ts`, `server/index.ts`
- Modify (repo root): `.gitignore`, adding `app/.data/`, `app/test-results/`, `app/playwright-report/`
- Test: `test/unit/config.test.ts`, `test/unit/ids.test.ts`, `test/api/health.test.ts`

**Interfaces:**
- Produces `shared/types.ts`:
  ```ts
  export type Line = { t: number | null; text: string };            // t in ms
  export type Lyrics = { synced: boolean; lines: Line[]; instrumental: boolean };
  export type LyricsSource = "embedded" | "lrclib" | "manual" | "none";
  export type Palette = { mesh: [string, string, string, string]; scrim: number };
  export type Track = { id: string; title: string; artist: string; album: string | null;
    durationMs: number; mime: string; ext: string; sizeBytes: number; hasCover: boolean;
    palette: Palette; lyrics: Lyrics | null; lyricsSource: LyricsSource;
    lyricsLang: string | null; createdAt: string };
  export type TrackDTO = Track & { shareUrl: string };
  export type Language = { code: string; name: string };
  export type TranslationDTO = { lang: string; sourceLang: string | null; sameLanguage: boolean; lines: string[] };
  export type PlayerData = { track: TrackDTO; translationEnabled: boolean; languages: Language[] } | null;
  export type ApiError = { error: { code: string; message: string } };
  ```
- Produces `server/config.ts`:
  ```ts
  export type TranslatorMode = "auto" | "claude" | "libretranslate" | "fake" | "off";
  export type Config = { uploadPassword: string; publicUrl: string; sessionSecret: string | null;
    dataDir: string; port: number; maxUploadBytes: number; translator: TranslatorMode;
    anthropicApiKey: string | null; anthropicModel: string; libretranslateUrl: string | null;
    libretranslateApiKey: string | null; lrclibUrl: string; webDir: string };
  export function loadConfig(env: Record<string, string | undefined>): Config;
  ```
- Produces `newId(): string` (`server/lib/ids.ts`).
- Produces `buildApp(config: Config, overrides?: AppOverrides): Promise<FastifyInstance>` (`server/app.ts`). Later tasks add fields to `AppOverrides` (`fetch`, `translators`, `templates`).

- [ ] **Step 1: Create `package.json`** with the Tech Stack versions pinned exactly and these scripts: `start` `node server/index.ts`, `dev:server` `node --watch server/index.ts`, `dev:web` `vite build --watch`, `build` `vite build`, `typecheck` `tsc -p .`, `test` `vitest run`, `test:e2e` `playwright test --trace off`, `fixtures` `node test/fixtures/make-fixtures.ts`. Then run `npm install`. Expected: exit 0, with native modules for `better-sqlite3` and `sharp` installed.
- [ ] **Step 2: Write the failing tests**
  ```ts
  // test/unit/config.test.ts
  test("requires UPLOAD_PASSWORD", () => expect(() => loadConfig({})).toThrow(/UPLOAD_PASSWORD/));
  test("defaults", () => {
    const c = loadConfig({ UPLOAD_PASSWORD: "x" });
    expect(c).toMatchObject({ publicUrl: "http://localhost:3000", dataDir: "/data", port: 3000,
      maxUploadBytes: 100 * 1048576, translator: "auto", anthropicModel: "claude-opus-5-5",
      lrclibUrl: "https://lrclib.net", sessionSecret: null });
  });
  test("strips trailing slash from PUBLIC_URL", () =>
    expect(loadConfig({ UPLOAD_PASSWORD: "x", PUBLIC_URL: "https://a.b/" }).publicUrl).toBe("https://a.b"));
  test("rejects unknown TRANSLATOR", () => expect(() => loadConfig({ UPLOAD_PASSWORD: "x", TRANSLATOR: "gpt" })).toThrow(/TRANSLATOR/));
  // test/unit/ids.test.ts
  test("10 base62 chars, unique", () => {
    const ids = new Set(Array.from({ length: 1000 }, newId));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(/^[0-9A-Za-z]{10}$/);
  });
  // test/api/health.test.ts: buildApp with a tmp DATA_DIR; GET /healthz -> 200, body "ok"
  ```
- [ ] **Step 3: Run `npm test` to verify it fails.** Expected: FAIL (modules missing).
- [ ] **Step 4: Implement.**
  - `loadConfig` reads the variables in spec §9 plus `LRCLIB_URL` (test hook, default `https://lrclib.net`) and `WEB_DIR` (default `<app>/dist/web`).
  - `newId` uses rejection sampling over `crypto.randomBytes` so every character is uniformly likely.
  - `buildApp` creates `DATA_DIR/{audio,covers,og}` and registers `/healthz`.
  - `index.ts` calls `loadConfig(process.env)`, `buildApp`, then `listen({ host: "0.0.0.0", port })`.
- [ ] **Step 5: Run `npm test && npm run typecheck`.** Expected: PASS.
- [ ] **Step 6: Commit** "Scaffold the letra web player app".

### Task 2: Lyrics text parsing

**Files:**
- Create: `server/lib/lyrics/lrc.ts`, `server/lib/lyrics/plain.ts`, `server/lib/lyrics/parse.ts`
- Test: `test/unit/lyrics-parse.test.ts`

**Interfaces:**
- Produces `parseLrc(text: string): Lyrics`, `parsePlain(text: string): Lyrics`, `isLrc(text: string): boolean`, and `parseLyricsText(text: string): Lyrics | null` (null when there is no text).

- [ ] **Step 1: Write the failing tests**
  ```ts
  test("timestamps in ms, sorted, multi-tag lines expanded", () => {
    const l = parseLrc("[00:05.00]b\n[00:01.5][00:09.250]a\n[ar:X]\n[length:03:00]");
    expect(l.lines).toEqual([{ t: 1500, text: "a" }, { t: 5000, text: "b" }, { t: 9250, text: "a" }]);
    expect(l.synced).toBe(true);
  });
  test("offset tag shifts times", () => expect(parseLrc("[offset:+500]\n[00:01.00]a\n[00:02]b\n[00:03]c").lines[0].t).toBe(1500));
  test("enhanced word tags stripped", () => expect(parseLrc("[00:01.00]<00:01.00>Hi <00:01.50>there\n[00:02]x\n[00:03]y").lines[0].text).toBe("Hi there"));
  test("empty timed line kept as break", () => expect(parseLrc("[00:01]a\n[00:02]\n[00:03]b").lines[1]).toEqual({ t: 2000, text: "" }));
  test("isLrc needs 3 timed lines", () => { expect(isLrc("[00:01]a\n[00:02]b")).toBe(false); expect(isLrc("[00:01]a\n[00:02]b\n[00:03]c")).toBe(true); });
  test("plain keeps blank lines as breaks, trims CRLF", () =>
    expect(parsePlain("a\r\n\r\nb").lines).toEqual([{ t: null, text: "a" }, { t: null, text: "" }, { t: null, text: "b" }]));
  test("parseLyricsText null on whitespace", () => expect(parseLyricsText("  \n ")).toBeNull());
  ```
- [ ] **Step 2: Run `npx vitest run test/unit/lyrics-parse.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement** per spec §5 Parsing. Trim leading and trailing break lines.
- [ ] **Step 4: Run the test file.** Expected: PASS.
- [ ] **Step 5: Commit** "Parse LRC and plain lyrics".

### Task 3: Test fixtures and tag reading

**Files:**
- Create: `test/fixtures/make-fixtures.ts`, the generated fixtures (`song.mp3`, `Letra Fixtures - Sem Tags.mp3`, `not-audio.mp3`, `cover.png`, `sample.lrc`) and `server/lib/metadata.ts`
- Test: `test/unit/metadata.test.ts`

**Interfaces:**
- Consumes `parseLyricsText` (Task 2).
- Produces:
  ```ts
  export class NotAudioError extends Error {}
  export const ALLOWED_EXTS: readonly ["mp3", "m4a", "flac", "ogg", "wav"];
  export const MIME_BY_EXT: Record<string, string>;  // mp3 audio/mpeg, m4a audio/mp4, flac audio/flac, ogg audio/ogg, wav audio/wav
  export type TrackMeta = { title: string; artist: string; album: string | null; durationMs: number;
    mime: string; ext: string; cover: Buffer | null; embedded: { synced: Lyrics | null; plain: Lyrics | null } };
  export function splitFileName(name: string): { title: string; artist: string };
  export function readTrackMeta(filePath: string, originalName: string): Promise<TrackMeta>;
  ```

- [ ] **Step 1: Write `make-fixtures.ts`** (ffmpeg through `child_process`, tags through `node-id3`) and run `npm run fixtures`. It produces:
  - `cover.png`: 600×600, left half `#2F3E57` and right half `#738488` (ffmpeg `color` + `drawbox`).
  - `song.mp3`: 8 s of a 440 Hz sine at -30 dB, mono, 32 kbps. ID3 tags: title "Linha de Teste", artist "Letra Fixtures", album "Fixtures", APIC `cover.png`, and USLT set to the text of `sample.lrc`.
  - `sample.lrc`: `[00:00.50]Primeiro verso da música`, `[00:02.50]Segundo verso, um pouco mais longo para quebrar a linha em telas estreitas`, `[00:04.50]Terceiro verso`, `[00:06.50]Último verso`.
  - `Letra Fixtures - Sem Tags.mp3`: the same audio with no tags.
  - `not-audio.mp3`: the UTF-8 text "isto não é áudio".

  Expected: the files exist and total under 100 KB.
- [ ] **Step 2: Write the failing tests**
  ```ts
  test("reads tags, cover and embedded LRC", async () => {
    const m = await readTrackMeta(fx("song.mp3"), "song.mp3");
    expect(m).toMatchObject({ title: "Linha de Teste", artist: "Letra Fixtures", album: "Fixtures", mime: "audio/mpeg", ext: "mp3" });
    expect(m.durationMs).toBeGreaterThan(7500); expect(m.durationMs).toBeLessThan(8600);
    expect(m.cover).toBeInstanceOf(Buffer);
    expect(m.embedded.synced?.lines.map(l => l.t)).toEqual([500, 2500, 4500, 6500]);
  });
  test("falls back to the file name", async () =>
    expect(await readTrackMeta(fx("Letra Fixtures - Sem Tags.mp3"), "Letra Fixtures - Sem Tags.mp3"))
      .toMatchObject({ title: "Sem Tags", artist: "Letra Fixtures", album: null, cover: null }));
  test("rejects non-audio", () => expect(readTrackMeta(fx("not-audio.mp3"), "not-audio.mp3")).rejects.toBeInstanceOf(NotAudioError));
  test("splitFileName", () => {
    expect(splitFileName("Música – Ação.MP3")).toEqual({ title: "Música – Ação", artist: "Artista desconhecido" });
    expect(splitFileName("../../etc/A - B - C.mp3")).toEqual({ artist: "A", title: "B - C" });
  });
  ```
- [ ] **Step 3: Run the test file.** Expected: FAIL.
- [ ] **Step 4: Implement `readTrackMeta`** with music-metadata `parseFile`.
  - Reject the file (NotAudioError) when parsing throws, or when the duration is missing or 0.
  - The extension comes from `originalName`, lowercased. It must be in `ALLOWED_EXTS`, or the file is rejected.
  - For each `common.lyrics` entry: `syncText` with timestamps fills `embedded.synced`. Text where `isLrc` is true goes through `parseLrc` into `synced`. Any other text goes into `plain`.
  - `splitFileName` uses only the basename without its extension, splits on the first ` - `, and trims both parts.
- [ ] **Step 5: Run the test file.** Expected: PASS.
- [ ] **Step 6: Commit** "Read track tags and embedded lyrics", including the fixtures.

### Task 4: LRCLIB client and lyrics resolution

**Files:**
- Create: `server/lib/lyrics/lrclib.ts`, `server/lib/lyrics/resolve.ts`
- Test: `test/unit/lrclib.test.ts`, `test/unit/resolve.test.ts`

**Interfaces:**
- Consumes `TrackMeta` (Task 3) and `parseLrc`/`parsePlain` (Task 2).
- Produces:
  ```ts
  export type LrclibRecord = { id: number; trackName: string; artistName: string; albumName: string | null;
    duration: number; instrumental: boolean; plainLyrics: string | null; syncedLyrics: string | null };
  export type LrclibClient = {
    get(q: { artist: string; title: string; album: string | null; durationSec: number }): Promise<LrclibRecord | null>;
    search(q: { artist: string; title: string }): Promise<LrclibRecord[]> };
  export function createLrclibClient(o: { baseUrl: string; fetch: typeof fetch; timeoutMs?: number }): LrclibClient;
  export function pickBest(records: LrclibRecord[], durationSec: number): LrclibRecord | null;
  export function resolveLyrics(meta: Pick<TrackMeta, "title" | "artist" | "album" | "durationMs" | "embedded">,
    lrclib: LrclibClient): Promise<{ lyrics: Lyrics | null; source: LyricsSource }>;
  ```

- [ ] **Step 1: Write the failing tests** with a stub `fetch` that records URLs and returns canned JSON.
  ```ts
  test("get sends params and User-Agent", async () => { /* URL has artist_name, track_name, album_name, duration=8;
    header user-agent === "letra (https://github.com/viniciussalve/letra)" */ });
  test("404, network error and timeout give null / []", async () => { /* timeoutMs: 50 with a never-resolving fetch */ });
  test("pickBest keeps ±3 s and prefers synced", () => {
    const r = (id: number, duration: number, synced: boolean) => ({ id, duration, syncedLyrics: synced ? "[00:01]a" : null } as LrclibRecord);
    expect(pickBest([r(1, 200, false), r(2, 203, true), r(3, 210, true)], 201)?.id).toBe(2);
    expect(pickBest([r(1, 190, true)], 201)).toBeNull();
  });
  test("embedded synced wins without network", /* lrclib stub that throws if called */);
  test("order: get synced > search synced > embedded plain > lrclib plain > none", /* table of stubs */);
  test("instrumental record", /* -> { lyrics: { synced: false, lines: [], instrumental: true }, source: "lrclib" } */);
  ```
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement** per spec §5 Resolution order. Use `AbortSignal.timeout(timeoutMs ?? 5000)` and send `durationSec = Math.round(durationMs / 1000)`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** "Resolve lyrics from tags and LRCLIB".

### Task 5: Cover palette, cover file and preview image

**Files:**
- Create: `server/lib/palette.ts`, `server/lib/og.ts`
- Test: `test/unit/palette.test.ts`, `test/unit/og.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const DEFAULT_PALETTE: Palette; // { mesh: ["#2F3E57", "#738488", "#0F1014", "#424B51"], scrim: 0.25 }
  export function contrastRatio(fg: string, bg: string): number;      // WCAG 2.x
  export function blendWhite(alpha: number, bg: string): string;     // white at alpha over bg, as #RRGGBB
  export function adjustForText(hex: string): string;                 // spec §7 Gradient step 3
  export function scrimFor(hex: string): number;                      // 0.25..0.45, spec §7 Gradient step 4
  export function extractPalette(cover: Buffer | null): Promise<Palette>;
  export function saveCover(cover: Buffer): Promise<Buffer>;          // JPEG, longest side ≤ 1200, quality 85
  export function renderOgImage(cover: Buffer | null, palette: Palette): Promise<Buffer>; // 1200×630 JPEG
  ```

- [ ] **Step 1: Write the failing tests**
  ```ts
  test("grey-teal from the reference is darkened, hue kept", () => {
    const c = adjustForText("#738488");
    expect(contrastRatio("#FFFFFF", c)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(blendWhite(0.75, c), c)).toBeGreaterThanOrEqual(3);
    expect(Math.abs(hue(c) - hue("#738488"))).toBeLessThan(6);
  });
  test("navy already passes, unchanged", () => expect(adjustForText("#2F3E57")).toBe("#2F3E57"));
  test("scrim makes white 60% reach 4.5:1", () => { /* for #738488: blend black(scrimFor) then white .6 >= 4.5; value in [0.25, 0.45] */ });
  test("no cover gives the default", async () => expect(await extractPalette(null)).toEqual(DEFAULT_PALETTE));
  test("fixture cover gives 4 adjusted colors", async () => { /* each mesh color passes adjustForText checks */ });
  test("og image is 1200×630 JPEG, with and without cover", async () => { /* sharp(buf).metadata() */ });
  ```
  (`hue` is a small test helper that converts to OKLCH.)
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - K-means with k = 4 on a 64×64 raw RGB resize, run for a fixed 10 iterations from deterministic seeds (the quantiles of pixel lightness). Order colors by cluster size.
  - The OKLCH conversion lives in this file; no color dependency.
  - `scrim` is the maximum of `scrimFor` over the four colors.
  - The OG image is the four colors as a blurred gradient plus the cover at 470 px, centered.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** "Derive the background palette and preview image from the cover".

### Task 6: Database

**Files:**
- Create: `server/db.ts`
- Test: `test/unit/db.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type StoredTranslation = { trackId: string; lang: string; engine: string; sourceLang: string | null;
    sameLanguage: boolean; lines: string[]; createdAt: string };
  export type Db = {
    tracks: { insert(t: Track): void; get(id: string): Track | null; list(): Track[];
      update(id: string, patch: Partial<Pick<Track, "title" | "artist" | "lyrics" | "lyricsSource" | "lyricsLang">>): Track | null;
      delete(id: string): boolean };
    translations: { get(trackId: string, lang: string): StoredTranslation | null; put(t: StoredTranslation): void; clear(trackId: string): void };
    ping(): boolean; close(): void };
  export function openDb(file: string): Db; // ":memory:" allowed
  ```

- [ ] **Step 1: Write the failing tests:** an insert/get round trip deep-equals the input (palette and lyrics JSON preserved); `list()` returns newest first; `update` returns the merged track; deleting a track cascades its translations; translation put/get round trip.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement** the spec §3 schema. Add a `same_language INTEGER NOT NULL DEFAULT 0` column to `translations`, set `PRAGMA foreign_keys = ON` and `journal_mode = WAL`, and record migrations in `PRAGMA user_version`. `buildApp` opens `DATA_DIR/letra.db`, and `/healthz` uses `ping()`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** "Store tracks and translations in SQLite".

### Task 7: Owner session

**Files:**
- Create: `server/auth.ts`, `server/routes/session.ts`, `server/lib/errors.ts`
- Modify: `server/app.ts`
- Test: `test/api/session.test.ts`

**Interfaces:**
- Produces `sendError(reply, status: number, code: string, message: string)` (`errors.ts`, body `ApiError`), a `requireOwner` Fastify `preHandler`, and `loadSessionSecret(config): Promise<string>`.

- [ ] **Step 1: Write the failing tests**
  ```ts
  test("wrong password", /* POST /api/session {password:"nope"} -> 401 { error: { code: "bad_password", message: "Senha incorreta." } } */);
  test("right password sets an HttpOnly SameSite=Lax cookie", /* set-cookie letra_session=…; HttpOnly; SameSite=Lax; Max-Age=2592000 */);
  test("Secure only for https PUBLIC_URL", /* ... */);
  test("6th attempt in a minute", /* 429, message "Muitas tentativas. Espere um minuto e tente de novo." */);
  test("GET /api/tracks without cookie", /* 401 code "unauthorized" */);
  test("DELETE /api/session clears the cookie", /* ... */);
  test("secret persisted to DATA_DIR/session-secret with mode 0600 when SESSION_SECRET unset", /* ... */);
  ```
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement** with `@fastify/cookie` (signed value `"owner"`) and `@fastify/rate-limit` (`max: 5`, `timeWindow: "1 minute"`, on this route only). Compare passwords with `timingSafeEqual` over SHA-256 digests. `GET /api/session` returns `{ owner: boolean }` for the upload page.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** "Protect uploads with an owner password".

### Task 8: Upload, track management and media

**Files:**
- Create: `server/routes/tracks.ts`, `server/routes/media.ts`, `server/lib/storage.ts`
- Modify: `server/app.ts` (`AppOverrides.fetch` feeds the LRCLIB client)
- Test: `test/api/tracks.test.ts`, `test/api/media.test.ts`

**Interfaces:**
- Consumes Tasks 2–7.
- Produces `toDTO(track: Track, publicUrl: string): TrackDTO` and `paths(dataDir, id, ext): { audio: string; cover: string; og: string }`. Routes as in spec §3 Routes; `POST /api/tracks` takes a multipart field `file`.

- [ ] **Step 1: Write the failing tests.** Log in first, and stub LRCLIB with `fetch` overrides.
  ```ts
  test("upload song.mp3", /* 201; body matches { title: "Linha de Teste", lyricsSource: "embedded", hasCover: true,
     shareUrl: "http://localhost:3000/t/" + id }; files audio/<id>.mp3, covers/<id>.jpg, og/<id>.jpg exist */);
  test("bare file gets LRCLIB lyrics", /* stub returns syncedLyrics -> lyricsSource "lrclib" */);
  test("unsafe name stored by id", /* filename "../../etc/x.mp3" -> only audio/<id>.mp3 under DATA_DIR */);
  test("not audio -> 415", /* { code: "not_audio", message: "Esse arquivo não é um áudio que dá para tocar. Envie MP3, M4A, FLAC, OGG ou WAV." }; audio/ empty */);
  test("too large -> 413, no partial file", /* MAX_UPLOAD_MB=1 with a 2 MB body: message "O arquivo tem 2 MB. O limite é 1 MB."; audio/ empty */);
  test("list newest first; PATCH trims and validates 1..200 chars", /* ... */);
  test("PUT lyrics {text} -> manual, clears translations", /* ... */);
  test("PUT lyrics blank -> 400 empty_lyrics 'Cole a letra ou envie um arquivo .lrc.'", /* ... */);
  test("PUT lyrics multipart sample.lrc -> synced, 4 lines, source manual", /* ... */);
  test("lyrics/search re-runs resolution with current title/artist", /* ... */);
  test("DELETE removes row, translations and files -> 204", /* ... */);
  // media.test.ts
  test("audio full and ranges", /* GET -> 200, content-type audio/mpeg, accept-ranges bytes;
     bytes=0- -> 206; bytes=-500 -> 206 with content-range "bytes <size-500>-<size-1>/<size>"; bytes=999999999- -> 416 */);
  test("cover 404 when hasCover false; og always 200 image/jpeg; unknown id 404", /* ... */);
  ```
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Stream the upload to `audio/<newId>.<ext>` with `@fastify/multipart` `limits.fileSize = maxUploadBytes`.
  - On truncation, delete the partial file and answer 413. The MB figure is `Math.ceil(Number(content-length) / 1048576)`.
  - Any error after the write deletes every file written for that id.
  - Serve media with `reply.sendFile` from `@fastify/static` (range support built in) and `Cache-Control: public, max-age=31536000, immutable`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** "Upload tracks and serve audio with range support".

### Task 9: Translation engines, service and endpoint

**Files:**
- Create: `shared/languages.ts` (imported by server and web), `server/lib/translate/types.ts`, `claude.ts`, `libretranslate.ts`, `fake.ts`, `service.ts`, `engines.ts`, and `server/routes/translation.ts`
- Modify: `server/app.ts` (adds `AppOverrides.translators?: Translator[]`)
- Test: `test/unit/translate-service.test.ts`, `test/unit/translate-engines.test.ts`, `test/api/translation.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const LANGUAGES: Language[];   // shared/languages.ts: the 14 of spec §6, in that order, name in its own language
  export type Translator = { name: "claude" | "libretranslate" | "fake";
    translate(i: { title: string; artist: string; lines: string[]; target: Language }): Promise<{ sourceLang: string | null; lines: string[] }> };
  export class TranslationError extends Error { readonly kind: "line_count" | "refusal" | "engine"; constructor(kind: TranslationError["kind"], msg: string) }
  export function createClaudeTranslator(o: { apiKey: string; model: string; client?: Pick<Anthropic, "beta"> }): Translator;
  export function createLibreTranslator(o: { url: string; apiKey: string | null; fetch: typeof fetch }): Translator;
  export const fakeTranslator: Translator;   // lines -> "[<code>] <line>", sourceLang "en"
  export function createEngines(config: Config, fetch: typeof fetch): Translator[];
  export function createTranslationService(o: { engines: Translator[]; db: Db; maxConcurrent?: number }): {
    enabled: boolean; translate(track: Track, lang: string): Promise<TranslationDTO> };
  ```

- [ ] **Step 1: Write the failing tests**
  ```ts
  test("only non-empty lines are sent; output re-aligned with breaks as ''", /* ... */);
  test("line_count mismatch retries once, then falls to next engine", /* call counts [2, 1] */);
  test("cached: second call does not hit the engine", /* ... */);
  test("concurrent callers share one in-flight call", /* engine count 1 for two parallel translate() */);
  test("failure is not cached and is shared by waiters", /* both reject; a third call invokes the engine again */);
  test("max 2 engine calls at once", /* 3 tracks in parallel -> peak 2 */);
  test("sameLanguage when source primary subtag equals target", /* sourceLang "pt" target "pt-BR" -> { sameLanguage: true, lines: [] } */);
  test("first success stores lyricsLang on the track", /* ... */);
  test("claude request shape", /* stub client.beta.messages.create receives model "claude-opus-5-5", max_tokens 16000,
     betas ["server-side-fallback-2026-07-01"], fallbacks "default", output_config.effort "medium",
     output_config.format.type "json_schema"; returns text JSON -> parsed */);
  test("claude refusal -> TranslationError refusal", /* stop_reason "refusal" */);
  test("libretranslate maps pt-BR->pt and reads detectedLanguage object or array", /* ... */);
  // translation.test.ts (fake engine)
  test("GET ?lang=pt-BR -> 200 TranslationDTO with '[pt-BR] Primeiro verso da música'", /* ... */);
  test("bad lang -> 400 bad_language; no lyrics -> 404 no_lyrics; TRANSLATOR=off -> 404 translation_off", /* ... */);
  test("all engines fail -> 503 { code: 'translation_unavailable', message: 'Tradução indisponível agora.' }", /* ... */);
  ```
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement** per spec §6 and the Global Constraints Claude line.
  - The JSON schema is `{type:"object", properties:{source_lang:{type:"string"}, lines:{type:"array", items:{type:"string"}}}, required:["source_lang","lines"], additionalProperties:false}`.
  - The system prompt says:
    - translate song lyrics for a listener who speaks the target language;
    - keep meaning, tone and imagery over word-for-word accuracy;
    - return exactly one output line per input line, in order;
    - leave bracketed cues untranslated;
    - report `source_lang` as a BCP-47 code.
  - The user message is JSON `{title, artist, target_language: "<name> (<code>)", lines: string[]}`.
  - Read the first `text` block and `JSON.parse` it. If `fallbacks` or `betas` is missing from the installed SDK's types, let the compiler point to the right parameter type; do not remove the fields.
  - The concurrency limiter is a small semaphore in `service.ts`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** "Translate lyrics with Claude and LibreTranslate, cached per language".

### Task 10: Server-rendered pages

**Files:**
- Create: `server/routes/pages.ts`, `server/lib/render.ts`
- Modify: `server/app.ts` (adds `AppOverrides.templates?: { upload: string; player: string }`; otherwise templates are read from `webDir/upload/index.html` and `webDir/player/index.html` at startup; `webDir/assets` is served at `/assets/` with immutable caching)
- Test: `test/api/pages.test.ts`

**Interfaces:**
- Produces `renderPlayerPage(template: string, data: PlayerData, config: Config): string`. The template contains `<!--letra:head-->` and `<!--letra:data-->`; `data === null` renders the 404 state.

- [ ] **Step 1: Write the failing tests** against the template `<html><head><!--letra:head--></head><body><!--letra:data--></body></html>`:
  ```ts
  test("OG tags", /* og:title = title; og:description = "<artist>. Ouça com a letra e a tradução." (without " e a tradução"
     when translation is off); og:image = PUBLIC_URL/media/<id>/og.jpg; og:image:width 1200; og:image:height 630;
     og:type music.song; twitter:card summary_large_image; <meta name="robots" content="noindex, nofollow"> */);
  test("palette as CSS variables", /* style tag sets --mesh-1..--mesh-4 and --scrim; theme-color = mesh[0] */);
  test("embedded data parses back", /* JSON in <script id="letra-data" type="application/json"> deep-equals PlayerData */);
  test("HTML in tags is inert", /* title "</script><img src=x onerror=alert(1)>": no raw "</script><img" in output;
     JSON uses <; meta content escaped */);
  test("GET /t/unknown -> 404 with data null", /* ... */);
  test("GET / serves the upload template; robots noindex there too", /* ... */);
  ```
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.** Escape attributes with `& < > " '`. JSON-encode the data, then replace `<` with `<`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** "Render the share page with link previews".

### Task 11: Front-end foundation and playback timing

**Files:**
- Create: `vite.config.ts`, `web/shared/tokens.css`, `web/shared/base.css`, `web/shared/icons.ts`, `web/shared/format.ts`, `web/shared/api.ts`, `web/player/timing.ts`, and placeholder `web/upload/index.html` and `web/player/index.html` (each with the `<!--letra:…-->` markers where needed)
- Test: `test/unit/timing.test.ts`, `test/unit/format.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // web/player/timing.ts
  export function activeIndex(lines: Line[], ms: number): number;      // -1 before the first timed line
  export function lineEnd(lines: Line[], i: number, durationMs: number): number;
  export function wipeProgress(lines: Line[], i: number, ms: number, durationMs: number): number; // 0..1
  // web/shared/format.ts
  export function formatTime(ms: number): string;       // 130000 -> "2:10", 3725000 -> "1:02:05"
  export function formatRemaining(ms: number): string;  // "−2:17" (U+2212)
  // web/shared/icons.ts: icon(name: IconName): string, inline SVG from @phosphor-icons/core fill assets via ?raw
  // web/shared/api.ts: typed fetch wrappers for every route in spec §3; they throw ApiClientError { status, code, message }
  ```

- [ ] **Step 1: Write the failing tests**
  ```ts
  const L = [{ t: 500, text: "a" }, { t: 2500, text: "" }, { t: 4500, text: "b" }, { t: 4500, text: "c" }];
  test("before first", () => expect(activeIndex(L, 100)).toBe(-1));
  test("exact boundary and duplicates take the last", () => { expect(activeIndex(L, 2500)).toBe(1); expect(activeIndex(L, 4500)).toBe(3); });
  test("after last stays on last", () => expect(activeIndex(L, 99999)).toBe(3));
  test("last line ends at min(t+6000, duration)", () => { expect(lineEnd(L, 3, 20000)).toBe(10500); expect(lineEnd(L, 3, 8000)).toBe(8000); });
  test("wipe clamps", () => { expect(wipeProgress(L, 0, 0, 8000)).toBe(0); expect(wipeProgress(L, 0, 1500, 8000)).toBe(0.5); expect(wipeProgress(L, 0, 9000, 8000)).toBe(1); });
  test("format", () => { expect(formatTime(130000)).toBe("2:10"); expect(formatRemaining(137000)).toBe("−2:17"); });
  ```
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `vite.config.ts`: root `web`, `build.outDir` `../dist/web`, `emptyOutDir`, inputs `upload/index.html` and `player/index.html`, `assetsDir` `assets`.
  - `tokens.css`: the spec §7 Tokens block verbatim.
  - `base.css`: imports `@fontsource-variable/inter`, the body font stack, the focus ring from the spec §7 Quality floor, `@media (prefers-reduced-motion: reduce)`, and `@media (prefers-reduced-transparency: reduce), (prefers-contrast: more)` resets.
- [ ] **Step 4: Run `npm test && npm run build`.** Expected: PASS, with `dist/web/upload/index.html` and `dist/web/player/index.html` present.
- [ ] **Step 5: Commit** "Add the front-end foundation and playback timing".

### Task 12: Player page: layout, audio, lyrics and background

**Files:**
- Create: `web/player/index.html`, `main.ts`, `audio.ts`, `lyrics-view.ts`, `background.ts`, `styles.css`, plus `playwright.config.ts`, `test/e2e/server.ts` (starts an LRCLIB stub and the app with a tmp `DATA_DIR`, `UPLOAD_PASSWORD=e2e-pass`, `TRANSLATOR=fake`, `LRCLIB_URL=<stub>`) and `test/e2e/helpers.ts` (`uploadFixture(request, name): Promise<TrackDTO>` through the API)
- Test: `test/e2e/player.spec.ts`

**Interfaces:**
- Consumes `PlayerData` (from `#letra-data`), `timing.ts`, `format.ts` and `icons.ts`.
- Produces DOM hooks that the E2E tests and Task 13 rely on:
  - `[data-verse][data-index]` for every verse, with `data-state="active|past|future"`;
  - `[data-play-pill]`, `[data-play]`, `[data-progress]`, `[data-elapsed]`, `[data-remaining]`;
  - `[data-lyrics-toggle]`, `[data-fullscreen]`, `[data-share]`, `[data-translate]`, `[data-language]`;
  - `[data-back-to-current]`, `[data-lyrics-state="none|instrumental|unsynced|synced"]`.
- `audio.ts` exports `createPlayer(audio: HTMLAudioElement, track: TrackDTO): { onTime(cb: (ms: number) => void): void; seek(ms: number): void; toggle(): Promise<void> }`. It also wires Media Session per spec §7 Share page.

- [ ] **Step 1: Write the failing E2E tests**
  ```ts
  test("opens with cover, title and lyrics; play pill starts playback", /* goto shareUrl; see "Linha de Teste",
     "Letra Fixtures", 4 verses; click [data-play-pill]; pill hidden; audio not paused */);
  test("active verse follows time and wipes", /* evaluate audio.currentTime = 4.6; expect.poll index 2 has data-state active;
     its span style --p between 0% and 100% */);
  test("tap a verse to seek", /* click verse 3 -> audio.currentTime ≈ 6.5 (±0.3) and verse 3 active */);
  test("times show elapsed and remaining with U+2212", /* [data-remaining] matches /^−\d+:\d\d$/ */);
  test("lyrics toggle hides the column and centers the cover", /* ... */);
  test("manual scroll shows 'Voltar ao verso atual'", /* wheel on lyrics -> pill visible; click -> hidden */);
  test("phone viewport has no horizontal scroll", /* 360x740: scrollWidth <= clientWidth */);
  test("reduced motion: no wipe gradient, active verse fully white", /* emulateMedia reducedMotion */);
  test("unknown link shows the 404 copy", /* "Esse link não existe ou a música foi apagada." */);
  test("keyboard: Space toggles, ArrowRight seeks +5 s, L toggles lyrics", /* ... */);
  test("Media Session metadata after play", /* navigator.mediaSession.metadata.title === "Linha de Teste" */);
  test("plain lyrics -> unsynced state", /* PUT plain text; [data-lyrics-state=unsynced]; badge "Letra sem sincronia"; clicking a verse does not seek */);
  test("instrumental and missing lyrics states", /* LRCLIB stub instrumental for title "Instrumental Teste" -> "Instrumental";
     no lyrics -> "A letra desta música não foi encontrada."; play still works */);
  test("audio error message", /* route /media/<id>/audio -> 404 -> "Não foi possível tocar este arquivo neste navegador." */);
  test("HTML in title renders as text", /* upload with PATCH title "<b>x</b>" -> visible text "<b>x</b>", no <b> element */);
  ```
- [ ] **Step 2: Run `npm run build && npm run test:e2e -- test/e2e/player.spec.ts`.** Expected: FAIL. `@playwright/test` is pinned to 1.63.0, the preinstalled version, so its Chromium is found without an `executablePath`; CI installs its own browser.
- [ ] **Step 3: Implement** the layout, lyrics behavior, background and states from spec §7, using only `textContent` for track and lyrics text. Set `lang` on the lyrics column from `track.lyricsLang` when it is known.
  - Wipe: a `requestAnimationFrame` loop sets `--p` on the active verse's inline span only.
  - Inactive verses get blur only when inside the viewport (an IntersectionObserver toggles a class).
  - The background layer drifts with CSS animation, which stops on `document.hidden`.
- [ ] **Step 4: Run the E2E file.** Expected: PASS. Then take a screenshot at 1180×820 and at 390×844 (deviceScaleFactor 1), compare them against the reference proportions in spec §7 (cover 38% of the width, lyrics from 47%, active verse at 30%), and fix any drift.
- [ ] **Step 5: Commit** "Build the player with synced lyrics and the cover gradient".

### Task 13: Player translation, share and full screen

**Files:**
- Create: `web/player/translation.ts`, `web/player/share.ts`
- Modify: `web/player/main.ts`, `web/player/lyrics-view.ts` (adds `setTranslations(lines: string[] | null, note: string | null)`), `web/player/styles.css`
- Test: `test/e2e/translation.spec.ts`

**Interfaces:**
- Consumes `GET /api/tracks/:id/translation` and the DOM hooks from Task 12.
- `translation.ts` exports `defaultLanguage(navigatorLanguages: readonly string[], languages: Language[]): string` (unit-tested) and `loadPrefs()`/`savePrefs({ on: boolean; lang: string })`. Both wrap `localStorage` in try/catch under the key `letra:translation`.

- [ ] **Step 1: Write the failing tests**
  ```ts
  // test/unit/translation-prefs.test.ts
  test("first supported navigator language, else pt-BR", () => {
    expect(defaultLanguage(["de-AT", "en"], LANGUAGES)).toBe("de");  // de-AT matches de by primary subtag
    expect(defaultLanguage(["sv", "en-GB"], LANGUAGES)).toBe("en");
    expect(defaultLanguage(["pt-BR"], LANGUAGES)).toBe("pt-BR");
    expect(defaultLanguage(["xx"], LANGUAGES)).toBe("pt-BR");
  });
  // test/e2e/translation.spec.ts (fake engine)
  test("toggle on shows a translation under every verse", /* click [data-translate]; button pressed (aria-pressed=true);
     [data-language] visible; verse 0 shows "[pt-BR] Primeiro verso da música" */);
  test("switch language", /* choose English -> "[en] Primeiro verso da música" */);
  test("preference survives reload", /* reload -> still on, still English */);
  test("same language note", /* fake returns sourceLang "en"; choose English ->
     "A música já está em English" shown instead of duplicate lines */);
  test("failure shows retry", /* route intercept 503 -> "Tradução indisponível agora." and "Tentar de novo"; lyrics still play */);
  test("share falls back to copy", /* grant clipboard; navigator.share undefined -> clipboard has shareUrl; toast "Link copiado" */);
  test("translate button absent when translation is disabled", /* app started with TRANSLATOR=off in a second webServer project */);
  test("T toggles translation", /* keyboard T -> aria-pressed flips */);
  ```
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement** per spec §7 Share page (translation, share, full screen). The language menu is a glass panel over a native `<select>`, and a keyboard shortcut is added per spec. The same-language note uses the language's own `name` from `LANGUAGES`.
- [ ] **Step 4: Run the unit and E2E tests.** Expected: PASS.
- [ ] **Step 5: Commit** "Add translation, sharing and full screen to the player".

### Task 14: Upload page

**Files:**
- Create: `web/upload/index.html`, `main.ts`, `login.ts`, `uploader.ts`, `result.ts`, `list.ts`, `dialogs.ts`, `styles.css`
- Test: `test/e2e/upload.spec.ts`, `test/unit/upload-validate.test.ts`

**Interfaces:**
- Consumes `web/shared/api.ts` and the routes from Tasks 7–8.
- `uploader.ts` exports `validateFile(f: { name: string; size: number }, maxBytes: number): string | null`, which returns the spec §8 message or null, and `upload(file: File, onProgress: (pct: number) => void): Promise<TrackDTO>`, which uses XHR for upload progress.

- [ ] **Step 1: Write the failing tests**
  ```ts
  test("validateFile", () => {
    expect(validateFile({ name: "a.mp3", size: 142 * 1048576 }, 100 * 1048576)).toBe("O arquivo tem 142 MB. O limite é 100 MB.");
    expect(validateFile({ name: "a.txt", size: 10 }, 100 * 1048576)).toBe("Esse arquivo não é um áudio que dá para tocar. Envie MP3, M4A, FLAC, OGG ou WAV.");
    expect(validateFile({ name: "A.MP3", size: 10 }, 100 * 1048576)).toBeNull();
  });
  // upload.spec.ts
  test("wrong then right password", /* "Senha incorreta." then the drop panel "Solte uma música aqui" */);
  test("upload shows progress then result with link", /* setInputFiles song.mp3; "Procurando a letra…" seen;
     badge "Letra sincronizada"; link field = shareUrl; "Copiar link" -> "Link copiado" */);
  test("Enviadas lists the new row first with highlight", /* first [data-row] has data-new and title "Linha de Teste" */);
  test("missing lyrics actions and paste", /* bare file with the LRCLIB stub returning nothing -> "Não achamos a letra.";
     "Colar letra" -> paste sample.lrc -> "Salvar letra" -> "Letra salva" and badge "Letra sincronizada" */);
  test("edit title and artist", /* "Editar" -> save -> list updated */);
  test("delete asks and removes", /* ⋯ -> "Apagar" -> dialog text "Apagar “Linha de Teste”? O link para de funcionar."
     -> "Apagar" -> "Música apagada"; row gone; old link shows the 404 copy */);
  test("drag over highlights the panel", /* dispatch dragenter on window -> panel has data-dragging */);
  ```
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement** per spec §7 Upload page. The whole window accepts drops; dialogs use `<dialog>` with the glass style, not `alert`/`confirm`.
- [ ] **Step 4: Run the tests.** Expected: PASS. Take a screenshot at 1180×820 and 390×844 and check them against spec §7.
- [ ] **Step 5: Commit** "Build the upload page and the uploaded list".

### Task 15: Docker, CI and docs

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.env.example`, `README.md` (app), `scripts/docker-smoke.sh`, `.github/workflows/app.yml`
- Modify (repo root): `AGENTS.md` and `README.md`, adding a "Web player (`app/`)" section with the commands below

**Interfaces:**
- Consumes everything above. Produces image `letra-app`, compose services `app` and `libretranslate` (profile `libretranslate`), and volumes `letra-data` and `lt-models`.

- [ ] **Step 1: Write `scripts/docker-smoke.sh`.** It must exit non-zero on any failed check. The steps:
  1. `docker compose -p letra-smoke up -d --build`, with `UPLOAD_PASSWORD=smoke` and `TRANSLATOR=fake` passed through the environment.
  2. Wait up to 60 s for `/healthz`.
  3. Log in with curl and a cookie jar, then upload `test/fixtures/song.mp3`.
  4. Check `GET /t/<id>` for `og:title`, and `GET /media/<id>/audio` with `Range: bytes=0-99` for status `206`.
  5. Always run `docker compose -p letra-smoke down -v` at the end.
- [ ] **Step 2: Run `bash scripts/docker-smoke.sh`.** Expected: FAIL (no Dockerfile).
- [ ] **Step 3: Implement.**
  - `Dockerfile` build stage: `node:22-alpine`, `apk add --no-cache python3 make g++`, `npm ci`, `npm run typecheck`, `npm run build`, `npm prune --omit=dev`.
  - Runtime stage: `node:22-alpine`. Copy `server/`, `shared/`, `dist/`, `node_modules/` and `package.json`; run as `USER node`; set `ENV DATA_DIR=/data NODE_ENV=production`; create `/data` owned by `node`; `VOLUME /data`; `EXPOSE 3000`; `HEALTHCHECK CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1`; `CMD ["node","server/index.ts"]`.
  - Compose per spec §10, with LibreTranslate pinned to `libretranslate/libretranslate:v1.9.6` and `LT_LOAD_ONLY` from the spec.
  - `.env.example` lists every variable in spec §9.
  - The app `README.md` covers the topics in spec §10.
  - `app.yml` triggers on `pull_request` and on `push` to `main`, with paths `app/**` and `.github/workflows/app.yml`. It runs on `ubuntu-24.04` with Node 22: `npm ci`, `npm run typecheck`, `npm test`, `npx playwright install --with-deps chromium`, `npm run build`, `npm run test:e2e`, then `bash scripts/docker-smoke.sh`. The working directory is `app`.
- [ ] **Step 4: Run, from `app/`: `bash scripts/docker-smoke.sh`, `npm run typecheck`, `npm test`, `npm run test:e2e`.** Then, from the repo root: `python3 validate_collection.py --root .`, `python3 -m unittest discover -s tests -b` and `./tests/run_tests.sh`. Expected: all pass.
- [ ] **Step 5: Commit** "Package the web player with Docker and add its CI".
