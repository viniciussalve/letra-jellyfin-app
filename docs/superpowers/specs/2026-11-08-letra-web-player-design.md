# letra web player: design

- **Date:** 2026-11-08
- **Status:** approved in conversation, pending written-spec review
- **Branch:** `claude/charming-turing-luvuck`
- **Inspiration:** [BetterLyrics](https://github.com/jayfunc/BetterLyrics) (desktop lyrics visualizer) brought to the web; visual language measured from Apple Music's lyrics view (owner's iPad screenshot)

## 1. Goal

Upload a song, get a link, send it to a friend. The link opens a full-screen
player that shows the song's lyrics in sync with the music, with an optional
translation into the friend's language.

### What the owner asked for

- A web app based on BetterLyrics.
- Upload a song; the app generates a link with the song, its lyrics, a
  translation (toggle, then a language selector), a player and controls.
- Built and tested with Docker.

### Decisions made in the brainstorm

| Question | Decision |
|---|---|
| Purpose | Share songs (any artist) with friends so they understand the words |
| Hosting | Docker image + `docker-compose.yml` on the owner's own server (VPS or home server behind a tunnel) |
| Translation engine | Claude first, LibreTranslate (self-hosted, optional compose service) as fallback |
| v1 extras | Background colored from the album cover; nothing else |
| Stack | Node in one container: Fastify + TypeScript, SQLite, Vite front end without a framework |
| Visual direction | The whole app follows Apple Music's lyrics view, from the owner's iPad screenshot (replaced an earlier TIDAL direction) |
| Active verse | Sharp, and fills left to right from 40% to 100% white as it is sung (karaoke wipe); other verses blurred and faint |

### Assumptions (stated, not asked)

- One owner uploads; friends only listen. No accounts.
- Links do not expire and are not listed or indexed.
- UI copy is Brazilian Portuguese. Code, comments and repo docs are English.
- Audio is served as uploaded; no transcoding.

### Success criteria

1. The owner drops an MP3 on the upload page and has a copyable link in under
   10 seconds for a song LRCLIB knows.
2. A friend opening the link on a phone sees cover, title and lyrics at once,
   taps play, and the active verse follows the music within 150 ms.
3. Turning translation on shows a translated line under every verse; the
   second friend asking for the same language gets the cached result.
4. Pasting the link in WhatsApp shows the cover and the song title.
5. `docker compose up` on a clean machine serves the app with only
   `UPLOAD_PASSWORD` and `PUBLIC_URL` set.

## 2. Scope

**In v1**

- Password-protected upload page with an "Enviadas" (uploaded) list: copy
  link, open, edit lyrics, delete.
- Tag reading (title, artist, album, duration, embedded cover, embedded lyrics).
- Lyrics lookup: embedded, then LRCLIB, then manual paste or `.lrc` upload.
- Share page `/t/:id`: full-screen player, synced lyrics with the karaoke
  wipe and blurred inactive verses, tap a verse to seek, translation button
  and language menu, lyrics on/off, share, browser full screen, Media
  Session.
- Background gradient taken from the cover's colors.
- Open Graph preview image per track.
- Docker image, compose file with an optional LibreTranslate profile.

**Not in v1**

Romanization (Romaji, Pinyin, Romaja), tap-to-sync editor, shareable lyric
cards, word-level karaoke from enhanced LRC, multiple users, playlists, link
expiry, transcoding, listening stats.

## 3. Architecture

One Node 22 process serves the API, the media files and both pages.

```
app/
  package.json            one package; scripts: dev, build, start, test, test:e2e, typecheck
  server/
    index.ts              boot: config, db, routes, static assets
    config.ts             env parsing and validation
    db.ts                 better-sqlite3, migrations
    auth.ts               password login, signed session cookie, rate limit
    routes/
      session.ts          POST/DELETE /api/session
      tracks.ts           upload, list, patch, delete, lyrics search/put
      translation.ts      GET /api/tracks/:id/translation
      media.ts            audio (Range), cover, og image
      pages.ts            GET / (upload app), GET /t/:id (share page), 404
      health.ts           GET /healthz
    lib/
      ids.ts              10-char base62 ids from crypto.randomBytes
      metadata.ts         music-metadata wrapper -> TrackMeta
      lyrics/
        model.ts          Line, Lyrics types
        lrc.ts            LRC parser and serializer
        plain.ts          plain text -> unsynced Lyrics
        lrclib.ts         LRCLIB client (get, search, best match)
        resolve.ts        resolution order (section 5)
      translate/
        types.ts          Translator interface
        claude.ts         Claude translator
        libretranslate.ts LibreTranslate translator
        fake.ts           deterministic translator for tests
        service.ts        engine chain, cache, in-flight dedupe
        languages.ts      supported target languages
      palette.ts          cover -> background colors with contrast guarantees
      og.ts               1200x630 preview image
  web/
    upload/               upload page (index.html, main.ts, styles)
    player/               share page script and styles
    shared/               tokens.css, fonts, icons, formatting helpers
  test/
    unit/                 vitest
    api/                  vitest + fastify.inject
    e2e/                  Playwright
    fixtures/             2-second tagged MP3, sample .lrc files, cover image
  Dockerfile
  docker-compose.yml
  .env.example
  README.md
```

### Libraries

| Need | Library | Why |
|---|---|---|
| HTTP | `fastify`, `@fastify/multipart`, `@fastify/static`, `@fastify/cookie`, `@fastify/rate-limit` | small, fast, `inject` for tests |
| Tags | `music-metadata` | reads ID3, MP4, Vorbis, FLAC tags, cover and lyrics |
| DB | `better-sqlite3` | synchronous, one file in the volume |
| Images | `sharp` | cover resize, palette sampling, OG image |
| Claude | `@anthropic-ai/sdk` | official SDK |
| Front end | `vite`, TypeScript, no UI framework | two screens; keeps the bundle small |
| Font | `@fontsource-variable/inter` | open licence, self-hosted; Apple devices use their system font |
| Icons | `@phosphor-icons/core` (fill weight, inlined SVG) | MIT licence |
| Tests | `vitest`, `@playwright/test` | unit/API and end to end |

### Data model

```sql
CREATE TABLE tracks (
  id             TEXT PRIMARY KEY,          -- 10-char base62
  title          TEXT NOT NULL,
  artist         TEXT NOT NULL,
  album          TEXT,
  duration_ms    INTEGER NOT NULL,
  mime           TEXT NOT NULL,
  ext            TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL,
  has_cover      INTEGER NOT NULL DEFAULT 0,
  palette_json   TEXT,                      -- {"mesh":["#..","#..","#..","#.."],"scrim":0.25}
  lyrics_json    TEXT,                      -- Lyrics, see section 5
  lyrics_source  TEXT NOT NULL,             -- embedded | lrclib | manual | none
  lyrics_lang    TEXT,                      -- detected source language, set by the first translation
  created_at     TEXT NOT NULL
);

CREATE TABLE translations (
  track_id     TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  lang         TEXT NOT NULL,               -- target language code
  engine       TEXT NOT NULL,               -- claude | libretranslate | fake
  source_lang  TEXT,
  lines_json   TEXT NOT NULL,               -- string[] aligned with lyrics lines
  created_at   TEXT NOT NULL,
  PRIMARY KEY (track_id, lang)
);
```

Files live under `DATA_DIR` (default `/data`):
`audio/<id>.<ext>`, `covers/<id>.jpg` (max 1200 px), `og/<id>.jpg`,
`letra.db`, `session-secret`.

### Routes

| Method and path | Auth | Purpose |
|---|---|---|
| `POST /api/session` | no (rate limited, 5/min/IP) | `{password}` sets the session cookie |
| `DELETE /api/session` | yes | log out |
| `GET /api/tracks` | yes | uploaded list, newest first |
| `POST /api/tracks` | yes | multipart upload; returns the track and `shareUrl` |
| `PATCH /api/tracks/:id` | yes | edit `title`, `artist` |
| `POST /api/tracks/:id/lyrics/search` | yes | run LRCLIB lookup again with current title and artist |
| `PUT /api/tracks/:id/lyrics` | yes | `{text}` (LRC or plain) or multipart `.lrc`; clears cached translations |
| `DELETE /api/tracks/:id` | yes | delete row, translations and files |
| `GET /api/tracks/:id/translation?lang=xx` | no | translated lines, from cache or engine |
| `GET /media/:id/audio` | no | audio with HTTP Range support |
| `GET /media/:id/cover.jpg`, `GET /media/:id/og.jpg` | no | images, long cache headers |
| `GET /` | page | upload app (login form when signed out) |
| `GET /t/:id` | page | share page, server-rendered head and embedded track JSON |
| `GET /healthz` | no | `200 ok` when the DB answers |

The session cookie is `HttpOnly`, `SameSite=Lax`, `Secure` when `PUBLIC_URL`
is https, signed with `SESSION_SECRET` (generated and saved to
`DATA_DIR/session-secret` when not set).

## 4. Flows

### Upload

1. The owner drops a file anywhere on the upload page (or picks one).
2. The browser checks size and extension, then uploads with progress.
3. The server streams to `audio/<id>.<ext>`, rejects above `MAX_UPLOAD_MB`,
   and parses with `music-metadata`. A file it cannot parse as audio is
   deleted and rejected.
4. Title and artist fall back to the file name (`Artist - Title.mp3` is split
   on the first ` - `).
5. The embedded cover is resized, sampled for the palette and composed into
   the OG image.
6. Lyrics are resolved (section 5).
7. The response carries the track, the lyrics status and
   `shareUrl = PUBLIC_URL + /t/<id>`.

### A friend opens the link

1. `GET /t/:id` returns HTML with Open Graph tags, `noindex`, the palette as
   CSS variables, and the track plus lyrics as embedded JSON. No second
   request is needed to draw the page.
2. The page shows the full-screen player and a centered "Tocar" pill,
   because browsers block sound until the visitor acts.
3. Audio streams from `/media/:id/audio`; seeking uses Range requests.
4. Translation is fetched only when the toggle is turned on.

## 5. Lyrics

### Model

```ts
type Line = { t: number | null; text: string }   // t in ms
type Lyrics = { synced: boolean; lines: Line[]; instrumental: boolean }
```

### Parsing

- LRC: `[mm:ss]`, `[mm:ss.xx]`, `[mm:ss.xxx]`; several time tags on one line
  produce one entry per tag; `[offset:+/-ms]` is applied; ID tags (`[ar:]`,
  `[ti:]`, `[al:]`, `[by:]`, `[length:]`) are ignored; enhanced word tags
  (`<mm:ss.xx>`) are stripped. Lines are sorted by time. Empty timed lines are
  kept as breaks.
- Plain text: one `Line` per text line, `t: null`, blank lines kept as breaks.
- A text is LRC when at least 3 lines start with a time tag; otherwise plain.

### Resolution order

1. Embedded synced lyrics (ID3 `SYLT`, or LRC text found in `USLT`/lyrics tags).
2. LRCLIB `GET /api/get?artist_name&track_name&album_name&duration`.
3. LRCLIB `GET /api/search?track_name&artist_name`: keep results within ±3 s of
   the file's duration, prefer `syncedLyrics`, then the closest duration.
4. Embedded unsynced lyrics.
5. LRCLIB plain lyrics from steps 2 and 3.
6. None: `lyrics_source = none`.

LRCLIB returning `instrumental: true` sets `instrumental` and shows
"Instrumental" in place of lyrics. Requests send
`User-Agent: letra (https://github.com/viniciussalve/letra)` and time out
after 5 s; a timeout or error counts as "not found" and the owner sees
"Buscar letra de novo".

## 6. Translation

### Languages

Português (`pt-BR`), English (`en`), Español (`es`), Français (`fr`),
Deutsch (`de`), Italiano (`it`), 日本語 (`ja`), 한국어 (`ko`), 中文 (`zh`),
Русский (`ru`), Türkçe (`tr`), Polski (`pl`), Nederlands (`nl`),
हिन्दी (`hi`). The list is fixed, which also caps how many translations one
track can trigger (14).

The friend's default target is the first of `navigator.languages` that is in
the list, else `pt-BR`. Toggle state and language are stored in the friend's
`localStorage` (wrapped in try/catch; the page works without it).

### Engines

`TRANSLATOR=auto` (default) builds the chain from what is configured:
Claude when `ANTHROPIC_API_KEY` is set, LibreTranslate when
`LIBRETRANSLATE_URL` is set. `claude`, `libretranslate`, `fake` and `off`
force one choice. With no engine the toggle is not rendered.

- **Claude:** one request per track and language. Input: the full lyrics as
  a numbered list of non-empty lines, title and artist for context, the
  target language. Instructions: translate each line naturally for a reader
  of the target language, keep meaning and tone over word-for-word accuracy,
  one output line per input line, keep bracketed cues such as
  `(instrumental)` untranslated. Output is structured JSON:
  `{source_lang, lines: string[]}` via `output_config.format` (JSON schema).
  The model comes from `ANTHROPIC_MODEL` (default `claude-opus-5-5`, effort
  `medium`), with server-side refusal fallback on (`fallbacks: "default"`,
  beta `server-side-fallback-2026-07-01`). A `refusal` stop reason, or a line
  count that still does not match after one retry, falls through to the next
  engine.
- **LibreTranslate:** `POST /translate` with `q: string[]`, `source: auto`,
  `target`. Language codes are mapped (`pt-BR` to `pt`, `zh` to `zh-Hans`
  when the server reports it).
- **Fake (tests):** returns `"[<lang>] <line>"`.

### Cache and dedupe

Results are stored in `translations`. Concurrent requests for the same
`(track, lang)` await one in-flight promise. A global limit of 2 concurrent
engine calls protects the API key. When the detected source language matches
the target (primary subtag), the endpoint returns `{sameLanguage: true}` and
the page shows "A música já está em Português" (with the language name)
instead of duplicate lines.

### Failure

When every engine fails, the endpoint returns `503` with a reason. The
lyrics keep playing; in place of the translations the page shows
"Tradução indisponível agora." with a "Tentar de novo" button.

## 7. Visual design

### Reference

The owner chose Apple Music's lyrics view as the look for the whole app (an
earlier draft followed TIDAL; the owner replaced it). Source: the owner's
screenshot of Apple Music on an iPad in landscape, 2360×1640 px
(1180×820 pt), playing "Cool Relax" by Jon B., taken 2026-11-08. Values below
were sampled from that image; motion was not observable in a still.

