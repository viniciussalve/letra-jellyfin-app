# letra v3: saved lines, a simpler player, motion and line translation

Date: 2026-11-10. Status: approved in conversation, part by part; this
document awaits the owner's review.

This spec amends `2026-11-09-letra-player-v2-design.md` (the v2 spec) and,
through it, `2026-11-08-letra-web-player-design.md` (v1). Where they
disagree, this one wins; everything it does not mention stays as v2
describes it. Paths are relative to `app/`.

## 1. Goal

### What the owner asked for

After using the deployed v2 player, the owner asked for:

1. A slightly wider lyrics column.
2. A bookmark icon on a verse, shown on hover, and a distinct look for a
   bookmarked line.
3. The saved lines on the home, and "a page that organizes this
   information well". Later: show the date each line was saved.
4. Lyrics always visible; full screen is the view without lyrics; no
   "Tocar" button.
5. Better animations and micro-interactions, with choices backed by
   research (educational material and articles by design engineers).
6. A translate button on each saved line, opening a floating menu with
   Portuguese and English, using Hugging Face translation models or a more
   current suggestion.

### Decisions made in the brainstorm

- **Why people save a line:** to keep and reread favorite lines, and to go
  back to the song at that moment. Not for sharing.
- **Saving on phones:** the save icon shows at the end of the verse that
  is playing. To save another verse, tap it (the song goes there), then
  tap the icon.
- **Organization:** by song. Each song is a block; its lines are in lyric
  order; songs are ordered by the most recent save.
- **Storage:** in the browser, like "Ouvidas recentemente". There are no
  listener accounts, so saved lines stay on one device.
- **Motion direction:** sober and fast, with a spring in one place only:
  saving a line.
- **Feedback when saving:** the toast shows only on the first save, and
  teaches where saved lines live. After that the filled icon is the
  feedback.
- **Translation engine in production:** Hugging Face's hosted router,
  paid from the owner's PRO credits (option A). The same engine code also
  runs an open model inside Docker (option B) for people who run the app
  with no key.

### Assumptions (stated, not asked)

The owner approved the parts these belong to, but did not pick or confirm
each one by name. Each can be reversed in review.

- On iPhone, where Safari has no Fullscreen API for pages, the full-screen
  button stays and switches to the cover view inside the page.
- The saved-lines page uses variant A of the mockups: one reading column.
- The `S` key saves the focused verse, or the playing verse when none is
  focused.
- Buttons with a surface press to `scale(.97)`; bare-icon buttons (the
  transport) press to `scale(.94)`, because 3% of a 30 px glyph is under
  one pixel.
- The saved date sits under the line on the page and at the right of the
  song on home cards.
- The saved-line menu names the two languages in Portuguese: "Português"
  and "Inglês".
- Delivery is in three stages (section 2). The owner approved two; line
  translation was requested afterwards and becomes the third.

### Success criteria

- A listener can save a verse with one click or tap, sees at once that it
  is saved, and finds it later on the home and on `/salvas`.
- A saved line opens its song at that verse.
- The player has one alternative view (cover), reached by the full-screen
  button on every device.
- Every motion in the app uses the tokens in section 5, and "reduce
  motion" turns all of it into immediate changes.
- A saved line can be translated to Portuguese or English in a few
  seconds, and the translation is still there on the next visit.
- All of it works with keyboard and screen reader, with 44 px touch
  targets and no horizontal scroll at 360 px.

## 2. Scope

### In

- Player: wider column, lyrics always on, cover view tied to full screen,
  no "Tocar" pill, a skip link, the save control and the saved look, a
  link to a moment in the song (`?t=`).
- A motion system: tokens, press feedback, icon swaps, the save gesture,
  the cover-view transition, toasts, dialogs and menus, home tiles, the
  progress handle, and a page transition between home and player.
- Saved lines: a browser store, a home section and the `/salvas` page.
- Line translation: a button and menu on saved lines, a server route for
  one line, and a new translation engine that talks to any
  OpenAI-compatible chat endpoint.

### Out

- Syncing saved lines across devices (needs listener accounts).
- Sharing, exporting or searching saved lines.
- Hiding section marks such as "[Chorus:]" in lyrics.
- Starting playback on its own when a page opens.
- Changing the font (Inter) or the icon family (Phosphor).
- The browser's built-in Translator API: it works only in desktop Chrome.

### Delivery

Three stages, each its own pull request, so the owner can judge each on
the live site:

1. **Player and motion.** Section 3 without its "Save control" and "A
   link to a moment" parts, and section 5 without the save gesture.
2. **Saved lines.** The "Save control" and "A link to a moment" parts of
   section 3, sections 4, 6 and 7, and the save gesture from section 5.
3. **Line translation.** Section 8. This stage also turns on the player's
   existing whole-lyrics translation in production, which is off today
   because no engine is configured.

