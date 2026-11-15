# letra v3, stage 3: line translation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a listener translate a saved line into Portuguese or English from `/salvas`, with a translation engine that runs on Hugging Face in production and on a small model in Docker.

**Architecture:** The server gains one engine (`chat`, for any endpoint that speaks OpenAI's chat completions), one service method (`translateLine`, with its own cache table) and one public route. The summary route says whether translation is on. On `/salvas`, each row gets a translate button and a small menu; the menu's keyboard and closing behavior is taken out of the player's language menu into a shared module that both use. The translation is kept in the saved record, in the browser.

**Tech Stack:** Node 22 (erasable TypeScript, `.ts` import specifiers), Fastify 5, SQLite (better-sqlite3), Vite 8 with vanilla TS and CSS, vitest (node environment, no DOM), Playwright 1.63 with the preinstalled Chromium, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-11-10-letra-v3-design.md`: section 8, and the parts of sections 9 to 12 that name line translation.

## What the planning probes found

Two things in this plan come from running the Docker model (`Hy-MT2-1.8B`, Q4_K_M, 2 CPUs and 2 GB) before writing it. Both change what the spec says, so the owner should read them.

1. **The model translates instructions it finds among the lyrics.** A message with several instruction lines, a "Song:" line and the lyrics came back with the instructions translated too (10 lines for a 6-line verse). The shape below worked every time: a background block, one instruction paragraph, then the text. It gave 6 lines for 6, 24 for 24 (with a repeated chorus, 34 s), and exactly one line for one line with context (2 to 3 s). Decision 1 fixes that shape for every endpoint.
2. **The model can not name a language.** Asked for the language of four samples in three wordings, it called Japanese "en-us", Portuguese "fr" and Spanish "español EN". A wrong language is worse than none: the page would tell a listener "Esta linha já está em inglês." about a Japanese song. Decision 2 adds a switch to turn the language question off, and the Docker profile's instructions turn it off.

## Decisions where the spec is silent

The spec does not settle these. Each is decided here so that every task has one answer; the owner can reverse any of them in review.

1. **The message's shape.** One user message in three parts: `[Background Information]` (the song and, when given, the lines around), one instruction paragraph, `[Source Text]` (the lines). The exact text is in Task 3.
2. **A switch for the language question.** A fourth variable, `TRANSLATE_DETECT_LANGUAGE` (`true` by default). With `false` the chat engine does not ask for the language and reports it as unknown. With the Docker model alone, the "already in this language" note then never shows and the menu never disables a language. The README says so.
3. **A known language is passed down.** The engine input also gains `sourceLang`. The service passes the song's `lyricsLang`; the chat engine skips its language question when it gets one. A saved line then costs one request, not two.
4. **The language learned from a line call is kept.** When the song's language is unknown, the engine works it out from the lines it has (the line and its context), and the service stores it on the song, as the whole-lyrics call does.
5. **The model file is fetched with `curl`** by the container's start command, into the named volume, and the image is pinned (`server-b12242`). The server's own downloader could not be tried here; the `curl` path was run with the file already in the volume.
6. **The menu has two languages, named in Portuguese** ("Português", "Inglês"), sent as `pt-BR` and `en`.
7. **The disabled language stays in the arrow-key order**, marked `aria-disabled`, so a screen reader reads its note. Enter and a click on it do nothing.
8. **The button is white** while a translation shows, while its menu is open and while the line is translating, as in the approved mockup. Otherwise it is gray.
9. **The menu opens below the button**, right edges aligned, and above it when there is no room below. It takes the app's menu surface (`--menu-bg`), like the two menus the app has, and the mockup's sizes and type.
10. **A note takes the translation's place.** The failure text, the same-language text and the line-changed text show where the translation goes, until the listener chooses again or leaves the page. A note never changes a stored translation. Notes and the "Traduzindo…" text are kept in memory: they survive the page being drawn again, not a reload.
11. **A newer choice wins.** Choosing again while a line translates drops the first answer when it arrives.
12. **The record's language follows the server.** Any answer that names the lyric's language updates the record's `lang`, not only the same-language one.
13. **A translation is written only into the record it was asked for**: same song, same position, same text. If the record is gone or changed meanwhile, nothing is written.
14. **A refused write** (storage full or blocked) shows the toast "Não foi possível salvar neste navegador." and the row stays as it was.
15. **The buttons do not pop in.** The page remembers the last `translationEnabled` answer in `localStorage` (`letra.translation.enabled.v1`) and draws from it at once.
16. **Announcements.** One polite live region announces the translation and the three notes. The "Traduzindo…" text is not announced.
17. **After "Tentar de novo"**, focus goes to the row's translate button.
18. **`auto` with half of the chat engine's variables** skips that engine and logs one warning at startup. `TRANSLATOR=chat` with half of them stops the server, as the spec says.
19. **A blank answer from an engine** counts as a failure, so nothing blank is cached.
20. **The owner list's row menu keeps its own code.** Only the player's language menu moves to the shared module.

## Global Constraints

- Paths are relative to `app/`. Run npm commands from `app/`.
- No new dependencies. The chat engine uses the `fetch` it is given.
- UI copy is pt-BR, sentence case. Every string comes from section 10 of the spec, character for character; the ones this stage uses are quoted in the tasks. Repo docs and code comments are in English.
- Text from the store or the server reaches the page only as text nodes (`el()` children or `textContent`), never as HTML.
- Secrets: no key or token in the repository, in test files, in logs or in error messages. The chat engine's errors name the status or the failure, never the key or the request body.
- Motion: only `transform`, `translate`, `scale`, `opacity` and `filter` move; colors may fade. Never `transition: all`. Every duration and easing is a token from `web/shared/tokens.css`. `prefers-reduced-motion: reduce` makes every change immediate; the global rule in `web/shared/base.css` stays as it is.
- Accessibility floor: visible focus ring, 44 px touch targets, no horizontal scroll at 360 px.
- Icons come from `@phosphor-icons/core` only. No TIDAL or Apple assets.
- In the upload entry an icon's size is set on its `svg` (`width` and `height`); `font-size` does not size it there.
- Tests: no network. Engine tests use a stub `fetch`; API tests use `buildApp` with translators passed in; end-to-end tests use the fake engine. vitest has no DOM. Playwright uses the preinstalled Chromium; never run `playwright install`; pass `--trace off`. Never loosen a test; change an asserted value only where this plan names it. No fixed sleeps in new tests: wait on a condition, or drive time with `page.clock`.
- Every end-to-end spec imports `test` and `expect` from `test/e2e/helpers.ts`.
- The fake engine answers `[<code>] <line>` and reports the lyrics as `en`. So, end to end, "Português" gives a translation and "Inglês" gives the same-language answer.
- The fixture `song.mp3` has four synced lines, at 0.5, 2.5, 4.5 and 6.5 s: "Primeiro verso da música", "Segundo verso, um pouco mais longo para quebrar a linha em telas estreitas", "Terceiro verso", "Último verso".
- Never commit `dist/`, `.data/`, `test-results/`, `playwright-report/` or `*.db`.
- Every commit message ends with the two attribution lines given in the task dispatch (`Co-Authored-By` and `Claude-Session`), exactly as given there.

## Review Focus

Inputs the spec implies and a listener or an owner will meet. Each has its test in the task named.

1. **An endpoint that does not answer in the asked shape**: blank lines between the lines, a reasoning block before them, fewer or more lines than asked. The engine cleans the answer or redoes the chunk line by line. Task 3.
2. **The same text twice in a song** (a chorus): the route takes the line at the saved position, the cache holds one entry for both, and a stale position still finds the text. Tasks 4 and 5.
3. **Text that needs encoding or looks like markup** (`&`, `#`, `+`, `?`, quotes, `<b>`), in the request and in the answer: matched exactly and drawn as text. Tasks 5 and 7.
4. **A row drawn again or removed while its request is in flight** (another tab saves a line, the song details arrive, the listener removes the line): the answer lands on the new row, or is dropped. Task 8.
5. **An engine that is half set up or refuses** (one variable missing, a wrong key, no credits, too many requests): a startup message or warning; the next engine gets its turn; the row shows the failure text with "Tentar de novo". Tasks 3 and 8.

## File Structure

New:

- `server/lib/translate/chat.ts`: the chat engine.
- `web/shared/menu.ts`: the floating menu's behavior (keys, focus, closing).
- `web/upload/line-translate.ts`: the translate button, its menu and the row's states.
- `test/unit/translate-chat.test.ts`, `test/e2e/line-translate.spec.ts`.

Changed:

- `server/lib/translate/types.ts`, `claude.ts`: the engine input (`context`, `sourceLang`), the `chat` name.
- `server/db.ts`: the `line_translations` table; one `clear` for both caches.
- `server/config.ts`, `server/lib/translate/engines.ts`: the `chat` mode and its variables.
- `server/lib/translate/service.ts`: `translateLine`.
- `server/routes/translation.ts`, `server/routes/tracks.ts`: the line route; `translationEnabled` in the summary.
- `shared/types.ts`: `LineTranslationDTO`, `SummaryResponse`.
- `web/shared/api.ts`: `getSummary`, `getLineTranslation`.
- `web/shared/saved.ts`, `web/shared/toast.ts`, `web/upload/saved-section.ts`: leftovers from stage 2's review (Task 1).
- `web/player/translation.ts`: uses the shared menu.
- `web/upload/saved-page.ts`, `web/upload/saved.css`: the button, the menu, the states.
- `docker-compose.yml`, `.env.example`, `README.md`: the chat engine and the `hymt` profile.

---

### Task 1: Leftovers from stage 2's review

Small fixes the final review of stage 2 left for this plan, in files this stage builds on.

**Files:**
- Modify: `web/shared/saved.ts`, `web/shared/toast.ts`, `web/upload/saved-page.ts`, `web/upload/saved-section.ts`, `web/upload/styles.css`, `web/player/styles.css`
- Test: `test/unit/saved.test.ts`, `test/e2e/saved-page.spec.ts`, `test/e2e/home-saved.spec.ts`, `test/e2e/save-line.spec.ts`

**Interfaces:**
- Produces:

  ```ts
  // web/shared/saved.ts
  /** True for an id the server can have: ten letters or digits. */
  export function isTrackId(id: string): boolean; // /^[0-9A-Za-z]{10}$/
  /**
   * Changes the record of that song and position, if its text is still `text`. Keys absent from
   * `patch` are left as they are. True when the record was found and the write was kept.
   */
  export function setLineTranslation(
    trackId: string,
    index: number,
    text: string,
    patch: { tr?: SavedLine["tr"]; lang?: string | null },
    store?: KeyValueStore | null,
  ): boolean;
  ```

  No code calls `setLineTranslation` yet; its existing unit tests take the new arguments and keep their assertions.

- [ ] **Step 1: Write the failing tests**

  `test/unit/saved.test.ts`:

  1. `setLineTranslation writes tr and answers true`: after `setLineTranslation(id, 2, "Terceiro verso", { tr: { lang: "en", text: "Third verse" } }, store)`, the record's `tr` is that object, its `lang` is unchanged, and the call returned `true`.
  2. `setLineTranslation leaves a record whose text differs`: with the text `"Outro texto"` it returns `false` and the stored list is unchanged. The same for a position with no record.
  3. `setLineTranslation patches lang alone`: `{ lang: "pt" }` sets `lang` and leaves `tr` as it was.
  4. `setLineTranslation answers false when the store refuses the write`: with a store whose `setItem` throws.
  5. `isTrackId`: `true` for `"KyD0ZYYTz6"`; `false` for `""`, `"abc"`, `"não é um id"`, `"KyD0ZYYTz6x"`, `"KyD0ZYYT-6"`.

  `test/e2e/saved-page.spec.ts`:

  6. `a record with an id the server would refuse does not stop the other songs' refresh`: seed one line of an uploaded track with `title: "Título antigo"` and one record with `trackId: "não é um id"`. The first song's `h2` becomes the uploaded title; the second song's section has `is-gone`; the one request to `/api/tracks/summary` carries only the uploaded id.
  7. `focus on a row that goes away moves to the title`: seed two lines; focus the second row's link; remove that record from `localStorage` in the page and dispatch `new StorageEvent("storage", { key: "letra.saved.v1" })`. The `h1` has focus.
  8. `the page reads the store again when it comes back from the back/forward cache`: with one line shown, write a second record into `localStorage` in the page and dispatch `new PageTransitionEvent("pageshow", { persisted: true })`. Two rows show. (This behavior exists; the test guards it and passes before the fixes.)
  9. `Desfazer does nothing once its toast is leaving`: install `page.clock`; remove a line with the pointer; run the clock 5000 ms; click `[data-toast-action]` through `page.evaluate` (`element.click()`). The line does not come back and the store stays empty.
  10. `removing a line another tab already removed shows no error`: seed two lines; remove the first record from `localStorage` in the page (no event); click that row's remove button. No toast shows (`[data-toast]` has no `is-shown`), one row is left and the count reads "1 linha em 1 música".

  `test/e2e/home-saved.spec.ts`:

  11. `a card with an id the server would refuse is drawn as unavailable and the others refresh`: as test 6, on the home cards.

  `test/e2e/save-line.spec.ts`:

  12. `the marks follow the store when the page comes back from the back/forward cache`: on the player, write a record for verse 0 into `localStorage` in the page and dispatch the same `pageshow` event. Verse 0 has `data-saved`. (Guard test; passes before the fixes.)

- [ ] **Step 2: Run them and see 1 to 7 and 9 to 11 fail**

  Run: `npx vitest run test/unit/saved.test.ts` and `npm run test:e2e -- saved-page home-saved save-line`

- [ ] **Step 3: Make the changes**

  - `saved.ts`: `isTrackId` and the new `setLineTranslation`.
  - `saved-page.ts` and `saved-section.ts`: only ids that pass `isTrackId` go to the summary route; a record with any other id counts as a song the server no longer has. With no id left to ask, no request is made.
  - `saved-page.ts`, `draw()`: when focus was on a row that is not there after the redraw, focus goes to the page's `h1`.
  - `saved-page.ts`, `remove()`: when the store no longer holds the row's record, read the store again and draw, with no toast.
  - `toast.ts`: the action button does nothing when the toast no longer has `is-shown`. Both stylesheets: `.toast:not(.is-shown) { pointer-events: none; }`.

- [ ] **Step 4: Run the whole suite**

  Run: `npm run typecheck && npm test && npm run test:e2e`
  Expected: all pass.

- [ ] **Step 5: Commit**

  `git commit -m "Fix leftovers from the saved-lines review: refused ids, lost focus, a late undo"`

---

### Task 2: The engine input and the line cache

**Files:**
- Modify: `server/lib/translate/types.ts`, `server/lib/translate/claude.ts`, `server/db.ts`
- Test: `test/unit/translate-engines.test.ts`, `test/unit/db.test.ts`

**Interfaces:**
- Produces:

  ```ts
  // server/lib/translate/types.ts
  export type TranslateInput = {
    title: string;
    artist: string;
    lines: string[];
    target: Language;
    /** Lines around `lines` in the song, for meaning only. Never translated, never returned. */
    context?: { before: string[]; after: string[] };
    /** The lyrics' language when the caller knows it (a BCP-47 tag). An engine may skip working it out. */
    sourceLang?: string | null;
  };
  export type Translator = {
    name: "claude" | "chat" | "libretranslate" | "fake";
    translate(i: TranslateInput): Promise<{ sourceLang: string | null; lines: string[] }>;
  };

  // server/db.ts
  export type StoredLineTranslation = {
    trackId: string; lang: string; lineHash: string; text: string;
    engine: string; sourceLang: string | null; sameLanguage: boolean; createdAt: string;
  };
  // Db gains:
  lineTranslations: {
    get(trackId: string, lang: string, lineHash: string): StoredLineTranslation | null;
    put(t: StoredLineTranslation): void; // replaces the entry with the same key
  };
  // Db.translations.clear(trackId) now removes the song's rows from both tables.
  ```

  The three places that call `db.translations.clear` (lyrics edited, searched again, repaired) stay as they are: the one function clears both caches.

- [ ] **Step 1: Write the failing tests**

  `test/unit/db.test.ts`:

  1. `a database from before this stage gains line_translations`: build a file by hand with `better-sqlite3` (the two `CREATE TABLE` statements of the first migration, copied into the test, and `PRAGMA user_version = 1`), with one track in it. `openDb(file)` keeps the track, `lineTranslations.put` and `get` work, and `user_version` is 2.
  2. `round-trips a line translation; put replaces it`: `sameLanguage` comes back as a boolean, a null `sourceLang` as null.
  3. `clear removes the song's whole and line translations and leaves another song's`.
  4. `deleting a track cascades its line translations`.

  `test/unit/translate-engines.test.ts`:

  5. `claude passes the context and asks to translate only lines`: with `context: { before: ["a"], after: ["b"] }` the JSON in the user message has `context` equal to that object, and the system prompt contains `translate and return only "lines"`.
  6. The existing `claude request shape` test gains one assertion: without `context`, the payload has no `context` key.

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run test/unit/db.test.ts test/unit/translate-engines.test.ts`

- [ ] **Step 3: Make the changes**

  - `types.ts`: as above.
  - `db.ts`: a second entry in `MIGRATIONS`, the spec's table character for character:

    ```sql
    CREATE TABLE line_translations (
      track_id      TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      lang          TEXT NOT NULL,
      line_hash     TEXT NOT NULL,
      text          TEXT NOT NULL,
      engine        TEXT NOT NULL,
      source_lang   TEXT,
      same_language INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL,
      PRIMARY KEY (track_id, lang, line_hash)
    );
    ```

  - `claude.ts`: with `context`, the JSON payload gains `context: { before, after }`. The system prompt gains one line: `When "context" is given, it holds the lines around "lines" in the song: use it for meaning only, and translate and return only "lines".` The engine ignores `sourceLang`.
  - `libretranslate.ts` and `fake.ts` need no change: they ignore both new fields.

- [ ] **Step 4: Run the unit and API tests**

  Run: `npm run typecheck && npm test`
  Expected: all pass.

- [ ] **Step 5: Commit**

  `git commit -m "Add the line translation cache and the context and source language to the engine input"`

---

### Task 3: The chat engine and its configuration

**Files:**
- Create: `server/lib/translate/chat.ts`, `test/unit/translate-chat.test.ts`
- Modify: `server/config.ts`, `server/lib/translate/engines.ts`, `test/unit/config.test.ts`, `test/unit/translate-engines.test.ts`

**Interfaces:**
- Consumes: `TranslateInput`, `Translator`, `TranslationError` (Task 2); `normalizeLangTag` from `shared/languages.ts`.
- Produces:

  ```ts
  // server/lib/translate/chat.ts
  export function createChatTranslator(o: {
    url: string;            // base URL ending in /v1, no trailing slash
    apiKey: string | null;
    model: string;
    detectLanguage: boolean;
    fetch: typeof fetch;
    timeoutMs?: number;     // per request; 60 000 by default
  }): Translator;           // name "chat"

  // server/config.ts
  export type TranslatorMode = "auto" | "claude" | "chat" | "libretranslate" | "fake" | "off";
  // Config gains:
  translateApiUrl: string | null;      // TRANSLATE_API_URL, trailing slashes removed
  translateApiKey: string | null;      // TRANSLATE_API_KEY
  translateModel: string | null;       // TRANSLATE_MODEL
  translateDetectLanguage: boolean;    // TRANSLATE_DETECT_LANGUAGE: "true" (default) or "false"; anything else stops the server
  ```

**The protocol:**

- Every request is `POST <url>/chat/completions` with `content-type: application/json`, the header `authorization: Bearer <key>` only when there is a key, `AbortSignal.timeout(timeoutMs)`, and the body `{ model, messages: [{ role: "user", content }], temperature: 0, stream: false }`. There is no system message.
- The answer is `choices[0].message.content`, a string. From it the engine removes every `<think>…</think>` block, splits on line breaks, trims each line and drops the blank ones.
- The translation message, with `<name>` from the table below (the language's own name from `target.name` for a code that is not in it):

  ```text
  [Background Information]
  Song: "<title>" by <artist>
  Lines before, for context only:
  <the context's before lines, one per line>
  Lines after, for context only:
  <the context's after lines, one per line>

  Please translate the following song lyrics into <name> (<code>), line by line, taking the provided background information into consideration. Keep the meaning and the tone rather than translating word for word. Keep exactly one output line per input line, in the same order, and output only the translated lines, without any additional explanation.

  [Source Text]
  <the lines, one per line>
  ```

  With a blank artist the song line is `Song: "<title>"`. A "Lines before" or "Lines after" part shows only when it has lines.

  | Code | Name | Code | Name |
  |---|---|---|---|
  | `pt-BR` | Brazilian Portuguese | `ko` | Korean |
  | `en` | English | `zh` | Simplified Chinese |
  | `es` | Spanish | `ru` | Russian |
  | `fr` | French | `tr` | Turkish |
  | `de` | German | `pl` | Polish |
  | `it` | Italian | `nl` | Dutch |
  | `ja` | Japanese | `hi` | Hindi |

- **Chunks.** The lines go in chunks of up to 24, one request after another; the context, when given, goes with every chunk. A chunk whose answer has another number of lines is redone one line per request, with the same message. A one-line request that comes back with several lines gives them joined by one space; with none, it fails.
- **The language question.** Asked first, and only when `detectLanguage` is true and the input's `sourceLang` is not a valid tag. The message:

  ```text
  What language is the following text written in? Answer with its BCP-47 language code only (for example: en, pt-BR, ja), without any additional explanation:

  <the first 6 non-blank lines of: the context's before lines, the lines, the context's after lines>
  ```

  The answer, without surrounding quotes or backticks and without a final period, goes through `normalizeLangTag`; anything that is not a tag is `null`. When the question is not asked, the engine reports the input's `sourceLang` if it is a valid tag, else `null`.
- **Failures.** A status that is not 2xx, a network error, a timeout, a body that is not JSON or has no text: each is a `TranslationError("engine", …)` whose message names the status or the cause.

**Configuration:**

- `TRANSLATOR=chat` builds only this engine. Without `TRANSLATE_API_URL` or without `TRANSLATE_MODEL`, `createEngines` throws `TRANSLATOR=chat requires TRANSLATE_API_URL and TRANSLATE_MODEL`.
- `auto` builds, in this order, the engines that are set up: Claude (its key), chat (both its URL and its model), LibreTranslate (its URL). With only one of the chat engine's two, `auto` skips it and logs once: `TRANSLATE_API_URL and TRANSLATE_MODEL must both be set; the chat engine is off`.

- [ ] **Step 1: Write the failing tests**

  `test/unit/translate-chat.test.ts` (a stub `fetch` that records each call and answers from a queue; `detectLanguage: false` unless the test is about it):

  1. `request shape`: the URL is `<url>/chat/completions`; the method is POST; the body has the model, `temperature: 0`, `stream: false` and exactly one message, with the role `user`; its content equals the message above for a title, an artist and two lines into `pt-BR` (the whole string is asserted). The result has the two answered lines.
  2. `the key goes in the Authorization header, and only when there is one`.
  3. `context lines go in the background, not in the source text`: the whole content is asserted, with two lines before and one after.
  4. `a blank artist and an unlisted language`: the song line has no "by"; a target `{ code: "sv", name: "Svenska" }` reads `Svenska (sv)`.
  5. `lyrics go in chunks of 24, in order, one request at a time`: 50 lines make three requests (24, 24 and 2 lines after `[Source Text]`); the second starts only after the first has answered; the result has the 50 lines in order.
  6. `a chunk with the wrong number of lines is redone line by line`: a 3-line chunk answered with 2 lines is followed by three one-line requests; the result has their 3 lines.
  7. `a one-line answer in several lines is joined; an empty one fails`.
  8. `blank lines and a reasoning block are dropped from the answer`: `"<think>hm\nhm</think>\n\nUm\n\nDois\n"` for two lines gives `["Um", "Dois"]`.
  9. `the language question comes first and reads a tag`: with `detectLanguage: true` the first request's content is the question with the first 6 non-blank lines; the answers `"pt-BR"`, `` "`en`." `` and `"PT"` give `pt-BR`, `en` and `pt`; `"Portuguese"` and `"español EN"` give `null`.
  10. `a known language skips the question`: with `sourceLang: "en"` there is no question and the result's `sourceLang` is `en`; with `sourceLang: "English"` the question is asked.
  11. `with detection off the engine asks nothing and reports what it was given`: `null` with no input language.
  12. `HTTP errors, a network error and a malformed body are engine errors`: 401, 402, 429 and 500 give a `TranslationError` of kind `engine` whose message has the status; a rejected `fetch` and a body of `{}` too. No message contains the key.
  13. `a request that does not answer in time is an engine error`: a `fetch` that settles only when its signal aborts, with `timeoutMs: 20`.

  `test/unit/config.test.ts`:

  14. `chat mode and its variables`: `TRANSLATOR=chat` is accepted; `TRANSLATE_API_URL=https://x.test/v1/` reads as `https://x.test/v1`; the key and the model read as given, `null` when blank; `TRANSLATE_DETECT_LANGUAGE` is `true` when unset, `false` for `"false"`, and `"no"` throws an error naming the variable.

  `test/unit/translate-engines.test.ts`:

  15. `chat mode needs its URL and its model`: `createEngines` throws the message above with either missing.
  16. `auto order is claude, chat, libretranslate`: with all three set up, the names are exactly that array. The existing `createEngines chains by mode` test keeps its assertions.
  17. `auto skips a half set up chat engine and warns once`.

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run test/unit/translate-chat.test.ts test/unit/config.test.ts test/unit/translate-engines.test.ts`

- [ ] **Step 3: Write `chat.ts`, the config fields and the `chat` branch of `createEngines`**

- [ ] **Step 4: Run the unit and API tests**

  Run: `npm run typecheck && npm test`
  Expected: all pass.

- [ ] **Step 5: Commit**

  `git commit -m "Add the chat translation engine for OpenAI-compatible endpoints"`

---

### Task 4: `translateLine` in the service

**Files:**
- Modify: `server/lib/translate/service.ts`, `shared/types.ts`
- Test: `test/unit/translate-service.test.ts`

**Interfaces:**
- Consumes: `db.lineTranslations` and `TranslateInput` (Task 2).
- Produces:

  ```ts
  // shared/types.ts
  export type LineTranslationDTO = { lang: string; sourceLang: string | null; sameLanguage: boolean; text: string };

  // the object createTranslationService returns gains:
  /** `track.lyrics.lines[index]` must exist and have text: the caller checks. */
  translateLine(track: Track, index: number, lang: string): Promise<LineTranslationDTO>;
  ```

**Behavior.** With `text` the line's text and `hash` the sha1 of it, in hex:

1. `track.lyricsLang` is known and has the same primary language as `lang`: answer `{ lang, sourceLang: track.lyricsLang, sameLanguage: true, text: "" }`. No engine, nothing stored.
2. The whole-lyrics translation for `lang` is cached: if it says same language, answer that; else, if its line at `index` has text, answer with it. Otherwise go on.
3. The line cache has `(track.id, lang, hash)`: answer from it.
4. Else call the engines in order with `lines: [text]`, `context` (the two nearest lines with text before `index` and the two after, in song order) and `sourceLang: track.lyricsLang`. One retry when an engine returns another number of lines, then the next engine, as for whole lyrics. An answer whose line is blank is a failure. When every engine fails, the last error is thrown.
   - The result's language goes through `normalizeLangTag`. Same primary language as `lang` means `sameLanguage: true` and `text: ""`.
   - It is stored only if the song still exists and still has a line with that text. Then, if the language is known and the song has none, the song's `lyricsLang` is set.

- Line calls take a permit from the same limit of 2 as whole-lyrics calls.
- Callers asking for the same song, language and hash while a call runs share it. A failure is shared by those waiting and is not kept.
- The whole-lyrics call also passes `sourceLang: track.lyricsLang` to the engine.

- [ ] **Step 1: Write the failing tests** (`test/unit/translate-service.test.ts`, with the file's existing helpers)

  1. `translateLine: the song's own language answers sameLanguage with no engine call`: `lyricsLang: "pt-BR"`, `lang: "pt-BR"`; also `lyricsLang: "pt"` with `lang: "pt-BR"`.
  2. `translateLine: a cached whole-lyrics translation gives its line`: no engine call; with a cached same-language translation the answer is `sameLanguage: true`.
  3. `translateLine: the second call comes from the line cache`: one engine call for two calls; a call for another position with the same text makes none either.
  4. `translateLine: the engine gets the line, its context and the known language`: for a song with a blank line among them, `lines` is the one line, `context.before` and `context.after` hold the two nearest lines with text on each side, in song order; for position 0, `before` is empty. `sourceLang` is the song's `lyricsLang`.
  5. `translateLine: an engine saying it is the same language is cached with no text and sets the song's language`.
  6. `translateLine: falls to the next engine; when all fail it rejects and caches nothing`.
  7. `translateLine: an empty answer is a failure`.
  8. `translateLine: callers share one call, and a failure is shared and not kept`.
  9. `translateLine: line calls and whole-lyrics calls share the limit of 2`: with two whole-lyrics calls held open, a line call's engine does not start until one of them ends.
  10. `translateLine: lyrics that changed during the call: answered, not stored`.
  11. `the whole-lyrics call passes the song's known language to the engine`.

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run test/unit/translate-service.test.ts`

- [ ] **Step 3: Write `translateLine` and add `LineTranslationDTO`**

- [ ] **Step 4: Run the unit and API tests**

  Run: `npm run typecheck && npm test`
  Expected: all pass.

- [ ] **Step 5: Commit**

  `git commit -m "Translate one line through the caches and the engines"`

---

### Task 5: The line route and `translationEnabled`

**Files:**
- Modify: `server/routes/translation.ts`, `server/routes/tracks.ts`, `shared/types.ts`, `web/shared/api.ts`
- Test: `test/api/translation.test.ts`, `test/api/summary.test.ts`

**Interfaces:**
- Consumes: `translateLine`, `LineTranslationDTO` (Task 4).
- Produces:

  ```ts
  // shared/types.ts
  export type SummaryResponse = { tracks: TrackSummary[]; translationEnabled: boolean };

  // web/shared/api.ts
  /** With no ids: no request, `{ tracks: [], translationEnabled: false }`. */
  export function getSummary(ids: string[]): Promise<SummaryResponse>;
  export function getSummaries(ids: string[]): Promise<TrackSummary[]>; // as today, for its two callers
  export function getLineTranslation(id: string, index: number, lang: string, text: string): Promise<LineTranslationDTO>;
  ```

**The route:** `GET /api/tracks/:id/translation/line?index=<n>&lang=<code>&text=<line>`, public, with its own count of 30 requests a minute per client and the same 429 answer as the whole-lyrics route. The checks, in this order:

| Check | Answer |
|---|---|
| No engine | 404 `translation_off`, "Tradução desativada." |
| `lang` not in `LANGUAGES` | 400 `bad_language`, "Idioma não suportado." |
| `index` is not one to six digits, or `text` is missing or blank | 400 `bad_request`, "Pedido inválido. Confira os dados e tente de novo." |
| No such song | 404 `not_found`, "Música não encontrada." |
| No line with that text | 404 `line_changed`, "Esta linha mudou na música e não pode ser traduzida." |
| Every engine failed | 503 `translation_unavailable`, "Tradução indisponível agora." |

The line is the one at `index` when its text equals `text` exactly; else the first line whose text equals `text`. The answer is the service's `LineTranslationDTO`.

The summary route answers `{ tracks, translationEnabled: app.translation.enabled }`.

- [ ] **Step 1: Write the failing tests**

  `test/api/translation.test.ts`:

  1. `line: 200 with the translated line`: `index=0`, `lang=pt-BR` and the first line's text give `{ lang: "pt-BR", sourceLang: "en", sameLanguage: false, text: "[pt-BR] Primeiro verso da música" }`.
  2. `line: the text decides when the position is stale`: `index=3` with the first line's text gives the first line's translation; `index=0` with `"outra linha"` gives 404 `line_changed`; `index=99` with the first line's text gives the translation.
  3. `line: a chorus is taken at its own position`: for lyrics with the same text at positions 1 and 3, a counting engine sees, for `index=3`, the context around position 3; a second request with `index=1` makes no engine call.
  4. `line: text with reserved characters is matched as it is`: lyrics with the line `Rock & roll #1: 50% "love" + <b>você</b>?`, asked through `encodeURIComponent`, give 200.
  5. `line: each error`: `translation_off` with no engines; `bad_language` for `lang=xx` and no `lang`; `bad_request` for `index` missing, `-1`, `1.5`, `abc`, `1234567`, and for `text` missing or blank; `not_found` for an unknown id.
  6. `line: the song's own language makes no engine call`: after a whole-lyrics translation set the song's language to `en`, `lang=en` answers `sameLanguage: true` with empty text, and the counting engine's count does not change.
  7. `line: every engine failing gives 503 translation_unavailable`.
  8. `line: the 31st request in a minute from one client gives 429`.
  9. `line: editing the lyrics clears the line cache`: one engine call for two equal requests; after `PUT /api/tracks/:id/lyrics` with lyrics that still have the line, the same request calls the engine again.

  `test/api/summary.test.ts`:

  10. `the summary says whether translation is on`: `translationEnabled` is `true` with an engine and `false` with none; `tracks` is as before.

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run test/api/translation.test.ts test/api/summary.test.ts`

- [ ] **Step 3: Write the route, the summary field and the three client functions**

- [ ] **Step 4: Run the whole suite**

  Run: `npm run typecheck && npm test && npm run test:e2e`
  Expected: all pass (the summary's new field changes nothing for the pages yet).

- [ ] **Step 5: Commit**

  `git commit -m "Add the line translation route and say in the summary whether translation is on"`

---

### Task 6: The shared menu behavior

A move with no change in what the player does. The player's language menu keeps its markup, its styles and its tests.

**Files:**
- Create: `web/shared/menu.ts`
- Modify: `web/player/translation.ts`
- Test: `test/e2e/translation.spec.ts`

**Interfaces:**
- Produces:

  ```ts
  // web/shared/menu.ts
  export type Menu = {
    open(): void;
    /** Closes; with `focusTrigger`, focus goes to the trigger. Does nothing when closed. */
    close(focusTrigger?: boolean): void;
    readonly isOpen: boolean;
  };
  export function attachMenu(o: {
    trigger: HTMLElement;
    /** The element with role="menu". It needs an id. Shown and hidden with its `hidden` attribute. */
    menu: HTMLElement;
    /** The rows the arrow keys visit, in order. Read each time. */
    items(): HTMLElement[];
    /** The row that takes focus on opening; the first of items() when absent or when it returns none. */
    first?(): HTMLElement | undefined;
    /** Called before the menu shows: fill or update the rows here. */
    onOpen?(): void;
    onClose?(): void;
  }): Menu;
  ```

**What `attachMenu` does** (all of it is in `web/player/translation.ts` today):

- Sets `aria-haspopup="menu"`, `aria-expanded` and `aria-controls` on the trigger.
- A click on the trigger opens or closes. ↓ or ↑ on the trigger opens.
- In the menu: ↓ and ↑ move and wrap, Home and End jump, Esc closes with focus on the trigger, Tab closes with focus on the trigger (the browser then moves on from there).
- Focus leaving the menu and the trigger closes it. A pointer press inside does not count as leaving (Safari does not focus a pressed button), and `mousedown` inside the menu is prevented so focus stays put during the press.
- A pointer press outside the menu and the trigger closes it.
- New here: the listeners on `document` exist only while the menu is open, and go away when it closes or when the menu is no longer in the page. A row that is thrown away leaves nothing behind.
- Choosing a row stays with the caller: its click handler calls `close(true)` and then acts.

- [ ] **Step 1: Write the tests** (`test/e2e/translation.spec.ts`)

  1. `Tab closes the language menu and moves on`: with the menu open and a row focused, Tab closes the menu and focus is on the control after the pill.
  2. `a press outside closes the language menu`: a click on the page's heading closes it; focus is not moved to the pill.
  3. `Home and End jump to the first and last language`.

  These pin behavior the move must keep; they pass before it. The existing tests of this file (`the language menu works from the keyboard`, `focus leaving the menu closes it`, `a pointer press that blurs the focused row does not close the menu`, `switch language`) stay as they are.

- [ ] **Step 2: Run the file and see it pass**

  Run: `npm run test:e2e -- translation.spec`

- [ ] **Step 3: Write `web/shared/menu.ts` and make `mountTranslation` use it**

  `mountTranslation` keeps building the rows, the pill's text and the failure message. Its own code for opening, closing, keys, focus and outside presses goes away.

- [ ] **Step 4: Run the whole suite**

  Run: `npm run typecheck && npm test && npm run test:e2e`
  Expected: all pass, with no change to an existing test.

- [ ] **Step 5: Commit**

  `git commit -m "Move the floating menu's behavior to a shared module"`

---

### Task 7: The translate button and its menu on `/salvas`

The button, the menu and the straight path: choosing a language translates the line, shows it and keeps it. The texts for waiting and for what goes wrong are Task 8; until then the row does not change while the request runs, and a failed request leaves it as it was.

**Files:**
- Create: `web/upload/line-translate.ts`, `test/e2e/line-translate.spec.ts`
- Modify: `web/upload/saved-page.ts`, `web/upload/saved.css`, `test/e2e/translation-off.spec.ts`

**Interfaces:**
- Consumes: `attachMenu` (Task 6); `getSummary`, `getLineTranslation` (Task 5); `setLineTranslation` (Task 1).
- Produces: nothing a later task imports. `line-translate.ts` holds the control, the menu and (in Task 8) the row's states; `saved-page.ts` calls it when it builds a row. The two files' seam is the implementer's to shape.

**Row structure** (new parts marked `+`; the attributes are the tests' hooks):

```
li.saved-line[data-line][data-track][data-index]              + .has-menu while its menu is open
  a.saved-line-link[data-line-link]
    span.saved-q[data-line-text]
    span.saved-tr[data-line-translation][lang]                the record's translation
  div.saved-line-meta …
  div.saved-acts
+   div.saved-tr-wrap
+     button.saved-act.saved-translate[data-translate][aria-label="Traduzir linha"][aria-describedby=<id of the text>]
+         (translate icon; .is-on while a translation shows; aria-haspopup, aria-expanded, aria-controls from attachMenu)
+     div.line-menu[role="menu"][aria-label="Traduzir linha"][hidden]
+       button.menu-row[role="menuitemradio"][data-lang="pt-BR"][aria-checked]   span "Português" + check icon
+       button.menu-row[role="menuitemradio"][data-lang="en"][aria-checked]      span "Inglês" + check icon
+       button.menu-row[role="menuitem"][data-hide]                              "Ocultar tradução", only when the record has a translation
    button.saved-act[data-remove] …
```

- The translate button comes before the remove button. A row of a song the server no longer has gets no translate button, and no row gets one when translation is off.
- The language of the lyrics (the primary language of the record's `lang`: `pt` or `en`) has `aria-disabled="true"` and, in place of the check, `small.menu-note` with "Idioma da letra". With an unknown or other language both are enabled.
- `aria-checked` is `true` on the language of the record's translation. A record can carry a translation saved from the player in any of its languages (Spanish, say): it shows like any other, neither row has the check, and "Ocultar tradução" is there.
- The rows are filled when the menu opens, from the record as it is then.
- On opening, focus goes to the checked language, else to the first enabled row.

**Behavior:**

- **Knowing whether translation is on.** The page asks `getSummary` (in the same batches as today). Every answer carries `translationEnabled`; the page stores it in `localStorage` under `letra.translation.enabled.v1` (`"1"` or `"0"`) and draws its first frame from the stored value. A failed request changes nothing. Reads and writes of this key never throw.
- **Drawing again only on a change.** When the summaries arrive and nothing the page shows changed (no detail, no song gone, the same `translationEnabled`), the page is not drawn again. An open menu is not closed by that answer.
- **Any other redraw** closes an open menu. Focus that was on a translate button stays on the same row's translate button.
- **Choosing a language:** the menu closes with focus on the button. Choosing the language in use does nothing more. Otherwise the page calls `getLineTranslation(trackId, index, code, text)` with the record's text. On an answer with text, it calls `setLineTranslation(trackId, index, text, { tr: { lang: code, text: answer.text }, lang: answer.sourceLang })` (the `lang` key only when the answer names a language); when that returns `true`, the row shows the translation with `lang` set to the code.
- **"Ocultar tradução":** `setLineTranslation(trackId, index, text, { tr: null })`; the translation leaves the row; focus is on the button.
- A click inside `.saved-acts` never opens the song: the row's link stays under it, as for the remove button.

**Styles** (`web/upload/saved.css`; the sizes and colors are the approved mockup's):

```css
.saved-tr-wrap { position: relative; }
.saved-translate { color: rgb(175 175 182 / .8); transition: color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out); }
.saved-translate.is-on, .saved-translate[aria-expanded="true"] { color: var(--text-1); }
.saved-translate[aria-expanded="true"] { background: rgb(255 255 255 / .14); }
.saved-line.has-menu { z-index: 2; } /* its menu covers the rows below, their buttons included */
.line-menu {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 2; width: 232px; padding: 6px;
  border-radius: var(--radius-menu); background: var(--menu-bg);
  box-shadow: 0 18px 44px rgb(0 0 0 / .5), 0 0 0 1px var(--glass-border);
  transform-origin: top right; opacity: 1; scale: 1;
  transition: opacity var(--dur-exit) var(--ease-out), scale var(--dur-exit) var(--ease-out), display var(--dur-fast) allow-discrete;
}
.line-menu.is-up { top: auto; bottom: calc(100% + 6px); transform-origin: bottom right; }
.line-menu[hidden] { display: none; opacity: 0; scale: .96; transition-duration: var(--dur-fast); }
@starting-style { .line-menu { opacity: 0; scale: .96; } }
.line-menu .menu-row { gap: 12px; height: auto; min-height: 44px; border-radius: 8px; font-size: 15px; line-height: 20px; font-weight: 500; }
.line-menu .menu-row .icon { visibility: hidden; }
.line-menu .menu-row .icon svg { width: 16px; height: 16px; }
.line-menu .menu-row[aria-checked="true"] { background: var(--row-hover); }
.line-menu .menu-row[aria-checked="true"] .icon { visibility: visible; }
.line-menu .menu-row[aria-disabled="true"] { background: none; color: rgb(175 175 182 / .6); }
.menu-note { font-size: 13px; font-weight: 500; }
```

`.is-up` is set on opening when the menu's bottom would pass the viewport's bottom less 8 px, and cleared otherwise. The rows reuse `.menu-row` from `web/upload/styles.css`.

- [ ] **Step 1: Write the failing tests**

  `test/e2e/line-translate.spec.ts` (each test uploads `song.mp3`, seeds lines with `seedSaved` and opens `/salvas`):

  1. `a row of a song the server has gets a translate button; a row of a gone song does not`: the button is named "Traduzir linha", is described by its line's text, has `aria-haspopup="menu"` and `aria-expanded="false"`, is 44 by 44 px and comes before the remove button in Tab order.
  2. `the button opens a menu of two languages`: a click shows `[role="menu"]` named "Traduzir linha" with the two `menuitemradio` rows "Português" and "Inglês" and no "Ocultar tradução"; `aria-expanded` is `true`; the row has `has-menu`; focus is on "Português"; the button's color is `rgb(255, 255, 255)`. Before the click it is `rgba(175, 175, 182, 0.8)`.
  3. `the lyric's language is disabled and says why`: with a record whose `lang` is `pt-BR`, "Português" has `aria-disabled="true"` and the text "Idioma da letra", focus on opening is on "Inglês", and a click on "Português" sends no request and leaves the menu open. With `lang: "en-US"` it is "Inglês". With `lang: null` neither is disabled.
  4. `the menu works from the keyboard`: Enter on the button opens it; ↓ and ↑ move and wrap over both rows (a disabled row included); Esc closes it with focus on the button; ↓ on the button opens it again.
  5. `a press outside and focus leaving close the menu`.
  6. `choosing Português translates the line, shows it and keeps it`: exactly one request to the line route, with `index=0`, `lang=pt-BR` and the line's text; the row shows `[data-line-translation]` with "[pt-BR] Primeiro verso da música" and `lang="pt-BR"`; the stored record's `tr` is `{ lang: "pt-BR", text: "[pt-BR] Primeiro verso da música" }` and its `lang` is `en`; focus is on the translate button, which has `is-on`.
  7. `the translation is there after a reload, with a check on its language`: after test 6's steps and a reload, the translation shows with no request to the line route; in the menu "Português" has `aria-checked="true"`, "Inglês" is disabled (the record's language is now `en`), and "Ocultar tradução" is the last row.
  8. `choosing the language in use asks nothing`.
  9. `Ocultar tradução clears it`: the translation leaves the row; the record's `tr` is `null`; the button has no `is-on`; focus is on the button.
  10. `markup in a translation is drawn as text`: with the line route fulfilled as `{ lang: "pt-BR", sourceLang: "en", sameLanguage: false, text: "<b>oi</b> & tchau" }`, the translation's `textContent` is that string and the row has no `b` element.
  11. `the menu covers the next row's buttons`: with two lines and the first row's menu open, `document.elementFromPoint` at the center of the menu's second row is inside the menu.
  12. `the menu opens upward when there is no room below`: in a 1280 by 420 viewport with four lines, the last row's menu has `is-up` and its bottom edge is at or above the button's top.
  13. `at 360 px the menu stays inside the page`: its left edge is at 0 or more, its right edge at the viewport's width or less, and the document does not scroll sideways.
  14. `a click on the translate button or in its menu does not open the song`: the URL is still `/salvas`.
  15. `the buttons are there at once on a later visit`: after one visit, reload with the summary route held; the translate button shows before the route is released.
  16. `the page follows the server when translation goes off`: with the summary route fulfilled with `translationEnabled: false`, the buttons leave and the stored value is `"0"`.
  17. `the song details arriving do not close an open menu`: hold the summary route (the stored value is `"1"` from a first visit), open a menu, release the route; the menu is still open and focus is still inside it.
  18. `another tab's change closes the menu and keeps focus on the button`: with a menu open, dispatch the `storage` event for `letra.saved.v1`; the menu is gone and focus is on the same row's translate button.
  19. `a translation saved from the player in another language can be hidden`: with a record seeded with `tr: { lang: "es", text: "Primer verso" }`, the row shows it, the button has `is-on`, neither language has `aria-checked="true"`, and "Ocultar tradução" clears it.

  `test/e2e/translation-off.spec.ts`:

  20. `/salvas has no translate button when translation is disabled`: with one saved line, after the summary has answered, there is no `[data-translate]`.

  `test/unit/motion-css.test.ts` already reads `upload/saved.css`: its token checks must pass with the new rules.