Measured:

- **Layout.** Two columns. Left: cover 452 pt square (38% of the width) at
  54 pt from the left edge and 64 pt from the top, corner radius about 8 pt,
  soft shadow; under it title and artist, a progress bar, transport and a
  volume slider. Right: lyrics column starting at 47% of the width.
- **Lyrics.** Active verse white, bold, line pitch 58.5 pt with a 44 pt glyph
  band (about 46/58 pt), its first line 30% down the screen. Inactive verses
  in faint white (about 35%) with a gaussian blur; verses near the bottom
  edge fade out. The gap between verses is about one line.
- **Background.** A blurred blend of the cover's colors: navy on the left
  (`#2F3E57`, darkening to `#0F1014` at the bottom), grey-teal on the right
  (`#738488`, `#667B82` at the top), `#424B51` between the columns.
- **Text beside the cover.** Title white semibold, artist the same size in
  white about 60%; times small, dim, elapsed on the left and remaining
  (`−2:17`) on the right, under a thick rounded bar (about 5 pt).
- **Buttons.** Translucent circular buttons (white about 18% fill) in the
  corners of the lyrics column; a button that is on turns solid white with a
  dark glyph (the lyrics button, bottom right).

Not used: Apple's name or logo, the SF Pro font files and SF Symbols (both
licensed for Apple platforms only). The app is branded "letra".