## 3. Player

### Lyrics always on; cover view

- The "Letra" pill and the `L` shortcut are removed. The normal view
  always shows the lyrics column. A song with no lyrics keeps showing the
  cover with its message, as today.
- The existing lyrics-off layout (`data-lyrics="off"` on the player root)
  stays as the **cover view**. It is now driven only by the full-screen
  control.
- **Where the Fullscreen API exists** (`document.fullscreenEnabled`): the
  button and the `F` key call `requestFullscreen()` or `exitFullscreen()`.
  The `fullscreenchange` event sets the view, so leaving with Esc also
  brings the lyrics back.
- **Where it does not** (iPhone Safari): the button stays visible and
  toggles the cover view inside the page. Its label is "Mostrar capa"
  instead of "Tela cheia". The icons are the same.
- The button is a toggle: its label is one per mode and never changes
  with the state ("Tela cheia" with the Fullscreen API, "Mostrar capa"
  without it); the state is exposed by `aria-pressed`.
- In the cover view:
  - the cover is larger on wide screens:
    `min(62vh, 640px, 100vw - 144px)`; phones and tablets keep the v2
    "big cover" rule;
  - the translation button, its language pill and the save control are
    hidden and inert; the `T` and `S` shortcuts do nothing;
  - the lyrics column is hidden and `inert`;
  - home, share, the full-screen button and the player bar stay.
- `layout-order.ts` drops `lyricsToggle` from its parts. On stacked
  layouts the bottom row holds the translation group and the full-screen
  button.

### No "Tocar" pill

- The pill, its styles and its tests are removed. The position change
  shipped in viniciussalve/letra#18 goes with it.
- Playback starts from the play button in the bar, a click or tap on a
  verse, or the space bar.
- The page never starts playback on its own. Browsers block sound before
  the first interaction with the page.

### Skip link

Without the pill, a screen-reader user who swipes through the page meets
every verse before the transport. To give a way past them:

- An `a.skip-lyrics` with the text "Pular a letra" sits just before the
  lyrics section in the DOM. Its target is the play button.
- It is visually hidden and has `tabindex="-1"`: screen readers reach it
  by swipe or virtual cursor, and Tab users do not get an extra stop
  (the verses are already one Tab stop).
- Activating it moves focus to the play button.
- It is hidden in the cover view.

### Wider column

On layouts of 1024 px and up:

- The column goes from `min(440px, 34vw)` to `min(520px, 38vw)`. The cover
  and the 72 px gap do not change, and the group stays centered with the
  v2 rule.
- A gutter of 40 px at the right of the column is reserved for the save
  icon, so the icon never covers text. At 1440 px the text width goes
  from 408 px to 448 px.

On phones and tablets the column already spans the screen. The gutter
there is 36 px.

### Save control

The save control has two parts. Both act on a verse that has text; break
rows and the intro dots have none.

**The icon inside each verse** (pointer and touch):

- A `span.verse-save` inside the verse button, `aria-hidden`, sitting in
  the gutter at the right of the verse's first line. Being inside the
  verse, it dims, blurs, scales and scrolls with it, and the follow
  animation needs no change.
- A click or tap on it toggles the save and does not seek. A click
  anywhere else on the verse seeks, as today. Its hit area is 44 by 44 px.
- It shows:
  - on a fine pointer, on the hovered verse;
  - on the verse with keyboard focus;
  - where hover does not exist (`hover: none`), on the playing verse;
  - always, filled, on a saved verse.
- Outline means not saved; filled means saved. The icons are Phosphor
  "bookmark-simple", regular and fill.

**One real button after the lyrics** (keyboard and screen reader):

- A `button[data-save-line]` after the scroller: the Tab stop right after
  the verses. It is visually hidden until it has keyboard focus, when it
  shows as a pill at the bottom of the column, like "Voltar ao verso
  atual".
- It acts on the verse that holds the roving tab stop (the last focused
  verse, else the playing verse, else the first).
- Its name carries the line: "Salvar linha: She's gone away" or "Remover
  linha salva: She's gone away". It has `aria-pressed`.
- The `S` key does the same from anywhere on the page, except while a
  dialog or menu is open or focus is in a text field.

**Saved look:**

- The filled icon, always visible.
- A soft rounded background behind the verse, `rgb(255 255 255 / .08)`,
  using the verse's existing 14 px radius.
- A saved verse still dims and blurs like the others when it is not the
  playing one.

**Other cases:**

- Unsynced lyrics can be saved; the record has no time.
- If the translation is on when a line is saved, the translated line is
  stored with it.
- A verse shows as saved when the store has a record with the same track,
  the same line index and the same text.

**Feedback:**

- The icon and the background are the feedback (motion in section 5).
- A polite live region announces "Linha salva" or "Linha removida" every
  time.
