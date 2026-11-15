# letra player v2: design

Date: 2026-11-09. Status: approved in conversation, section by section; this
document awaits the owner's review.
Amended 2026-11-09 after owner feedback on the deployed v2.

This spec amends `2026-11-08-letra-web-player-design.md` (the v1 spec). Where
the two disagree, this one wins; everything it does not mention stays as v1
describes it. Paths are relative to `app/`.

## 1. Goal

### What the owner asked for

After using the deployed v1, the owner asked for four things:

1. **No time tags in the lyrics.** Verses showed text such as
   `[02:54.60]She's gone away`. This was a parsing bug, already fixed and
   merged (viniciussalve/letra#14); it is not part of this spec.
2. **A share button** shaped like the lyrics and full-screen buttons. It
   opens a dialog with WhatsApp, Instagram Stories, X and a QR code, modeled
   on a Duolingo profile-share modal the owner sent (title and handle, a QR
   code with the avatar in the middle, "Share link" and "Copy link" buttons).
3. **A home button.** It leads to a home that lists the songs already
   shared.
4. **TIDAL's look.** The owner saved TIDAL's web player ("Dynamite", by
   Jamiroquai, with the lyrics panel open) as a SingleFile HTML page so the
   design could be read from it.

### Decisions made in the brainstorm

- **Discord:** dropped from the share dialog.
- **Stories:** a song card image (option A), not verse picking and not the
  bare link.
- **Home:** each person sees their own songs (option B). The owner sees
  every upload; a listener sees the songs they opened on that device. No
  public library.
- **Visual:** option B. Take TIDAL's layout, type, lyrics column, the way
  inactive verses dim, the intro dots and tap-to-seek. Keep two v1 choices:
  the background from the cover's colors (darkened) and the wipe on the
  active verse.

### Assumptions (stated, not asked)

- **Fonts:** Inter becomes the first font on every device, Apple devices
  included, so the look matches TIDAL's grotesk everywhere. v1 put the
  Apple system font first.
- **Accent color:** none. TIDAL's cyan is left out; the interface stays in
  white and greys.
- **Phones and tablets:** the TIDAL page is the desktop layout. Phones and
  tablets get the same style in the v1 phone arrangement.

### Success criteria

1. **Wide screens:** the player reads as TIDAL's now-playing view. Cover on
   the left, a narrow column of large bold verses beside it, and a player
   bar along the bottom, over a dark cover-tinted background.
2. **Sharing to WhatsApp or X:** the share dialog reaches each in one tap
   with the title, artist and link filled in.
3. **The QR code:** a phone camera scans it, even with the cover in its
   middle.
4. **Stories from a phone:** one tap in the dialog opens the system share
   sheet with the card image, and the link is already on the clipboard.
5. **The home for a listener:** after opening two shared songs, the
   listener finds both there, newest first.
6. **No regressions:** everything in v1 still works, including
   translation, keyboard shortcuts, Media Session, the upload flow and the
   accessibility floor.

## 2. Scope

**In:**

- The player's new look, on wide screens, tablets and phones.
- The share dialog, the QR code and the Stories card.
- The home at `/`: a listener view and the owner view restyled.
- A public route that returns summaries of known tracks.
- Tests, and a docs update in `app/README.md` (a short "Sharing" note).

**Out:**

- Discord.
- Choosing which verses go on the card.
- Video stories.
- A server-rendered card.
- A public library of all tracks.
- Accounts for listeners.
- Syncing a listener's history across devices.
- TIDAL's queue, credits and "similar tracks" panels, and its shuffle and
  repeat buttons.
- The cyan accent.

## 3. Reference: TIDAL's now-playing view

The reference is the owner's SingleFile save of `listen.tidal.com`, made on
2026-11-08 and titled "Dynamite / Jamiroquai - TIDAL". It shows the track
"Feels Just Like It Should" at 0:02, with the lyrics tab open and the queue
panel showing. The page was rendered offline at 1440×900, with JavaScript
off and the network blocked, and the values below were read from its
computed styles.

**Page:**

- Background: `#000`.
- UI text: TIDAL's "Square Sans Text", weight 500, 14/20, white.
- Secondary text: `rgb(175 175 182)` or white at 80%.

**Cover:** 426 px square, square corners, 72 px from the left edge,
centered vertically.

**Lyrics column:**

- 424 px wide, starting at x = 578.
- It scrolls under a 64 px fade at its top and bottom edges, and its
  content ends with 184 px of padding.
- Clicking a verse seeks to it (`cursor: pointer`).

**Verses:**

- TIDAL's "Square Sans Display", weight 700, 31.38/36.09 px (line height
  1.15). About one line of space between verses.