### Tokens

```css
:root {
  /* text on the gradient */
  --text-1:  #FFFFFF;
  --text-2:  rgb(255 255 255 / .60);   /* artist, times, secondary */
  --text-verse-dim: rgb(255 255 255 / .35);
  --text-translation: rgb(255 255 255 / .75);

  /* glass */
  --glass-fill:    rgb(255 255 255 / .18);  /* circular buttons */
  --glass-panel:   rgb(255 255 255 / .10);  /* panels, menus, inputs */
  --glass-border:  rgb(255 255 255 / .12);
  --glass-blur:    blur(40px) saturate(1.4);
  --row-hover:     rgb(255 255 255 / .08);
  --hairline:      rgb(255 255 255 / .12);

  /* controls */
  --bar-track:     rgb(255 255 255 / .25);
  --bar-fill:      rgb(255 255 255 / .75);
  --danger:        #FF453A;

  /* default gradient (no cover, upload page), from the reference */
  --mesh-1: #2F3E57;  --mesh-2: #738488;  --mesh-3: #0F1014;  --mesh-4: #424B51;

  --radius-cover: 8px;  --radius-row: 10px;  --radius-input: 12px;
  --radius-menu: 14px;  --radius-panel: 20px; --radius-pill: 999px;

  --font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter Variable",
          "Inter", system-ui, "Hiragino Sans", "Noto Sans CJK JP",
          "Apple SD Gothic Neo", "Noto Sans KR", "PingFang SC", sans-serif;
}
```