- A toast shows only on the first save on a device: "Linha salva. Elas
  ficam em Início › Linhas salvas." A flag in `localStorage`
  (`letra.saved.hint.v1`) records that it was shown.
- Errors always show a toast (section 10).

### A link to a moment

- `/t/<id>?t=83.5` opens the song at 83.5 seconds. `t` is seconds with at
  most one decimal.
- On load the player seeks there, shows that verse as the playing one and
  scrolls to it. The song stays paused; the play button starts from
  there.
- A `t` that is not a number, is negative, or is at or past the duration
  is ignored.
- The share dialog's link never carries `t`.
- The server ignores the parameter; the page and its Open Graph tags are
  the same.

## 4. Saved lines: the store

A new module, `web/shared/saved.ts`, shaped like `recents.ts`: pure
functions over a `KeyValueStore`, safe to import in node.

```ts
export type SavedLine = {
  trackId: string;
  title: string;
  artist: string;
  hasCover: boolean;
  index: number;            // position in track.lyrics.lines
  t: number | null;         // ms; null for unsynced lyrics
  text: string;             // a copy of the line as saved
  lang: string | null;      // track.lyricsLang at save time
  tr: { lang: string; text: string } | null;
  at: number;               // epoch ms
};
export const SAVED_KEY = "letra.saved.v1";
export const SAVED_MAX = 1000;
```

- One record per `(trackId, index)`. Saving the same position again
  replaces it.
- The record keeps **a copy of the text and time**. Editing the lyrics
  later does not change a saved line.
- Functions: `readSaved`, `isSaved(list, trackId, index, text)`,
  `saveLine` (returns `"saved" | "full" | "blocked"`), `removeLine`,
  `restoreLine` (undo: puts a record back with its original `at`),
  `setLineTranslation`, `mergeSummaries` (refreshes title, artist and
  cover, and returns the ids the server no longer has; that is worked out
  on each load and not stored), `groupBySong` (pure:
  songs by most recent save, lines by index), and `savedLabel(at, now,
  form)` for the date text.
- Anything unreadable or malformed reads as empty, record by record.
- At 1000 records `saveLine` returns `"full"` and nothing is removed.
- When storage is blocked or full, `saveLine` returns `"blocked"`.
- Pages listen to the `storage` event, so two open tabs stay in step.

## 5. Motion

### Principles

From the research in section 14:

- Fast, and decelerating: ease-out by default, with custom curves; nearly
  everything under 300 ms.
- Exits are one step shorter than entrances.
- Animate only when it explains cause and effect, or as a deliberate
  treat. Things seen all day get no flourish.
- Interruptible, with the motion starting where the thing comes from.
- Only `transform`, `opacity` and `filter` move; colors may fade. Never
  `transition: all`.
- With `prefers-reduced-motion: reduce` every change is immediate. The
  global rule in `base.css` already does this and stays.

### Tokens (`web/shared/tokens.css`)

```css
--dur-fast: 120ms;   /* press, hover */
--dur-exit: 150ms;   /* anything leaving; icon swaps */
--dur-base: 200ms;   /* icons, toasts, dialogs and menus entering */
--dur-move: 400ms;   /* the cover changing place; page transition */
--dur-spring: 350ms; /* the save pop */
--ease-out:    cubic-bezier(.22, 1, .36, 1);   /* entering, responding */
--ease-in-out: cubic-bezier(.65, 0, .35, 1);   /* moving across the screen */
--ease-spring: cubic-bezier(.34, 1.56, .64, 1); /* fallback */
```

- Inside `@supports (transition-timing-function: linear(0, 1))`,
  `--ease-spring` is replaced by a `linear()` spring with about 12%
  overshoot that settles within `--dur-spring`. The plan fixes its values.
- The lyrics keep `--lyrics-duration` (.46 s), `--lyrics-ease` and
  `--lyrics-dim-delay`. They are the deliberate, slower exception.
- The scattered durations in the stylesheets (.12, .15, .2, .25, .35 and
  .5 s with `ease`) are replaced by these tokens.

### Moment by moment