- The active verse has opacity 1 and `scale(1)`.
- Every other verse has opacity 0.55 and `scale(0.9)`, with
  `transform-origin: left center`.
- No blur (`--lyrics-blur-strength: 0`).
- Opacity and transform move over 0.46 s, `cubic-bezier(.4, 0, .2, 1)`.
  Verses that dim start 90 ms late; the verse that lights starts at once.
- The whole line lights at once; there is no wipe.

**Intro dots:**

- Before the first verse, three white dots (9.4 px circles) sit where a
  verse would.
- They pulse on a 1.6 s ease-in-out loop, the second and third 0.2 s and
  0.4 s behind the first.
- With reduced motion they do not move.

**Top right:**

- Text pills: "Músicas semelhantes", "Créditos", "Letras".
- The open pill is solid white with black text: 14/22 weight 500, 32 px
  tall, fully rounded, with color transitions of 0.15 s.
- Then expand and collapse icon buttons.

**Bottom bar:**

- Left: title (14/20, weight 500, white), artist and album in grey.
- Center: shuffle, previous, play, next and repeat over a 4 px progress bar,
  471 px wide, with times at both ends (14 px, weight 500, tabular figures).
- Right: queue, volume and an audio-quality badge.

**Not used:**

- TIDAL's name and logo, and its Square Sans fonts, which are proprietary.
- Its icon set and its cyan accents (`#33FFEE`, `#16D8A7`).

## 4. Player: visual design

### Tokens

These change from v1:

```css
:root {
  --bg:            #000;
  --veil:          rgb(0 0 0 / .55);   /* over the cover gradient */
  --text-2:        #AFAFB6;            /* artist, times, secondary (was white 60%) */
  --surface:       #141416;            /* dialogs, sheets, drop panel */
  --surface-2:     #26262A;            /* round action buttons, inputs */
  --verse-dim-opacity: .55;
  --verse-dim-scale:   .9;
  --verse-unsung:  rgb(255 255 255 / .45);  /* wipe: the part not yet sung */
  --lyrics-ease:   cubic-bezier(.4, 0, .2, 1);
  --lyrics-duration: .46s;
  --lyrics-dim-delay: 90ms;
  --bar-track:     rgb(255 255 255 / .2);
  --bar-fill:      #fff;
  --bar-height:    4px;                /* 6px while hovered or dragged */
  --radius-cover:  0;
  --font: "Inter Variable", "Inter", system-ui, "Hiragino Sans",
          "Noto Sans CJK JP", "Apple SD Gothic Neo", "Noto Sans KR",
          "PingFang SC", sans-serif;
}
```

`--text-verse-dim` and the glass blur tokens go away. The focus ring, the
44 px hit targets, `--danger` and the reduced-transparency fallbacks stay.

**Font:** load `@fontsource-variable/inter/opsz.css` instead of the default
entry. That build has Inter's optical-size axis, and with
`font-optical-sizing: auto` large verses get the display cut.

**Background:** the v1 cover gradient (k-means palette, drifting radial
blend) stays, with `--veil` laid over it, so the page reads as near-black
tinted by the cover. The contrast rules from v1 §7 still apply: white text
reaches 4.5:1 and `--text-2` reaches 4.5:1 on the veiled background.

### Type