Apple devices render the system font (SF Pro); everyone else gets Inter,
self-hosted from `@fontsource-variable/inter`. Icons come from Phosphor
(MIT), fill weight, which matches the solid transport glyphs.

### Gradient from the cover

1. Resize the cover to 64×64 with `sharp` and run k-means (k = 4) on its
   pixels; order the four colors by population.
2. Build the background from four soft radial gradients (top-left,
   top-right, bottom-left, bottom-right) over the darkest color, on a layer
   blurred and scaled up so no edge shows. It drifts slowly (60 s loop).
3. Lower each color's OKLCH lightness, keeping its hue, until white reaches
   4.5:1 and white at 75% reaches 3:1 on it (verses and translations are
   large bold text). The reference's grey-teal `#738488` gives white only
   3.9:1, so it becomes about `#5C6A6D`; its navy side already passes.
4. The controls area (left column on wide screens, bottom block on phones)
   sits on a black scrim, 25% by default and up to 45%, chosen so white at
   60% (artist, times) reaches 4.5:1.
5. No cover: the default gradient `--mesh-1` to `--mesh-4`.

`palette.ts` stores the four adjusted colors and the scrim strength in
`palette_json`; the share page sets them as CSS variables.

### Type

| Role | Wide (≥ 1024 px) | Phone (< 640 px) |
|---|---|---|
| Verse | `clamp(28px, 3.9vw, 48px)` / 1.25, weight 700, `-0.015em` | 28/35, weight 700 |
| Translation under a verse | 0.55em of the verse, weight 700 (at least 19 px), line-height 1.3 | 19/25, weight 700 |
| Title beside the cover | 19/24 weight 600 | 17/22 weight 600 |
| Artist | 19/24 weight 400, `--text-2` | 17/22, `--text-2` |
| Times | 12/16 weight 600, tabular, `--text-2` | same |
| Buttons | 17/22 weight 600 | same |
| List title / meta | 15/20 weight 600 / 13/18 `--text-2` | same |
| Badge | 11/13 weight 600, sentence case | same |