- [ ] **Step 2: Run them and see them fail**

  Run: `npm run test:e2e -- line-translate translation-off`

- [ ] **Step 3: Write `line-translate.ts`, the page's part and the styles**

- [ ] **Step 4: Run the whole suite**

  Run: `npm run typecheck && npm test && npm run test:e2e`
  Expected: all pass.

- [ ] **Step 5: Commit**

  `git commit -m "Translate a saved line from a menu on its row"`

---

### Task 8: A row's states while and after translating

**Files:**
- Modify: `web/upload/line-translate.ts`, `web/upload/saved-page.ts`, `web/upload/saved.css`
- Test: `test/e2e/line-translate.spec.ts`

**Interfaces:**
- Consumes: Task 7's control; `toast` from `web/shared/toast.ts`.

**Row structure** (new parts marked `+`):

```
li.saved-line
+ div.saved-line-text                                        takes the link's place in the grid (grid-area: text)
    a.saved-line-link[data-line-link]                         now display: block
      span.saved-q …
      span.saved-tr[data-line-translation]                    not shown while the row is busy or has a note
+     span.saved-tr.is-busy[data-line-busy]                   "Traduzindo para português…" or "Traduzindo para inglês…"
+   p.saved-note[data-line-note]                              the note's text
+     button.saved-retry[data-retry] "Tentar de novo"          only for a failure
  …
```