| Role | Wide (≥ 1024 px) | Phone (< 640 px) |
|---|---|---|
| Verse | `clamp(26px, 2.2vw, 34px)` / 1.1, weight 700, `-0.01em` | 26/29, weight 700 |
| Translation under a verse | 0.6em of the verse, weight 700, at least 19 px, line height 1.25 | 19/24, weight 700 |
| Title (bottom bar, phone header) | 14/20, weight 600 | 15/20, weight 600 |
| Artist | 14/20, weight 500, `--text-2` | 14/18, `--text-2` |
| Times | 12/16, weight 500, tabular, `--text-2` | same |
| Pills and text buttons | 14/22, weight 500 | same |
| Home heading | 24/28, weight 700 | 22/26, weight 700 |
| Grid tile title / artist | 14/20, weight 600 / 14/20, weight 500, `--text-2` | same |

### Layout

```
wide (≥ 1024 px)
┌──────────────────────────────────────────────────────────────────────────┐
│ (⌂)                                  (文A)(Português ▾) [Letra] (⤴) (⤢)  │ top bar, 64 px
│                                                                          │
│   ┌──────────────────┐    • • •                 intro dots               │
│   │                  │    verso anterior        .55, scale .9            │
│   │       capa       │                                                   │
│   │  426 px max,     │    VERSO ATUAL ███▒▒     30% down, wipe           │
│   │  square corners  │    tradução do verso                              │
│   │                  │    próximo verso         .55, scale .9            │
│   └──────────────────┘                          fade 64 px top/bottom    │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ Talullah                   ⟲10    ▶    10⟳                     🔈 ━━━━  │ bottom bar, 96 px
│ Jamiroquai          2:01 ━━━━━━━━━●────────────── −4:05                 │
└──────────────────────────────────────────────────────────────────────────┘

phone (< 640 px)
┌──────────────────────────┐
│ (⌂) ▣ Talullah       (⤴) │  48 px cover
│       Jamiroquai         │
│                          │
│ • • •                    │
│ verso anterior           │
│ VERSO ATUAL ███▒▒        │
│ tradução                 │
│ próximo verso            │
│                          │
│ ━━━━━━━━●─────────────── │
│ 2:01               −4:05 │
│    ⟲10     ▶     10⟳     │
│ [Letra]   (文A)      (⤢)  │
└──────────────────────────┘
```

**Wide screens:**

- **Cover:** `min(426px, 30vw, calc(100vh - 260px))` square, centered
  vertically between the bars. Horizontally it is part of a group (below).