Translation lines are bold and at least 19 px so they count as large text.
Everything is left aligned except centered states (lyrics off, play pill,
sign-in).

### Share page

```
wide (≥ 1024 px), proportions from the reference
┌──────────────────────────────────────────────────────────────────────┐
│ cover-color gradient, drifting                    (文A) (Português ▾) │ glass buttons, lyrics column top-right
│   ┌────────────────┐      verso anterior            blur, 35%        │
│   │                │                                                 │
│   │      capa      │      VERSO ATUAL ███████▒▒▒   30% from top      │
│   │   38% width    │      tradução do verso atual   75%              │
│   │   radius 8     │                                                 │
│   └────────────────┘      próximo verso             blur, 35%        │
│   Cool Relax                         (⤴)                             │
│   Jon B.                                                             │
│   ━━━━━━━━━━━●────────────  6 px, rounded                            │
│   2:10                         −2:17                                 │
│        ⟲10        ❚❚        10⟳                                      │
│   🔈 ━━━━━━─────────── 🔊       (wide screens only)        (❝)  (⤢)   │
└──────────────────────────────────────────────────────────────────────┘

phone (< 640 px)
┌──────────────────────────┐
│ ▣ Cool Relax        (⤴)  │  48 px cover, radius 6
│   Jon B.                 │
│                          │
│ verso anterior     blur  │
│ VERSO ATUAL ████▒▒       │
│ tradução                 │
│ próximo verso      blur  │
│                          │
│ ━━━━━━━━●──────────────  │
│ 2:10              −2:17  │
│   ⟲10      ❚❚      10⟳   │
│ (❝)      (文A)       (⤢)  │
└──────────────────────────┘
```

