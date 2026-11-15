# letra: share a piece of the lyrics as a card

Date: 2026-11-12. Status: for the owner's review. Built after the navigation and motion work (`2026-11-11-letra-navigation-and-motion-design.md`), because the player's share button sits in the new bar.

## 1. Why

The owner wants a listener to share a few lines of a song as an image: a solid-colour card with the cover, the title, the artist and the lines in large type, like the cards music apps make. No brand on it, not even letra's. The card can be copied, recoloured, downloaded and shared.

## 2. What success looks like

- From the player, a listener picks a run of lines and has a finished card in three or four taps.
- The card reads well at phone size: large heavy type, strong contrast, nothing cut off.
- The image carries no logo, wordmark or address.

## 3. The flow

### Entry

The player's share button opens a small menu with two rows: "Link da música" (today's share dialog, unchanged) and "Trecho da letra". The menu uses the shared menu behaviour (`web/shared/menu.ts`). "Trecho da letra" is absent when the song has no lyrics or is marked instrumental.

### Selection mode

"Trecho da letra" turns selection mode on.

- The song keeps playing and the lyrics keep following it, but a tap, a click or Enter on a verse selects instead of seeking. The save icons are hidden while the mode is on.
- **The selection is always one run of neighbouring verses, in the song's order.** There is no way to pick loose lines.
  - The first verse picked starts the run.
  - A verse outside the run extends the run to it, taking every verse in between.
  - The first or the last verse of the run, picked again, leaves the run.
  - A verse in the middle of the run, picked again, becomes the run's last verse.
- Blank lines between verses do not count and are not drawn.
- A bar fixed at the bottom shows the count and two buttons:
  - "Nenhuma linha selecionada", "1 linha selecionada", "{n} linhas selecionadas";
  - "Cancelar" leaves the mode with nothing changed;
  - "Criar card" opens the card. It is disabled with no selection and when the run does not fit (below).
- **The limit is what fits on the card:** at most 8 lines of text after wrapping at the card's type size. Past it the bar says "O trecho não cabe no card. Escolha menos linhas." and "Criar card" is disabled; the selection is not cut for the listener.
- Esc leaves the mode. So does leaving the page. The mode is not kept across reloads.
- Screen readers: each verse is a toggle with `aria-pressed`; the bar's count is a polite live region.
- With the translation on, the verses show both texts as today; the card uses the translated lines (section 4).

### The card dialog

"Criar card" opens a dialog titled "Trecho da letra" with a preview of the card (the real image, scaled to fit) and four actions under it, each an icon with its name:

| Action | What it does |
|---|---|
| Copiar | Copies the image to the clipboard. Where the browser can not copy images, copies the text: the lines, then a line with `Título — Artista`. A toast says which: "Imagem copiada" or "Texto copiado". |
| Trocar cor | Moves to the next colour of the palette and redraws the preview. The button's name says the colour's position: "Trocar cor (2 de 6)". |
| Baixar | Saves a PNG named `<título> - trecho.png`. |
| Compartilhar | Opens the device's share sheet with the image. Absent where the browser can not share files. |

Closing the dialog returns to selection mode with the run still picked, so the listener can adjust and try again; "Cancelar" there ends the mode.

## 4. The card

- **Size:** 1080 × 1350 px (4:5), PNG.
- **Layout**, on a 1080 grid with 96 px margins:
  - top: the cover at 144 px with a 16 px radius; beside it the title (heavy) and the artist (regular), each on one line, cut with "…" when too long. With no cover, the title and artist start at the margin.
  - the lines: heavy, left aligned, starting 120 px under the header. The type size is 64 px with a 84 px line height; a run that needs more than 8 lines at that size does not fit (the selection bar already said so).
  - nothing else: no logo, no wordmark, no address, no QR code.
- **Colour:** the card is one solid colour. The palette has six: the song's four cover colours (the `mesh` palette the app already computes), a light neutral `#F2F0EB` and a dark neutral `#1C1C1E`. It starts on the first cover colour. Text is black `#111111` or white `#FFFFFF`, whichever has the higher contrast with the colour; a cover colour whose best contrast is under 4.5 : 1 is darkened or lightened in steps until it reaches it.
- **Text:** the selected verses in order, each verse wrapped at word boundaries. With the translation on in the player and loaded, the translated lines are used; otherwise the lyrics as they are. Text is drawn as text on a canvas: nothing from the lyrics is ever inserted as HTML.
- **Font:** the app's own (Inter), loaded before drawing.

## 5. Structure

- `web/player/lyric-card.ts`: pure layout (wrapping, the 8-line rule, colours and contrast) and drawing on a canvas, shaped like the existing `story-card.ts`. No DOM outside the canvas functions, so the layout is unit-tested in node.
- `web/player/lyric-select.ts`: selection mode (the run's rules, the bar).
- `web/player/lyric-card-dialog.ts`: the dialog and its four actions.
- `web/player/lyrics-view.ts`: a way to switch a verse's activation between "seek" and "select", and to mark verses as selected.
- `web/player/main.ts`, `share-dialog.ts`: the share button's menu.
- Reused: the palette from the page data, `toast`, `copyText`, the file-sharing check of the story card.

## 6. Errors

- The image can not be made (canvas blocked or out of memory): the dialog shows "Não foi possível criar o card neste navegador." and offers only "Copiar" (the text).
- The cover can not be loaded: the card is drawn without it.
- The share sheet is dismissed: nothing happens. It fails for another reason: a toast, "Não foi possível compartilhar."
- A download or copy the browser refuses: a toast, "Não foi possível copiar." / "Não foi possível baixar."

## 7. Testing

- Unit: wrapping and the 8-line rule (long words, a single very long verse, exactly 8, 9); the run's rules (extend across a gap, remove an end, a middle verse becomes the end, blank lines skipped); text colour choice and the contrast floor for each palette colour; the header's cut with "…".
- End to end: the share menu's two rows; selection by pointer and by keyboard; no loose lines possible; the count and the "does not fit" state; Esc and "Cancelar"; the dialog's preview is a 1080 × 1350 image; "Trocar cor" changes the image and walks six colours; "Baixar" downloads a PNG with the expected name; "Copiar" falls back to text when image copy is refused; "Compartilhar" is absent without file sharing and calls the share sheet with a PNG where it exists; with the translation on, the card's text is the translation; the image has no text other than the title, the artist and the lines (checked through the layout, not by reading pixels).
- Screenshots for the owner before the merge: the card for three songs in three colours, the selection mode and the dialog at 1440 and 390 wide.

## 8. Out of scope

- Editing the text, fonts or alignment on the card.
- Other sizes (the 9:16 story card stays as it is, with the song's link).
- Sharing from `/salvas`.