- **Lyrics column:** starts 72 px to the right of the cover (the verses do;
  the column's own 16 px padding sits in that gap) and is
  `min(440px, 34vw)` wide. It fills the height between the bars, with a
  64 px fade top and bottom and 184 px of bottom padding.
- **Centered group:** the cover, the 72 px gap and the lyrics column form
  one group, centered horizontally in the viewport, with a minimum side
  margin of 72 px when the viewport is too narrow. The verse text stays
  left-aligned inside its column. (At 1440 px the cover is 259 px from the
  left edge; before the amendment it was fixed at 72 px, which left a large
  empty area on the right.)
- **Top bar:**
  - Left: the home button, a 44 px glass circle with a house icon, linking
    to `/`.
  - Right, in order: the translation button and its language pill (as in
    v1), then a "Letra" text pill, the share button and the full-screen
    button.
  - The "Letra" pill turns solid white with black text while lyrics are on,
    like TIDAL's "Letras".
- **Bottom bar:**
  - Left: title and artist, truncated with an ellipsis.
  - Center: back 10 s, play/pause and forward 10 s above the progress bar,
    which is `min(560px, 40vw)` wide with the elapsed time on its left and
    the remaining time on its right.
  - Right: volume, where the browser can set it.
- **Lyrics off:** the cover centers on the stage at
  `min(480px, 50vh)`. Both bars stay.

**Tablets (640 to 1023 px):** the phone arrangement with a 64 px cover and
the wide verse size.

**Kept from v1:**

- The "▶ Tocar" pill before the first play. It is still centered across the
  column, but it sits in the empty band above the first row (15% down, at
  least 22 px), so it covers no verse. It is the column's first child, so
  screen readers and Tab reach it before the verses.
- The "Voltar ao verso atual" pill after a manual scroll.
- Keyboard shortcuts, Media Session and the unsynced, no-lyrics and
  instrumental states.
- The translation menu.

### Lyrics behavior

These change from v1 §7 "Lyrics behavior":

- **Inactive verses:** opacity `--verse-dim-opacity` and
  `scale(var(--verse-dim-scale))` with `transform-origin: left center`.
  Synced lyrics only: they also blur by distance from the shown active
  verse, 1 px at distance 1, 2 px at 2 and 3 px from 3 on (0.6, 1.2 and
  2 px on phones). Before any verse is active the distance runs from the
  intro row, or from the first verse. Only rows within 24 of the active
  one blur, which covers every row of a tall column (1024×1366); further
  ones are far off screen. The intro row blurs like a verse once it is
  past. `filter`
  animates with `--lyrics-duration` and `--lyrics-ease`, like opacity and
  transform. With a mouse, hovering one removes its blur and raises it to
  opacity 0.8; so does `:focus-visible` on a verse button. Unsynced lyrics
  have no blur.
- **Spacing:** the gap between verses is half a line (0.5em at verse
  size, as 0.25em of padding above and below each verse) and the verse line
  height is 1.1. The translation's top gap is 0.1em. The 30% follow
  position and the `max(184px, 70cqh)` bottom padding are unchanged.
- **Lead:** the shown active verse (and the intro and break rows) runs
  `LYRICS_LEAD_MS = 300` ahead of the audio clock, because the verse takes
  about half a second to light up and scroll into place. A verse never lights
  earlier than half the gap from the line before it, so seeking to a verse
  shows that verse. The wipe starts on real time (it is 0 until the line's
  start) and ends when the next verse lights, so the previous verse's wipe
  finishes instead of being cut short. Any time-remaining logic stays on
  real time.
- **The active verse:** opacity 1 and `scale(1)`, with the v1 wipe. The
  sung part is `#fff` and the unsung part `--verse-unsung`.
- **Motion:**
  - Opacity and transform move over `--lyrics-duration` with
    `--lyrics-ease`. A verse that dims waits `--lyrics-dim-delay`; the verse
    that lights does not wait.
  - The column still scrolls the active verse to 30% of its height,
    smoothly over 500 ms.
  - v1's 30 ms cascade is removed.
- **Intro dots:**
  - When the first synced verse starts at 3 s or later, a dots row comes
    first. It is active from 0 until the first verse lights.
  - Three dots, each 0.3em of the verse size, pulse on a 1.6 s ease-in-out
    loop with 0.2 s steps.
  - The v1 three-dot pause for breaks (empty LRC lines) uses the same
    component.
- **Seeking:** unchanged. Clicking or tapping a verse seeks to it and plays;
  verses stay buttons.
- **Reduced motion:** no scale change, no pulse, no smooth scroll and no
  wipe. The active verse turns white at once. The blur stays, static, with
  no transition.
- **Reduced transparency or more contrast:** inactive verses at opacity
  0.7 and no blur.

## 5. Share dialog

The share button (`(⤴)`, 44 px glass circle, `share` icon, label
"Compartilhar") opens a modal `<dialog>`, built the same way as the upload
page dialogs: `showModal`, Esc closes, focus returns to the button.

```
┌────────────────────────────────────┐
│ (✕)          Talullah              │
│             Jamiroquai             │
│                                    │
│      ┌──────────────────────┐      │  white, radius 20, padding 20
│      │ ▣ ∴∵∴∵∴∵∴∵∴∵∴∵ ▣ │      │
│      │ ∴∵∴∵∴ ┌────┐ ∴∵∴∵ │      │  QR 240 px, dotted modules
│      │ ∵∴∵∴∵ │capa│ ∵∴∵∴ │      │  cover at 22% of the width
│      │ ∴∵∴∵∴ └────┘ ∴∵∴∵ │      │
│      │ ▣ ∴∵∴∵∴∵∴∵∴∵∴∵∴∵ │      │
│      └──────────────────────┘      │
│                                    │
│  (wa)   (ig)   (𝕏)   (🔗)   (⋯)   │  56 px round buttons
│ WhatsApp Stories  X  Copiar  Mais… │  labels 12/16, --text-2
│                      link          │
└────────────────────────────────────┘
```

- **The panel:**
  - Wide screens: a card centered on the screen, 400 px wide, `--surface`,
    radius 24, hairline border.
  - Phones: a bottom sheet, full width, with radius 24 on the top corners.
    It slides up over 250 ms (no slide with reduced motion).
- **Header:** a close button (44 px, `x` icon, "Fechar") at the top left.
  The title (17/22, weight 600) and artist (14/20, `--text-2`) are
  centered; the title is the dialog's accessible name.
- **QR code:**
  - Encodes `track.shareUrl` with error correction H.
  - Drawn as an SVG, 240 px, on a white rounded square:
    - each dark module is a circle 82% of the module's size, in `#000`;
    - the three finder patterns are rounded squares (outer ring, then a
      rounded inner block);
    - modules under the center box are not drawn.
  - The center box is 22% of the code's width, with a 6 px white margin. It
    holds the cover (radius 8) from `/media/<id>/cover.jpg`, or, with no
    cover, a music-note tile on the palette's first color.
  - Accessible name: "QR code do link da música".
- **Actions, in order:**
  1. **WhatsApp:** a link to `https://wa.me/?text=` plus the encoded
     `"<title> — <artist>\n<shareUrl>"`, opened in a new tab.
  2. **Stories:** see §6.
  3. **X:** a link to `https://x.com/intent/tweet?text=` plus the encoded
     `"<title> — <artist>"`, then `&url=` and the encoded share URL, opened
     in a new tab.
  4. **Copiar link:** copies the share URL and shows the toast "Link
     copiado". If the clipboard is blocked, v1's toast with the link
     selected is the fallback.
  5. **Mais…:** `navigator.share({ title, text: "<title> — <artist>",
     url })`. It is only present where `navigator.share` exists, and
     `AbortError` is ignored.
- **Action buttons:**
  - 56 px circles in `--surface-2` with a 24 px white glyph (Phosphor fill:
    `whatsapp-logo`, `instagram-logo`, `x-logo`, `link`, `dots-three`).
  - WhatsApp and X are `<a>` elements; the others are buttons.
  - Five fit in a row at 360 px.
- **Removed:** the v1 share button in the header, which opened the system
  sheet directly, and its module `web/player/share.ts`. The toast moves to a
  shared module.

## 6. Stories card

**Image:** 1080 × 1920 PNG, drawn in the browser on a `<canvas>`, never on
the server.

**Content**, top to bottom. Safe area y 220 to 1700, because Instagram's
own interface covers the edges.

- **Background:**
  - The track's palette as four radial gradients over the darkest color,
    as on the page, without the drift.
  - Then black at 45%.
- **Cover:** 680 × 680, centered, top at y = 260, square corners, shadow
  `0 30px 80px rgb(0 0 0 / .5)`. With no cover, the music-note tile.
- **Title and artist:**
  - Title: 56/64, weight 700, white, at y = 1010.
  - Artist: 44/52, weight 500, `#D0D0D6`, below it.
  - Each is one line, cut with an ellipsis.
- **Verse:**
  - It is the verse active when the dialog opened: 64/76, weight 700,
    white, at most 4 lines with an ellipsis, starting at y = 1170.
  - When translation is on, the translated verse follows: 44/56, weight
    700, white at 75%, at most 3 lines.
  - With no verse (before the first verse, no lyrics, instrumental, or a
    dots row active), the verse block is left out.
- **Wordmark:** "letra", 36 px, weight 700, white at 60%, centered at
  y = 1640.

**Fonts and images:**

- The canvas waits for `document.fonts.load` of Inter at weights 500 and
  700 before drawing.
- The cover comes from the same origin, so the canvas stays readable.

**Text wrapping:** a pure function `wrapLines(text, maxWidth, measure,
maxLines)` breaks lines at spaces, ends the last line with "…" when it
overflows, and breaks inside a word only when the word alone does not fit.

**When the card is made:** when the dialog opens, for the verse active at
that moment. iOS Safari only opens the share sheet inside the tap that
asked for it, so the file has to be ready before the tap. The Stories button
shows a spinner and stays disabled until the card is ready (typically under
300 ms).

**Tapping Stories:**

1. Copy the share URL (the promise is not awaited, so the tap's user
   activation is kept).
2. If `navigator.canShare?.({ files: [file] })`, call
   `navigator.share({ files: [file] })` and show the toast "Link copiado.
   Adicione o adesivo de link no Instagram." `AbortError` is ignored.
3. Otherwise, download the file as `letra-<id>.png` and show the toast
   "Imagem salva. Poste nos Stories pelo celular."

**Failure:** if the cover fails to load or `toBlob` returns null, the
button shows the toast "Não deu para gerar a imagem. Tente de novo." and
the dialog stays open. A second tap retries.

## 7. Home

### One page, two views

`GET /` keeps serving the upload page template. On load, the page calls
`GET /api/session` (v1):

- `owner: true`: the owner view (v1's upload page, restyled).
- `owner: false`: the listener view.

The v1 full-page sign-in becomes a dialog, opened by an "Entrar" pill in
the listener view. It has the same password field, button, error copy and
rate limit. After a successful sign-in, the page switches to the owner
view without a reload.

### Listener view

```
┌──────────────────────────────────────────────────────────┐
│ letra                                          [Entrar]  │
│                                                          │
│ Ouvidas recentemente                  Limpar histórico   │
│                                                          │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   │
│ │ capa │ │ capa │ │ capa │ │ capa │ │ capa │ │ capa │   │  auto-fill, min 160 px
│ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘   │
│ Talullah  Dynamite …                                     │
│ Jamiroquai                                               │
└──────────────────────────────────────────────────────────┘
```

- **Page:** `--bg` background with the default palette under `--veil`.
  Content is up to 1200 px wide and centered, with 24 px side padding on
  phones.
- **Header:** the "letra" wordmark (22 px, weight 700) on the left and an
  "Entrar" pill on the right.
- **Heading:** "Ouvidas recentemente". When the list is not empty, a text
  button "Limpar histórico" (`--text-2`) sits at the right end of the
  heading row.
- **Grid:**
  - Columns: `repeat(auto-fill, minmax(160px, 1fr))`, with 24 px gaps on
    wide screens; two columns with 16 px gaps on phones.
  - Each tile is a link to `/t/<id>`: a square cover (radius 4) or the
    palette tile, then the title (one line, ellipsis) and the artist.
- **Empty list:** a centered music-note icon and "As músicas que você abrir
  por um link aparecem aqui."
- **"Limpar histórico":** clears the list at once and shows the toast
  "Histórico apagado". It does not ask for confirmation.

### History store (`web/shared/recents.ts`)

- **Storage:** the key `letra.recents.v1` in `localStorage` holds a JSON
  array of `{ id, title, artist, hasCover, at }`. It is newest first, has no
  duplicate ids and keeps at most 50 entries.
- **Recording:** the player records the track on load, before playback
  starts. A repeat visit moves the entry to the front and refreshes title,
  artist, `hasCover` and `at`.
- **Failures:**
  - Every read and write is wrapped in try/catch: if storage throws (a
    private window, quota, blocked site data), the history is just empty.
  - Malformed stored JSON reads as empty.
- **Loading the home:**
  1. Render from the store at once.
  2. Call `GET /api/tracks/summary?ids=…` with the stored ids.
  3. Drop the ids the server did not return, update title, artist and
     `hasCover` from the response, save, and re-render.
  4. If the request fails, keep the local render with no error message.

### Owner view

v1's upload page, restyled:

- **Page and header:** `--bg`. The wordmark on the left and "Sair" on the
  right.
- **Drop panel:** `--surface`, radius 16, with a 1 px dashed hairline
  border.
- **"Enviadas" list:**
  - TIDAL-like rows, 56 px tall: a 40 px cover (radius 2), title and artist,
    the duration in tabular figures, and the actions.
  - The behavior, menus and dialogs are all unchanged.

## 8. Server

### `GET /api/tracks/summary`

- **Access:** public; no session needed.
- **Query:** `ids`, a comma-separated list of 1 to 50 track ids, each
  matching `^[0-9A-Za-z]{10}$`. Duplicates collapse to one.
- **Response:**
  - `200 { tracks: TrackSummary[] }`, in the order the ids were asked for.
  - Ids with no track are left out.
  - `Cache-Control: no-store`.
- **Bad input:** a missing or empty `ids`, more than 50 ids, or a malformed
  id gets `400 bad_request` with v1's copy, "Pedido inválido. Confira os
  dados e tente de novo."
- **Rate limit:** 60 requests a minute per client, using the same key as
  the other limits (`CLIENT_IP_HEADER`, then `req.ip`). Over the limit, the
  answer is `429` with the v1 copy.
- **Where it lives:** `server/routes/tracks.ts`, outside the owner-only
  scope.

```ts
// shared/types.ts
export type TrackSummary = {
  id: string;
  title: string;
  artist: string;
  hasCover: boolean;
  palette: Palette;
  durationMs: number;
};
```

**What it reveals:** only what a share page already shows (title, artist,
cover and colors), and only for ids the caller already has. Ids are 10
random base62 characters, about 59 bits, so they cannot be guessed. The
owner-only `GET /api/tracks` list does not change.

**Startup repair:** after `listen`, `repairEmbeddedLyrics`
(`server/lib/lyrics/repair.ts`) re-reads the stored audio of embedded-source
tracks whose lines still start with an LRC time tag (uploaded before repeated
verse tags were parsed), saves the synced lyrics and clears their cached
translations. It is idempotent, skips a track whose lyrics would not change,
whose audio is unreadable, or that the owner edited meanwhile, and never
blocks or fails startup. Nothing else on the server changes. There is no new
configuration.

## 9. Front-end structure

**New modules:**

| File | Purpose |
|---|---|
| `web/shared/recents.ts` | History store (§7). |
| `web/shared/toast.ts` | The toast used by the player and the home; it replaces the player's copy in `share.ts` and the upload page's own. |
| `web/player/share-dialog.ts` | The dialog and its actions (§5). |
| `web/player/share-links.ts` | Pure builders for the WhatsApp and X URLs. |
| `web/player/qr.ts` | `qrSvg(text, { center })`: the matrix from `uqr` drawn as the dotted SVG (§5). |
| `web/player/story-card.ts` | `drawStoryCard(ctx, data)` and `makeStoryCard(data): Promise<File>` (§6). |
| `web/shared/wrap.ts` | `wrapLines` (§6). |
| `web/upload/home.ts` | Listener view and the view switch (§7). |
| `server/lib/lyrics/repair.ts` | `repairEmbeddedLyrics`: the startup repair (§8). |

**Changed modules:**

- `web/player/main.ts`: the new layout, home button, "Letra" pill and share
  dialog wiring, and recording the visit.
- `web/player/lyrics-view.ts`: dim, scale and graded blur states, intro dots,
  the 300 ms lead, no cascade.
- `web/player/styles.css`: rewritten for §4.
- `web/shared/base.css` and `web/shared/tokens.css`: Inter's optical-size
  build and the §4 tokens.
- `web/shared/background.ts`: the veil.
- `web/shared/icons.ts`: `house`, `whatsapp-logo`, `instagram-logo` and
  `x-logo`.
- `web/upload/main.ts`, `login.ts` and `styles.css`: the view switch, the
  sign-in dialog and the restyle.

**Removed:** `web/player/share.ts`.

**Dependencies:**

- `uqr` 0.1.3: MIT, no dependencies; QR matrix only.
- `jsqr` (dev only): Apache-2.0; used by the E2E test to decode the rendered QR
  code.

## 10. Copy (pt-BR)

| Where | Text |
|---|---|
| Home button label | Início |
| Share button label | Compartilhar |
| Lyrics pill | Letra |
| Dialog close | Fechar |
| Actions | WhatsApp · Stories · X · Copiar link · Mais… |
| QR accessible name | QR code do link da música |
| Toasts | Link copiado · Link copiado. Adicione o adesivo de link no Instagram. · Imagem salva. Poste nos Stories pelo celular. · Não deu para gerar a imagem. Tente de novo. · Histórico apagado |
| Home | Ouvidas recentemente · Limpar histórico · As músicas que você abrir por um link aparecem aqui. · Entrar |
| Sign-in dialog | Entrar (title and button) · Senha · Senha incorreta. |

## 11. Errors

| Situation | What the person sees |
|---|---|
| Card cover fails to load, or `toBlob` is null | Toast "Não deu para gerar a imagem. Tente de novo."; the dialog stays open |
| Share sheet dismissed | Nothing |
| Clipboard blocked | v1's toast with the link selected |
| No Web Share with files (desktop) | The card downloads |
| Summary request fails (offline) | The home keeps the stored list, with no message |
| A stored id was deleted | It disappears from the home after the summary request |
| Storage unavailable | The home shows the empty state; the player works |

## 12. Testing

**Unit and API (vitest):**

- **`recents`:** order; moving a repeat to the front; the 50 cap; malformed
  JSON; a throwing storage.
- **`share-links`:** encoding of accents, quotes, `&` and newlines.
- **`qr`:**
  - finder patterns at three corners;
  - no modules inside the center box;
  - a module count that matches the version for the URL length;
  - error correction H.
- **`wrapLines`:** breaks at spaces, the ellipsis on the last line, a long
  word broken only when alone.
- **Lyrics view:**
  - classes for active and dim verses;
  - intro dots only when the first verse is at 3 s or later, and active
    until then.
- **`GET /api/tracks/summary`:**
  - order and missing ids;
  - duplicates;
  - 0 or 51 ids gets 400; a malformed id gets 400;
  - works without a session;
  - the rate limit, keyed per client.

**E2E (Playwright, Chromium):** existing tests updated for the new
selectors, plus:

- **Player:** wide (1440×900) and phone (390×844) layouts. The cover, the
  lyrics column, the bottom bar and the top bar buttons are visible, with
  no horizontal scroll at 360 px.
- **Lyrics:** clicking a verse seeks; the intro dots show before the first
  verse of a fixture that starts at 3 s or later.
- **Share dialog:**
  - it opens and closes with Esc, and focus returns to the button;
  - WhatsApp and X hrefs are exact;
  - "Copiar link" shows the toast;
  - the QR, screenshotted and decoded with `jsqr`, equals the share URL;
  - on desktop Chromium, "Stories" downloads a 1080 × 1920 PNG.
- **Listener home:**
  - empty at first;
  - opening two tracks lists both, newest first;
  - deleting one as the owner removes it from the listener's home;
  - "Limpar histórico" empties the list.
- **Owner home:** sign in through the dialog; upload and the "Enviadas"
  actions still pass the v1 E2E.

**Docker smoke and CI:** unchanged (`app.yml`).

## 13. Risks

- **iOS share sheets and user activation.** Pre-building the card when the
  dialog opens keeps `navigator.share` inside the tap. If a device still
  refuses, the download fallback remains.
- **Instagram may be missing from the share sheet** on some devices
  (desktop, or Instagram not installed). The download path covers that.
- **QR legibility with the cover in the middle.** Error correction H and a
  22% center box are within what level H tolerates; the `jsqr` E2E guards
  regressions.
- **The font change on Apple devices.** Inter replaces SF Pro for everyone.
  Reverting is a one-line token change.
- **Listener history is per device.** Clearing site data loses it; this is
  by design (no accounts).