| Moment | Change |
|---|---|
| Pressing a button | Buttons with a surface scale to .97; bare-icon buttons to .94. `--dur-fast`, `--ease-out`. |
| Icons that swap (play and pause, save, volume, full screen) | The old icon leaves and the new one enters over `--dur-exit`: opacity, scale from .9, and 2 px of blur in passing. `setIcon` gains this; today the swap is a cut. |
| Save icon appearing on hover | Opacity only, `--dur-fast`. |
| Saving a line | The icon fills and pops with `--ease-spring` over `--dur-spring`. The verse background fades in over `--dur-base`. |
| Removing a save | No pop. The fill and the background fade over `--dur-exit`. |
| Entering the cover view | The lyrics fade out over `--dur-exit`. The cover moves and grows to the center over `--dur-move` with `--ease-in-out`. |
| Leaving the cover view | The cover returns over `--dur-move`. The lyrics fade in over `--dur-base` once the cover has passed them: after `--dur-move` minus `--dur-fast` side by side, after `--dur-move` when stacked. They are already at the playing verse. |
| Home to player | The tile's cover travels and grows into the player's cover over `--dur-move`; the rest cross-fades. Back to home reverses it. |
| Toasts | Enter over `--dur-base` (8 px up, fading in); leave over `--dur-exit`. |
| Dialogs (share, sign-in) | Enter as today (scale from .96, fade) over `--dur-base`. They gain an exit over `--dur-exit`; today they close with a cut. |
| Menus (languages) | Grow from the corner next to their button: scale from .96 and fade over `--dur-exit`; leave over `--dur-fast`. |
| Home tiles | The cover image scales to 1.02 under the pointer over `--dur-base`; the tile presses to .98. No staggered entrance. |
| Progress bar | A round 12 px handle appears over `--dur-fast` on hover, on keyboard focus and while dragging, on touch too. The bar still grows from 4 to 6 px. |

### How

- **Cover view.** The layout switches at once and the cover animates with
  a FLIP on `transform` (measure, switch, invert, play). Today the rule
  animates `left`, `width` and `height`; that goes away. Because the
  start is always the current on-screen box, pressing `F` mid-way
  reverses from where the cover is. With real full screen, the switch
  runs on `fullscreenchange`, after the viewport has its new size.
- **Dialog exits** use `@starting-style` and
  `transition-behavior: allow-discrete` (with `overlay` in the transition
  list). Browsers without them close with a cut, as today.
- **Page transition** uses cross-document view transitions:
  `@view-transition { navigation: auto; }` in both pages, inside
  `@media (prefers-reduced-motion: no-preference)`, with one
  `view-transition-name` shared by the clicked tile's cover and the
  player's cover. Chrome and Edge 126+ and Safari 18.2+ run it; other
  browsers navigate at once, as today. See the risk in section 13.
- **Springs** are CSS only. No animation library is added.

## 6. Home and the saved-lines page

### Home (listener view)

- A "Linhas salvas" section sits above "Ouvidas recentemente". It shows
  only when at least one line is saved.
- It holds the 3 most recently saved lines as cards. Each card has the
  line (up to 3 lines of text on wide screens, 2 on phones) and, below,
  a 32 px cover with the song title over the artist, and the short date
  at the right.
- Wide screens show the cards in a row of 3; phones stack them.
- A card is a link to the song at that verse (`?t=`), or to the song when
  the line has no time. A card for a song the server no longer has is not
  a link and shows "Música indisponível" in place of the artist.
- "Ver todas (N)" at the right of the heading goes to `/salvas`.
- "Limpar histórico" clears only the listening history.

### `/salvas`

One reading column, 680 px wide at most, centered. The same structure on
every screen size.

- **Top:** the round home button; the title "Linhas salvas"; under it the
  count, "10 linhas em 4 músicas" (singular forms when 1).
- **Song block:** a header with a 48 px cover, the title over the artist,
  and "N linhas" at the right. The header links to the song from the
  start. A song the server no longer has shows "Música indisponível" in
  place of the artist and has no link; its lines stay.
- **Line row:**
  - the line; under it the translation, when there is one; under that
    the saved date;
  - at the right: the time in the song, the translate button (section
    8), and the filled bookmark, which removes the line;
  - the line is a link to the song at that verse; under the pointer the
    row gets a background and a play glyph next to the time;
  - on phones the line takes the full width, and the date, the time and
    the two buttons sit in a row under it.
- **Removing** asks nothing. The row leaves and a toast says "Linha
  removida" with a "Desfazer" button for 5 seconds. Undo puts the line
  back where it was. Focus moves to the next row, or to the title when
  none is left.
- **Empty:** an icon, "Nenhuma linha salva ainda. No player, toque no
  marcador ao lado de um verso para guardá-lo aqui.", and a link "Ir para
  o início".
- On load the page draws from the store at once, then refreshes titles,
  artists and covers from `GET /api/tracks/summary`, in batches no larger
  than that route's id limit. A failed refresh leaves the stored data,
  with no error message.
- The page reloads its data on `pageshow` from the back/forward cache and
  on the `storage` event.

### Dates

`savedLabel` gives, in the browser's local time:

| When | On the page | On a home card |
|---|---|---|
| Same calendar day | Salva hoje | Hoje |
| The day before | Salva ontem | Ontem |
| Earlier, same year | Salva em 2 de nov. | 2 de nov. |
| Another year | Salva em 3 de dez. de 2025 | 3 de dez. de 2025 |

The text is inside a `<time datetime>` whose `title` has the full date and
time.