Tablets in portrait (640 to 1023 px) use the phone arrangement with a 64 px
cover and larger verses.

- **Translation.** `(文A)` is a 44 px glass circle; on, it turns solid white
  with a dark glyph and a glass pill with the language name appears beside
  it. The pill opens a glass menu (radius 14, 44 px rows) listing the
  languages; a native `<select>` backs it for accessibility. Absent when no
  engine is configured.
- **Lyrics on/off.** `(❝)` toggles the lyrics column. Off, the cover and
  controls center on the screen at the reference's left-column size.
- **Share.** `(⤴)` opens the system share sheet (Web Share API) and falls
  back to copying the link, confirming "Link copiado" in a glass toast.
- **Full screen.** `(⤢)` uses the Fullscreen API; hidden where it is missing
  (iPhone Safari).
- **Play pill.** Before the first play, a white capsule "▶ Tocar" (black
  text, 50 px tall) sits centered over the lyrics; it disappears on first
  play.
- **Transport.** Back 10 s, play/pause (the largest glyph), forward 10 s.
  The progress bar is 6 px, rounded, `--bar-track` with `--bar-fill`, and
  grows to 10 px with a white fill while dragged. Elapsed time on the left,
  remaining time with a minus sign on the right. Volume shows only where the
  browser can set it (not iOS).
- **Keyboard.** Space play/pause, ← and → seek 5 s, `T` translation, `L`
  lyrics on/off, `F` full screen; ignored while a form control has focus.
- **Media Session.** Title, artist, album and cover on the lock screen;
  play, pause, seek backward/forward and seek-to.

### Lyrics behavior

- **Position.** The active verse's first line sits 30% down the lyrics
  column. Verses near the top and bottom edges fade through a mask.
- **Inactive verses.** `--text-verse-dim` with `filter: blur(2.5px)` on wide
  screens (1.5 px on phones). Hovering one with a mouse removes the blur and
  raises it to 60%, which signals it can be clicked.
- **Moving on.** Verses slide up with a 500 ms ease-out; each verse below
  the active one starts 30 ms after the one above it, a cascade. The cascade
  is a design choice; the still reference cannot show Apple's timing.
- **Wipe.** The active verse is sharp; its text is an inline span with
  `background: linear-gradient(90deg, #fff var(--p), rgb(255 255 255 / .4)
  var(--p))` clipped to text. Inline layout runs the gradient across wrapped
  fragments in reading order, so a two-line verse fills line one, then line
  two. `--p` is set every animation frame from
  `(now - start) / (nextStart - start)`, clamped to 0 to 100%; the last
  verse ends at `min(start + 6 s, duration)`. Breaks (empty lines) show a
  three-dot pause.
- **Seeking.** Clicking or tapping a verse (synced lyrics only) seeks to its
  time and plays. Verses are buttons, reachable with the keyboard.
- **Manual scroll.** Scrolling pauses following and shows a glass pill
  "Voltar ao verso atual"; following resumes on that pill or after 5 s.
- **Unsynced lyrics.** All verses sharp at 85% white, no wipe, no seeking, a
  badge "Letra sem sincronia" under the artist.
- **States.** No lyrics: "A letra desta música não foi encontrada."
  Instrumental: "Instrumental". The player keeps working in both.
- **Reduced motion.** No drift, no cascade, no smooth scroll, no wipe (the
  active verse turns white at once).
- **Reduced transparency or more contrast** (`prefers-reduced-transparency`,
  `prefers-contrast: more`): no blur on verses, inactive verses at 60%, glass
  panels become solid `#1C1C1E`.

### Upload page

The same gradient (default colors) with glass panels.

- **Signed out.** A centered glass panel (radius 20): wordmark "letra"
  (28/34 weight 700), a password field (glass, radius 12, 50 px), white
  capsule "Entrar". Wrong password: "Senha incorreta." in `--danger`.