and, once in the page, a live region out of sight: `div.sr-only[data-translate-status][role="status"][aria-live="polite"]`, put in the page empty when the page is built.

**The states** (decisions 10 to 17):

| What happened | What the row shows | Stored |
|---|---|---|
| A language was chosen | "Traduzindo para português…" or "Traduzindo para inglês…", for at least 300 ms; the button has `is-on` | nothing yet |
| An answer with text | the translation | `tr`, and `lang` when the answer names it |
| `sameLanguage: true` | "Esta linha já está em português." or "Esta linha já está em inglês." (by the language asked) | `lang` (the answer's `sourceLang`, else the code asked) |
| 404 `line_changed` | "Esta linha mudou na música e não pode ser traduzida." | nothing |
| Any other failure (network, 429, 503, 404 `not_found`, 404 `translation_off`) | "Não foi possível traduzir agora." and "Tentar de novo" | nothing |
| The store refused the write | the row as it was; the toast "Não foi possível salvar neste navegador." | nothing |

- The 300 ms count from the choice; a slower answer shows as soon as it arrives. A failure waits the same.
- A note or the busy text takes the translation's place and is kept in memory by song and position: the row shows it again when the page is drawn again, and a reload forgets it.
- Choosing a language again, "Tentar de novo" and "Ocultar tradução" clear the row's note. "Tentar de novo" asks again for the same language and moves focus to the row's translate button.
- Only the latest choice of a row counts: an older answer is dropped when it arrives.
- An answer for a row that was removed meanwhile is dropped: nothing is written and nothing is announced.
- The live region gets the translation's text on success (with `lang` set to the code) and the note's text for the three notes. It is emptied before each new text.
- A row with no note and no busy text has the same height as before this task, at both widths.

**Styles:**

```css
.saved-line-text { grid-area: text; min-width: 0; }
.saved-line-link { display: block; }
.saved-tr.is-busy { color: rgb(175 175 182 / .7); }
.saved-note { display: flex; flex-wrap: wrap; align-items: center; gap: 0 12px; margin: 2px 0 0; color: var(--text-2); font-size: 15px; line-height: 20px; font-weight: 500; }
.saved-retry {
  position: relative; z-index: 1; /* above the row's link */
  min-height: 44px; padding: 0 4px; border: 0; border-radius: var(--radius-input); background: none; color: var(--text-1);
  font: inherit; font-weight: 600; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px;
}
```

`grid-area: text` moves from `.saved-line-link` to `.saved-line-text`. Under 640 px the translation and the note are 14 px (`.saved-tr, .saved-note { font-size: 14px; }` in the existing phone block): it is the mockup's value, and stage 2 left it out.

- [ ] **Step 1: Record the row's height today**

  With the first fixture line saved, read the first row's height at 1440×900 and at 390×844 (a scratch script or a temporary test) and write both numbers into test 1 below.

- [ ] **Step 2: Write the failing tests** (`test/e2e/line-translate.spec.ts`; "held" means a `page.route` on the line route that waits for the test to release it)

  1. `a row with nothing to say keeps its height`: the first row, with no translation, is as tall as Step 1 measured, at 1440×900 and at 390×844.
  2. `while the request runs the row says it is translating`: with the route held, after choosing "Português" the row shows `[data-line-busy]` with "Traduzindo para português…", the stored translation (if any) is not shown, and the button has `is-on`.
  3. `the translating text stays at least 300 ms`: with `page.clock` installed and the route answering at once (the test waits for the response first), the busy text is still there after 299 ms and the translation has taken its place after 300 ms.
  4. `a failure shows the text and Tentar de novo, and trying again translates`: the route answers 503 once. The row shows `[data-line-note]` with "Não foi possível traduzir agora." and a button "Tentar de novo" at least 44 px high; nothing is stored. A click on it sends the request again with the same language; the translation shows; focus is on the translate button.
  5. `a dropped connection and too many requests read the same`: an aborted route and a 429 both give the failure text with "Tentar de novo".
  6. `Inglês on lyrics in English says so and corrects the record`: with a record whose `lang` is `null`, choosing "Inglês" shows "Esta linha já está em inglês." with no retry button; the stored record's `lang` is `en` and its `tr` is unchanged; opening the menu again, "Inglês" is disabled with "Idioma da letra".
  7. `a line that changed in the song says so`: after `setLyrics(request, track, "Outra letra")`, choosing "Português" shows "Esta linha mudou na música e não pode ser traduzida." with no retry button.
  8. `a note does not touch a stored translation`: with a stored Portuguese translation and the route answering 503, a new choice shows the failure text in the translation's place; after a reload the stored translation shows again.
  9. `a note and the translating text survive the page being drawn again`: with a failure note showing, the `storage` event leaves it there. With the route held and the busy text showing, the `storage` event leaves the busy text there, and releasing the route puts the translation in the row drawn last.
  10. `a newer choice wins`: hold the first request ("Português"); choose "Inglês", which answers at once; release the first. The row shows the same-language note, and the stored record has no `tr`.
  11. `a line removed while it translates leaves nothing behind`: hold the route, remove the row, release. The store has no record, no row comes back, the live region is empty and the page logged no error.
  12. `the result is announced`: `[data-translate-status]` is in the page and empty at load; it holds the translation's text after a success (with `lang="pt-BR"`), the failure text after a failure and the same-language text after that answer.
  13. `a translation the browser can not keep shows the toast`: after the page loads, make `Storage.prototype.setItem` throw; choose "Português". The toast reads "Não foi possível salvar neste navegador." and the row shows no translation and no note.
  14. `Ocultar tradução clears a note too`: with a stored translation and a failure note showing, "Ocultar tradução" leaves the row with neither.
  15. `the whole path from the keyboard`: Tab to the translate button, Enter, Enter on "Português"; focus is on the button, the translation shows and was announced.
  16. `on a phone the translation and the note are 14 px`: at 390×844, a stored translation and a failure note both compute to `font-size: 14px`.

- [ ] **Step 3: Run them and see them fail**

  Run: `npm run test:e2e -- line-translate`

- [ ] **Step 4: Write the states and the styles**

- [ ] **Step 5: Run the whole suite**

  Run: `npm run typecheck && npm test && npm run test:e2e`
  Expected: all pass.

- [ ] **Step 6: Commit**

  `git commit -m "Show a saved line's translating, failed, same-language and changed states"`

---

### Task 9: The `hymt` profile, the docs and the stage's checks

**Files:**
- Modify: `docker-compose.yml`, `.env.example`, `README.md`, `test/unit/deploy.test.ts`

**The compose profile** (the start command was run in the planning probe, with the model file already in the volume):

```yaml
  hymt:
    image: ghcr.io/ggml-org/llama.cpp:server-b12242
    profiles: ["hymt"]
    entrypoint: ["/bin/sh", "-c"]
    command:
      - |
        set -e
        model=/models/Hy-MT2-1.8B-Q4_K_M.gguf
        if [ ! -s "$$model" ]; then
          echo "Downloading the translation model (1.1 GB), once..."
          curl -fL --retry 3 -o "$$model.part" "https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF/resolve/main/Hy-MT2-1.8B-Q4_K_M.gguf"
          mv "$$model.part" "$$model"
        fi
        exec /app/llama-server --model "$$model" --ctx-size 4096 --parallel 1
    volumes:
      - hymt-models:/models
    restart: unless-stopped
```

- `hymt-models` joins the `volumes:` list. The image listens on port 8080 and has its own health check.
- The `app` service's pass-through list gains `TRANSLATE_API_URL`, `TRANSLATE_API_KEY`, `TRANSLATE_MODEL` and `TRANSLATE_DETECT_LANGUAGE`.

**`.env.example`:** the mode comment becomes `# auto | claude | chat | libretranslate | fake | off`, and after the Claude block:

```text
# Chat engine: any endpoint that speaks OpenAI's chat completions. Enabled when the URL and the model are set.
# Hugging Face: TRANSLATE_API_URL=https://router.huggingface.co/v1, a token with the
# "Inference Providers" permission as the key, and the model id as the router names it.
# With the hymt compose profile: TRANSLATE_API_URL=http://hymt:8080/v1, TRANSLATE_MODEL=Hy-MT2-1.8B,
# no key, and TRANSLATE_DETECT_LANGUAGE=false (the small model can not name languages).
TRANSLATE_API_URL=
TRANSLATE_API_KEY=
TRANSLATE_MODEL=
TRANSLATE_DETECT_LANGUAGE=true
```

**`README.md`:**

- "Translation": `auto` tries Claude, then the chat engine, then LibreTranslate. A new "Chat engine" part between Claude and LibreTranslate, with two setups:
  - **Hugging Face:** the three variables; where the token comes from and the permission it needs; that the lines, the song title and the artist go to Hugging Face and to the provider it routes to; that a PRO account's monthly credits cover thousands of songs at the router's listed prices, as an estimate.
  - **In Docker:** `docker compose --profile hymt up -d` and the four `.env` lines; the first start downloads 1.1 GB into the `hymt-models` volume; give the container 2 CPUs and 2 GB; measured there, a line takes 1 to 3 s and 24 lines about 35 s; the model is `tencent/Hy-MT2-1.8B` (Apache-2.0); with the language question off, the app does not know the lyrics' language, so it never says a line is already in the chosen language.
  - What `TRANSLATE_DETECT_LANGUAGE` does and when to turn it off.
- "Saved lines": a paragraph on translating a line: the button and its menu on `/salvas`, the two languages, that the translation is kept with the saved line in the browser, "Ocultar tradução", and that the server only translates a line the song still has.
- "Deploy on Railway", step 4: the three `TRANSLATE_*` variables as the other way to turn translation on.

- [ ] **Step 1: Write the failing tests** (`test/unit/deploy.test.ts`, reading the files as text)

  1. `the hymt profile runs the pinned server with the model in a named volume`: `docker-compose.yml` has a `hymt` service with `profiles: ["hymt"]`, the image `ghcr.io/ggml-org/llama.cpp:server-b12242`, the model's URL, and `hymt-models` both as its volume and in the volume list.
  2. `the app service passes the chat engine's variables through`: the four names are in its `environment` list.
  3. `.env.example names every translation variable`: the four `TRANSLATE_*` names and the mode comment with `chat`.

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run test/unit/deploy.test.ts`

- [ ] **Step 3: Change the three files**

- [ ] **Step 4: Check the compose file**

  Run: `docker compose --profile hymt config --quiet` (where Docker is available; else say so in the report)
  Expected: no output, exit 0.

- [ ] **Step 5: Run the stage's checks**

  Run, from `app/`: `npm run typecheck && npm test && npm run test:e2e`
  Run: `npx playwright test line-translate --trace off --repeat-each 5 --workers 2` (after `npx vite build`)
  Run, from the repository root: `python3 validate_collection.py --root .`
  Expected: all pass; the validator exits 0.

- [ ] **Step 6: Commit**

  `git commit -m "Add the hymt compose profile and document the chat engine and line translation"`

---

## Stage verification (the controller, after the last task)

- The full suite, the repeated run and the Docker smoke test, on the branch head.
- **The Docker option for real:** the `hymt` profile with the app container beside it (`TRANSLATOR=chat`, the model file put in the volume beforehand, since a container here can not reach the download), one whole song and three saved lines translated through the app, with the times.
- **Choosing the production model:** the three router models (`google/gemma-4-31B-it`, `Qwen/Qwen3.8-27B`, `openai/gpt-oss-120b`) on the 15 sample lines and on the language question, side by side, through the engine's own messages. This needs the owner's Hugging Face token, asked for through the secure form, never in chat. The owner picks.
- **Production:** `TRANSLATE_API_URL` and `TRANSLATE_MODEL` set on Railway by the controller once the model is picked; `TRANSLATE_API_KEY` entered by the owner in Railway. Then, on the live site in a real browser, one saved line translated and the player's whole-lyrics translation, which these variables turn on too.
- Captures for the owner at device scale factor 2: `/salvas` with the menu open, a translated line, the translating text, the failure with "Tentar de novo" and the same-language note, at 1440×900 and 390×844, next to the approved mockups; frozen frames of the menu opening.
- The pull request says what was not checked: Safari and Firefox, VoiceOver on an iPhone, the model's own download inside a container, the cost on Hugging Face beyond the price table.

## Left as it is

From stage 2's review, not taken into this stage. The owner can ask for any of them.

- For the owner to decide: cards of saved lines on the owner's view (today a link); the hairline between `/salvas` rows following the row's rounded corners (it is the approved mockup's look); a link to a moment animating the lyrics as the page loads.
- The first-save toast can cover the focused save button in the player.
- Which verse the keyboard acts on in two narrow paths (after "Voltar ao verso atual"; after a mouse click on the icon of a verse focused from the keyboard), and `S` on unsynced lyrics with no verse picked.
- Two quick removals on `/salvas`: the second row's fade is cut short.
- Tidying with no visible effect: the two near-equal arrow-key handlers in `lyrics-view.ts`, the two `cover()` helpers, `readSaved`'s quadratic de-duplication and its missing cap for hand-edited storage, and the test gaps the reviews listed.

## Amendments after the final review

- **Decision 4 is reversed.** A line call no longer stores the language it learned on the song; only a whole-lyrics call does. The review showed one request for an English chorus line setting a Portuguese song to English for everyone. While a song's language is unknown, each new line costs two requests with the chat engine.
- **Decision 16 is softened.** When no answer has come one second after a choice, the "Traduzindo…" text is announced.
- **Two grays differ from the approved mockup.** The "Traduzindo…" text and the "Idioma da letra" note are lighter than the mockup's, to reach 4.5 : 1.
- **The chat engine's variables are checked at startup**, and its error messages no longer carry text from the request or the response.
- **The chat engine does not translate lyrics that are already in the asked language.**
- **On `/salvas`, the click that dismisses a menu does not follow a link.**