### Type

No new sizes; these are already in use in the app:

| Element | Size / line height, weight |
|---|---|
| Page and section titles | 24/28, 700 (22/26 on phones) |
| Song title | 17/22, 600 |
| Artist, count | 14/20, 500 |
| Saved line | 20/26, 600 (18/24 on phones) |
| Card line | 19/25, 600 (17/23 on phones) |
| Translation | 15/20, 500 |
| Time, date | 13/18, 500 |

At 680 px a saved line holds about 60 characters, inside the 45 to 90
recommended for reading.

## 7. Server changes for saved lines

- `GET /salvas` serves the same page as `/` (`renderUploadPage`), with
  the title "Linhas salvas — letra" and the same `noindex` tag. When the
  front end is not built it answers 503 like `/`.
- The client entry (`web/upload/main.ts`) draws the saved page when the
  path is `/salvas`, whether or not the owner is signed in.
- Nothing else changes for stage 2: the page uses the existing summary
  route.

## 8. Line translation

### On a saved line

- Each line row on `/salvas` has a translate button with the player's
  translate icon. It is gray when the line shows no translation and white
  when it does. It has `aria-haspopup="menu"` and `aria-expanded`.
- The button opens a floating menu next to it:
  - "Português" and "Inglês", as `menuitemradio`;
  - the language of the lyrics is disabled, with the note "Idioma da
    letra" (known from the record's `lang`; when that is unknown both
    are enabled);
  - the language in use has a check;
  - "Ocultar tradução" appears when a translation is showing.
- The menu reuses the behavior of the player's language menu: arrow keys,
  Enter, Esc, closing on outside click and on focus leaving, focus back
  on the button. Its shared part moves to `web/shared/menu.ts`.
- Choosing a language:
  1. The row shows "Traduzindo para inglês…" where the translation goes.
     The text stays for at least 300 ms, so a fast answer does not
     flicker.
  2. On success the translation replaces it and is saved in the record
     (`tr`). A polite live region announces it.
  3. On failure the row shows "Não foi possível traduzir agora." with
     "Tentar de novo".
  4. If the server says the line is already in that language, the row
     shows "Esta linha já está em português." (or "em inglês") and the
     record's `lang` is corrected.
- "Ocultar tradução" clears `tr`.
- The button is absent on a song the server no longer has, and on every
  row when the server has no engine. The page learns that from a new
  field in the summary response (below).

### Route

`GET /api/tracks/:id/translation/line?index=<n>&lang=<code>&text=<line>`

- Public, with the same rate limit as the whole-lyrics route (30 a minute
  per client).
- `lang` must be one of `LANGUAGES`. The saved-line menu sends only
  `pt-BR` or `en`.
- The server only translates a line that exists in the stored song: it
  takes the line at `index` when its text equals `text`, else the first
  line whose text equals `text`. If none matches it answers 404
  `line_changed`. The route can not be used to translate arbitrary text.
- Answer: `{ lang, sourceLang, sameLanguage, text }`. When
  `sameLanguage` is true, `text` is empty.
- Errors: 404 `translation_off`, 400 `bad_language`, 400 `bad_request`
  (missing or malformed `index` or `text`), 404 `not_found`, 404
  `line_changed`, 503 `translation_unavailable`, 429.

The summary response gains `translationEnabled: boolean` next to
`tracks`, so `/salvas` knows whether to draw the buttons.

### Service

`translateLine(track, index, lang)` in the translation service:

1. If the song's `lyricsLang` has the same primary language as `lang`,
   answer `sameLanguage: true` with no engine call.
2. If the whole-lyrics translation for that language is cached, answer
   with its line.
3. If the line cache has it, answer from there.
4. Else call the engines in order with that one line, plus up to two
   lines before and two after as context, and cache the answer.

- A new table, added as a migration:

  ```sql
  CREATE TABLE line_translations (
    track_id      TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    lang          TEXT NOT NULL,
    line_hash     TEXT NOT NULL,   -- sha1 of the line's text
    text          TEXT NOT NULL,
    engine        TEXT NOT NULL,
    source_lang   TEXT,
    same_language INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    PRIMARY KEY (track_id, lang, line_hash)
  );
  ```

- Wherever the code clears a song's translations today (lyrics edited,
  searched again or repaired), it clears this table for the song too.
- The `Translator` input gains an optional
  `context: { before: string[]; after: string[] }`. The Claude engine
  passes it in its JSON payload with an instruction to translate only
  `lines`. LibreTranslate ignores it.
- Line calls share the service's concurrency limit and the in-flight
  de-duplication, keyed by song, language and line hash.

### The chat engine

A new engine, `server/lib/translate/chat.ts`, name `chat`. It talks to
any endpoint that implements OpenAI's chat completions: the Hugging Face
router, a llama.cpp server, Ollama, Docker Model Runner and others.