- **Drop panel.** Glass, radius 20, min height 280 px: "Solte uma música
  aqui" (28/34 weight 700), "MP3, M4A, FLAC, OGG ou WAV, até 100 MB" (15/20
  `--text-2`), white capsule "Escolher arquivo". The whole window accepts
  drops; while dragging, the panel border turns solid white.
- **Progress.** File name, the 6 px rounded bar, "Enviando… 42%", then
  "Procurando a letra…".
- **Result.** Cover 120 px (radius 8, shadow), title and artist with
  "Editar"; lyrics status as a badge ("Letra sincronizada", "Letra sem
  sincronia") or "Não achamos a letra." with "Colar letra", "Enviar .lrc"
  and "Buscar de novo". The link in a read-only glass field, white capsule
  "Copiar link" ("Link copiado"), glass capsule "Abrir".
- **Enviadas.** Song-list rows, 56 px: 44 px cover (radius 6), title over
  artist, duration on the right, share and ⋯ glass buttons; hairline
  separators inset to the text; hover `--row-hover` with radius 10. The
  just-uploaded row keeps a `--row-hover` background until reload. The ⋯
  menu (glass, radius 14) has "Copiar link", "Abrir", "Editar letra",
  "Apagar" (in `--danger`). Delete asks, in a glass dialog, "Apagar “Cool
  Relax”? O link para de funcionar." with "Apagar" and "Cancelar", then
  shows "Música apagada".
- **Edit lyrics dialog.** A glass textarea that accepts LRC or plain text,
  or a `.lrc` file; "Salvar letra" then "Letra salva".

### Open Graph image

1200×630: the track's gradient with the cover centered at 470 px (radius 16,
shadow). No text, since WhatsApp prints the title under it.

### Quality floor

Focus ring 2 px white with a 2 px dark outer ring, visible on every control
over any gradient; hit targets at least 44 px; works from 360 px wide with
no horizontal scroll; `lang` on lyrics when the source language is known;
reduced motion and reduced transparency respected.

## 8. Errors

| Situation | What the person sees |
|---|---|
| Not audio | "Esse arquivo não é um áudio que dá para tocar. Envie MP3, M4A, FLAC, OGG ou WAV." |
| Too large | "O arquivo tem 142 MB. O limite é 100 MB." (actual size) |
| Missing tags | Title and artist from the file name, fields open for editing |
| LRCLIB down or slow | Treated as not found; "Buscar letra de novo" |
| Translation failed | "Tradução indisponível agora." with "Tentar de novo" |
| Unknown or deleted link | 404 page on the default gradient: "Esse link não existe ou a música foi apagada." |
| Wrong password | "Senha incorreta." |
| Too many logins | "Muitas tentativas. Espere um minuto e tente de novo." |
| Audio fails to load | "Não foi possível tocar este arquivo neste navegador." |

API errors return `{error: {code, message}}` with the message in Portuguese.

## 9. Configuration

| Variable | Default | Meaning |
|---|---|---|
| `UPLOAD_PASSWORD` | required | the app refuses to start without it |
| `PUBLIC_URL` | `https://$RAILWAY_PUBLIC_DOMAIN` on Railway, else `http://localhost:3000` | base for share links and OG URLs |
| `SESSION_SECRET` | generated into `DATA_DIR` | cookie signing |
| `DATA_DIR` | `/data` | volume root |
| `PORT` | `3000` | |
| `TRUST_PROXY` | unset (false) | `true`, a hop count, or a comma list of IPs/CIDRs; set behind a reverse proxy or tunnel so the login rate limit sees real client IPs |
| `CLIENT_IP_HEADER` | `x-real-ip` on Railway, else unset | header a proxy sets to the client IP (Railway sends `X-Real-IP`, no `X-Forwarded-For`); when set, rate limits key on it instead of the socket or `X-Forwarded-For` address |
| `MAX_UPLOAD_MB` | `100` | |
| `TRANSLATOR` | `auto` | `auto`, `claude`, `libretranslate`, `fake`, `off` |
| `ANTHROPIC_API_KEY` | unset | enables Claude |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | |
| `LIBRETRANSLATE_URL` | unset | e.g. `http://libretranslate:5000` |
| `LIBRETRANSLATE_API_KEY` | unset | for public LibreTranslate servers |