Configuration:

| Variable | Meaning |
|---|---|
| `TRANSLATE_API_URL` | Base URL ending in `/v1`. For Hugging Face: `https://router.huggingface.co/v1`. |
| `TRANSLATE_API_KEY` | Sent as `Authorization: Bearer …`. Optional, for local servers. |
| `TRANSLATE_MODEL` | The model id as the endpoint names it. |

- `TRANSLATOR` gains the mode `chat`. `TRANSLATOR=chat` without
  `TRANSLATE_API_URL` and `TRANSLATE_MODEL` fails at startup with a
  message, like the other modes.
- `auto` tries, in order, the engines that are configured: Claude, chat,
  LibreTranslate.
- **Protocol.** One user message, no system message (some translation
  models have none). It asks for the target language by name and code,
  for meaning and tone over word-for-word, and for exactly one output
  line per input line with nothing else. It gives the song title and
  artist, the context lines when present (marked as not to translate),
  and then the lines. `temperature` is 0, so a cached translation does
  not depend on chance.
- **Chunks.** Lyrics go in chunks of up to 24 lines, one after another.
  When a chunk comes back with the wrong number of lines, that chunk is
  redone line by line. The engine therefore always returns the right
  count or fails.
- **Source language.** One extra short call asks for the BCP-47 code of
  the lyrics' language, from the first non-blank lines. An answer that is
  not a valid tag counts as unknown.
- **Limits.** 60 s per request. Any HTTP or network failure is a
  `TranslationError("engine")`, so the next engine in `auto` gets its
  turn.

### Production setup (option A)

- Railway variables: `TRANSLATE_API_URL`, `TRANSLATE_MODEL` and
  `TRANSLATE_API_KEY`. The key is a Hugging Face token with the
  "Inference Providers" permission. The owner creates it and enters it in
  Railway; it is never written in chat or in the repository.
- The owner's PRO account includes US$ 2 a month of inference credits. At
  the router's listed prices one song costs about US$ 0.0005, so the
  credits cover thousands of songs. This is an estimate from the price
  table, not a measurement.
- **Choosing the model.** Before fixing `TRANSLATE_MODEL`, stage 3
  compares three router models (`google/gemma-4-31B-it`,
  `Qwen/Qwen3.8-27B` and `openai/gpt-oss-120b`) on the 15 sample lines
  used in the Docker probe, side by side, and the owner picks.
- With this option the lines, the song title and the artist go to
  Hugging Face and to the provider it routes to.

### Docker option (option B)

- `docker-compose.yml` gains a `hymt` profile: a `llama.cpp` server
  running `tencent/Hy-MT2-1.8B` (GGUF, Q4_K_M, Apache-2.0), with the
  model file kept in a named volume and downloaded on first start.
- With the profile on, the app uses `TRANSLATOR=chat`,
  `TRANSLATE_API_URL=http://hymt:8080/v1` and no key.
- Measured in a container limited to 2 CPUs and 2 GB: 1.1 GB of memory;
  about 1.3 s for a line (2 to 3.5 s on 1 CPU); 7.4 s for a 6-line verse,
  which came back with 6 lines. A 50-line song should take about a minute
  the first time; that is an extrapolation.
- The README documents both options.

## 9. Front-end structure

New:

- `web/shared/saved.ts`: the store (section 4).
- `web/shared/menu.ts`: the floating menu behavior, taken from
  `web/player/translation.ts`.
- `web/shared/motion.ts`: the FLIP helper and the animated icon swap.
- `web/upload/saved-page.ts`: the `/salvas` page.
- `web/upload/saved-section.ts`: the home section.
- `web/upload/line-translate.ts`: the translate button, menu and states.
- `web/player/save-line.ts`: the icon in the verses, the button after
  the lyrics, the `S` key and the feedback.
- `server/lib/translate/chat.ts`: the chat engine.

Changed:

- `web/player/main.ts`: no "Letra" pill and no "Tocar" pill; cover view
  on full screen; the skip link; reading `?t=`.
- `web/player/lyrics-view.ts`: the save icon inside each verse and the
  saved state; a way to ask for the roving verse.
- `web/player/layout-order.ts`: no `lyricsToggle`.
- `web/player/styles.css`, `web/upload/styles.css`,
  `web/shared/tokens.css`, `web/shared/base.css`: the column, the gutter,
  the saved look, the motion tokens and every transition.
- `web/shared/icons.ts`: `bookmark-simple` (regular and fill).
- `web/shared/dom.ts`: the animated `setIcon`.
- `web/shared/toast.ts`: an optional action button and a duration.
- `web/shared/api.ts`: `getLineTranslation`; the summary's
  `translationEnabled`.
- `web/upload/main.ts`, `web/upload/home.ts`: the `/salvas` path and the
  home section.
- `server/routes/pages.ts`, `server/lib/render.ts`: `/salvas`.
- `server/routes/translation.ts`, `server/routes/tracks.ts`: the line
  route; `translationEnabled` in the summary.
- `server/lib/translate/service.ts`, `types.ts`, `engines.ts`,
  `claude.ts`: `translateLine`, `context`, the `chat` mode.
- `server/config.ts`, `server/db.ts`: the new variables; the migration.
- `shared/types.ts`: `LineTranslationDTO`; the summary response.
- `docker-compose.yml`, `.env.example`, `README.md`: the chat engine and
  the `hymt` profile.

## 10. Copy (pt-BR)

Sentence case everywhere, as in the rest of the app. Actions start with
a verb. The saved thing is always a "linha", never a "verso".

| Where | Text |
|---|---|
| Skip link | Pular a letra |
| Full-screen button (on or off: the state is in `aria-pressed`) | Tela cheia |
| Same button with no Fullscreen API (on or off: the state is in `aria-pressed`) | Mostrar capa |
| Save button name, not saved | Salvar linha: {linha} |
| Save button name, saved | Remover linha salva: {linha} |
| Announcement after saving | Linha salva |
| Announcement after removing | Linha removida |
| First-save toast | Linha salva. Elas ficam em Início › Linhas salvas. |
| Limit reached | Você chegou ao limite de 1000 linhas salvas. Remova algumas para salvar novas. |
| Storage blocked | Não foi possível salvar neste navegador. |
| Home section heading; page title | Linhas salvas |
| Home section link | Ver todas ({n}) |
| Tab title of `/salvas` | Linhas salvas — letra |
| Page count | {n} linhas em {m} músicas |
| Page count, singular | 1 linha em 1 música |
| Song count | {n} linhas |
| Song count, singular | 1 linha |
| Unavailable song | Música indisponível |
| Remove button on a row | Remover linha salva |
| Toast after removing on the page | Linha removida |
| Toast action | Desfazer |
| Empty page | Nenhuma linha salva ainda. No player, toque no marcador ao lado de um verso para guardá-lo aqui. |
| Empty page link | Ir para o início |
| Date on the page | Salva hoje; Salva ontem; Salva em {data} |
| Date on a home card | Hoje; Ontem; {data} |
| Translate button | Traduzir linha |
| Menu items | Português; Inglês |
| Note on the lyric's language | Idioma da letra |
| Menu item to hide | Ocultar tradução |
| Translating | Traduzindo para português…; Traduzindo para inglês… |
| Translation failed | Não foi possível traduzir agora. |
| Retry | Tentar de novo |
| Same language | Esta linha já está em português.; Esta linha já está em inglês. |
| Line changed | Esta linha mudou na música e não pode ser traduzida. |

Where a cell lists more than one text, a semicolon separates them; it is
not part of any text.

## 11. Errors

- **Storage blocked or full:** saving shows the toast above; the rest of
  the player works. The saved page and the home section read as empty.
- **Limit of 1000:** saving shows the limit toast; nothing is removed.
- **Bad stored data:** bad records are skipped one by one.
- **Summary refresh fails:** stored titles and covers stay.
- **Song removed on the server:** its lines stay, marked unavailable.
- **Bad `?t=`:** ignored.
- **Translation off, failing or rate-limited:** the row shows the failure
  text and "Tentar de novo"; with translation off there is no button.
- **Line no longer in the song:** the row shows the "line changed" text.
- **No Fullscreen API:** the cover view works inside the page.
- **Full-screen request refused by the browser:** the view does not
  change.

## 12. Testing

Unit (vitest, node):

- `saved.ts`: save, replace, remove, restore, the limit, blocked storage,
  malformed data, grouping and order, summary merge, the date labels
  around midnight and across years.
- `chat.ts` against a stub endpoint: the request shape and the key
  header, chunks, a wrong-count chunk redone line by line, the timeout,
  HTTP errors, language detection and a bad tag.
- The service: `translateLine` through each of its four paths; the cache
  cleared when lyrics change.
- Config: the `chat` mode and its required variables; `auto` order.
- The `linear()` spring token is present with its fallback.

API (vitest):

- `/salvas` serves the page; 503 when not built.
- The line route: each error; the text match by index and by search; the
  rate limit; no engine call when the language is the same.
- `translationEnabled` in the summary.

End to end (Playwright), with the fake engine:

- Player: no "Letra" or "Tocar" pill; the save icon on hover, on focus
  and on the playing verse with `hover: none`; the saved look; the `S`
  key; the button after the lyrics and its name; the first-save toast
  only once; two tabs in step; `?t=` valid and invalid.
- Cover view: full screen switches to it and back; with the Fullscreen
  API removed, the button toggles it inside the page; translation and
  save are inert in it.