## 10. Docker

- **Dockerfile** (multi-stage): `node:22-alpine` build stage runs `npm ci`,
  typecheck and `vite build`; runtime stage installs production dependencies
  only, runs as the `node` user, `EXPOSE 3000`, `VOLUME /data`, and a
  `HEALTHCHECK` on `/healthz`.
- **docker-compose.yml**: service `app` (build `.`, `env_file: .env`, volume
  `letra-data:/data`, port `3000:3000`, `restart: unless-stopped`); service
  `libretranslate` under profile `libretranslate` (pinned image tag,
  `LT_LOAD_ONLY=en,pt,es,fr,de,it,ja,ko,zh,ru,tr,pl,nl,hi`, volume for models).
  `docker compose --profile libretranslate up -d` turns the fallback on.
- `.env.example` lists every variable from section 9.
- `app/README.md` covers: first run, setting the password, putting it behind
  HTTPS (reverse proxy or Cloudflare Tunnel), backups (`letra-data` volume),
  turning LibreTranslate on.

## 11. Testing

- **Unit (vitest):** LRC parser (multi-tag lines, offsets, enhanced tags,
  sorting), plain-text fallback, LRC detection, LRCLIB best match with a
  stubbed `fetch`, resolution order, translator chain (line-count mismatch,
  retry, fallback, `sameLanguage`), cache and in-flight dedupe, palette
  contrast guarantees, wipe progress math, id generation, config validation.
- **API (vitest + `fastify.inject`):** login and rate limit, upload of the
  tagged fixture MP3, rejection of a non-audio file and an oversized file,
  Range responses (`206`, `Content-Range`), share page head (OG tags,
  `noindex`, embedded JSON), translation endpoint with the fake engine,
  lyrics PUT clearing translations, delete removing files, 404 page.
- **End to end (Playwright, Chromium):** log in, upload the fixture, copy the
  link, open it, press "Tocar", check the active verse advances, tap a verse
  to seek, turn translation on and see `[pt-BR] …` lines, switch language,
  reload and find the preference kept, phone viewport pass. Runs with
  `TRANSLATOR=fake` and LRCLIB stubbed, so no network is used.
- **Docker smoke:** build the image, `docker compose up -d`, wait for
  `/healthz`, upload the fixture with `curl`, fetch `/t/:id` and the audio
  with a Range header, `docker compose down -v`.
- **CI:** new workflow `.github/workflows/app.yml`, triggered by changes under
  `app/` or the workflow itself: `npm ci`, typecheck, vitest, Playwright
  (Chromium), Docker build. The existing Python CI is unchanged.

## 12. Repo integration

- The app lives in `app/`; this spec in `docs/`. Both are excluded from the
  collection audit (`validate_collection.py` `IGNORED_DIR_NAMES`) and from the
  test helpers that treat top-level folders as card categories.
- `AGENTS.md` and `README.md` get a short "Web player (`app/`)" section with
  the commands.
- `.gitignore` adds `app/.data/` (local dev data) and Playwright reports.
- Nothing generated is committed (built assets, the SQLite file, uploads).

## 13. Risks

- **Look-alike.** The layout and feel follow Apple Music; Apple's name, logo,
  SF Pro font files and SF Symbols are not used, and the app is branded
  "letra".
- **Lyrics coverage.** LRCLIB misses some songs; manual paste and `.lrc`
  upload cover the gap.
- **Format support.** Files are served as uploaded. OGG may not play on older
  iPhones; the page shows the "Não foi possível tocar" message instead of
  failing silently.
- **Wipe on Safari.** Gradient text across wrapped inline fragments must be
  checked in WebKit; if it misbehaves, the fallback is per-fragment filling
  (split the verse into one span per rendered line).
- **Blur cost.** Blurring every inactive verse and a drifting background can
  drop frames on old phones. Only verses within the viewport are blurred,
  the background layer is promoted to its own compositor layer, and the
  drift stops while the tab is hidden.
- **Copyright.** Links are private, unlisted and `noindex`, and only the
  password holder uploads; what is shared is the server owner's
  responsibility.