- The skip link moves focus to the play button and adds no Tab stop.
- Layout: the column widths at 1024, 1440 and 1920 px; the gutter; the
  group still centered; no horizontal scroll at 360 px.
- Home: the section appears with saved lines, shows 3, links with `?t=`.
- `/salvas`: grouping and order; dates; remove and undo; the unavailable
  song; the empty state; focus after removing.
- Line translation: the menu by pointer and keyboard; the lyric's
  language disabled; translating, success, failure and retry; the
  translation still there after a reload; "Ocultar tradução".
- Motion: press scale on buttons; durations read from the tokens; with
  reduced motion every transition is immediate; navigation between home
  and player works with and without view transitions.
- Accessibility: focus order, 44 px targets, names of the new controls.

Not automated:

- How the animations feel. They are checked from frame captures before
  each pull request; the final call is the owner's, on the live site.
- VoiceOver on a real iPhone.
- The quality of each translation model; the owner judges the comparison
  in stage 3.

## 13. Risks

- **The cover traveling between pages.** Both pages are drawn by script
  after load, and a cross-document view transition captures the new page
  at its first paint. For the shared cover to work, the cover must be in
  the page by then. If that can not be made reliable in Chrome and
  Safari within stage 1, the stage ships the plain cross-fade between
  pages and reports it, and the shared cover becomes a follow-up.
- **The icon inside the verse button.** A click target inside a button is
  unusual. Pointer and touch users get the icon; keyboard and screen
  reader users get the real button after the lyrics and the `S` key. If
  review finds this confusing, the alternative is a row wrapper with two
  sibling buttons, which changes the follow animation.
- **Full screen and the cover FLIP.** Browsers animate their own
  full-screen change. The FLIP runs after `fullscreenchange`, but the two
  motions may still look doubled in some browsers; the fallback is a
  plain fade of the lyrics with no cover motion during the real
  full-screen change.
- **Router models change.** A model can leave the router or change price.
  `TRANSLATE_MODEL` is configuration, and `auto` falls through to the
  next engine.
- **Line versus whole-song translations can differ**, because one has
  more context. The service prefers the whole-song translation when it
  exists.
- **More Tab stops and a wider column** change several v2 layout and
  focus tests. They are updated to the values in this spec, not loosened.

## 14. References

Motion and interaction:

- Emil Kowalski, "7 practical animation tips":
  https://emilkowal.ski/ui/7-practical-animation-tips
- Emil Kowalski, "Great animations":
  https://emilkowal.ski/ui/great-animations
- Rauno Freiberg, "Invisible Details of Interaction Design":
  https://rauno.me/craft/interaction-design
- Vercel, "Web Interface Guidelines": https://vercel.com/design/guidelines
- Nielsen Norman Group, "Executing UX Animations: Duration and Motion
  Characteristics": https://www.nngroup.com/articles/animation-duration/
- Josh W. Comeau, on springs with `linear()`:
  https://www.joshwcomeau.com/animation/linear-timing-function/
- Chrome for Developers, cross-document view transitions:
  https://developer.chrome.com/docs/web-platform/view-transitions/cross-document
- web.dev, "Now in Baseline: animating entry effects":
  https://web.dev/blog/baseline-entry-animations
- MDN, autoplay guide:
  https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay
- Apple Developer Forums, Fullscreen API on iPhone:
  https://developer.apple.com/forums/thread/133248

Page, copy and type:

- Matthew Butterick, "Line length":
  https://practicaltypography.com/line-length.html
- Nielsen Norman Group, "Designing Empty States in Complex Applications":
  https://www.nngroup.com/articles/empty-state-interface-design/
- Aza Raskin, "Never Use a Warning When You Mean Undo":
  https://alistapart.com/article/neveruseawarning/
- Cloudscape, timestamps pattern:
  https://cloudscape.design/patterns/general/timestamps/
- UX Movement, "Absolute vs. Relative Timestamps":
  https://uxmovement.com/content/absolute-vs-relative-timestamps-when-to-use-which/
- Apple, Human Interface Guidelines, SF Symbols and Writing:
  https://developer.apple.com/design/human-interface-guidelines/sf-symbols
  and https://developer.apple.com/design/human-interface-guidelines/writing
- IBM Carbon, writing style:
  https://carbondesignsystem.com/guidelines/content/writing-style

Translation:

- Hugging Face, Inference Providers pricing:
  https://huggingface.co/docs/inference-providers/pricing
- Hugging Face, translation task:
  https://huggingface.co/docs/inference-providers/tasks/translation
- Tencent, Hy-MT2-1.8B model card:
  https://huggingface.co/tencent/Hy-MT2-1.8B
- WMT25 preliminary ranking: https://arxiv.org/html/2508.14909v2
- Chrome for Developers, Translator API:
  https://developer.chrome.com/docs/ai/translator-api
