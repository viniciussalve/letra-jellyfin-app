# letra: one navigation bar, and lighter motion

Date: 2026-11-11. Status: for the owner's review.

## 1. Why

Two things the owner reported on the live site after v3:

1. **Motion stutters and its curves do not feel smooth.** The owner suspects the blur.
2. **"Linhas salvas" sits in odd places.** It is reached in three different ways depending on the screen, and its page has only a house icon to leave. The owner wants navigation grouped, in one pattern across the whole application, with no hidden tabs: a tab is treated as a tab.

## 2. What success looks like

- From any screen, a listener sees the same bar in the same place, knows where they are, and reaches "Início" or "Linhas salvas" in one click.
- The home → player change, the cover view change and the lyrics following the song lose no frames on a mid-range phone and on the owner's computer, and the movement reads as one smooth gesture.
- The numbers before and after are in the pull request.

## 3. Navigation

### What is there today

| Screen | How "Linhas salvas" is reached | How to go back |
|---|---|---|
| Home (listener) | a "Ver todas" link inside the saved-lines section, only when there are saved lines | (it is the start) |
| Owner view | a "Linhas salvas" pill beside "Sair" | (it is the start) |
| `/salvas` | (it is the page) | a house icon |
| Player | no way | a house icon |

### The bar

One bar at the top of every screen: the listener home, `/salvas`, the owner view, the player and the player's "not found" page.

```
[ letra ]  [ Início ]  [ Linhas salvas ]                    [ this screen's actions ]
```

- **Left:** the wordmark "letra", then the two tabs. The wordmark is the page's brand, not a third way home: it is text, not a link.
- **Tabs:** "Início" (`/`) and "Linhas salvas" (`/salvas`). They are links inside a `nav` named "Principal". The tab of the screen in view has `aria-current="page"` and the selected look; on the player neither is selected, because a song is neither.
- **Right:** what belongs to the screen. Home and `/salvas`: "Entrar" for a listener, "Sair" for the signed-in owner. Player: translation, share and full screen, as today.
- **Same on every width.** At 360 px the bar keeps the wordmark, both tabs and the actions on one row; the tabs are 44 px tall targets. If a row can not hold them, the actions wrap under, never the tabs.
- **Cover view** (the player in full screen): the bar leaves with the rest of the controls, as the top bar does today.

### What goes away

- The house icon on the player and on `/salvas`.
- The "Linhas salvas" pill beside "Sair" in the owner view.
- The "Ver todas (n)" link as the way to the page. The saved-lines section on the home stays as content (the latest three lines); its heading stays, the link goes.
- The first-save toast's wording "Elas ficam em Início › Linhas salvas." becomes "Linha salva. Elas ficam em Linhas salvas.", since the tab is now on screen.

### Structure

- A shared module, `web/shared/nav.ts`, builds the bar: `navBar({ current: "home" | "saved" | null, actions: Node[] })`. Its styles live in `web/shared/` so both entries (upload and player) use the same rules.
- `/salvas` shows the account action too. It asks for the session the way the home does; until the answer arrives the space is reserved, so the bar does not jump.
- Keyboard: Tab order is wordmark (not focusable), "Início", "Linhas salvas", then the actions. The existing skip link on the player stays first.

## 4. Motion

### Measure first

A script records, in Chromium with 4× CPU slowdown and at device scale 2, three interactions and reports frames over 16.7 ms and the longest frame:

1. home → player (the page transition with the cover travelling);
2. player ↔ cover view;
3. the lyrics following the song across four verse changes.

It runs before any change and after each one, and the table goes in the pull request. A change that does not improve its number is not kept for the sake of it.

### Suspects, in the order they will be tried

1. **The background.** `.bg-field` is a layer 160% of the screen with `filter: blur(48px)` that also moves for 60 s on a loop. A blurred layer that moves is re-rasterised or kept as a very large texture. Replacement: the same four cover colours as soft radial gradients with no filter (the gradients are already smooth; the blur only softens them further), with the slow drift kept on `transform` alone. If the look loses too much, the fallback is a small pre-blurred canvas image scaled up, drawn once per song.
2. **The verses' blur.** Each verse out of focus has `filter: blur(…)`, and the filter changes on every verse change. It goes; distance is shown by opacity and scale, which the compositor animates for free. If the look loses too much, blur returns only on verses that are not changing.
3. **The page transition.** The root cross-fade paints both pages, each over its own background, for 200 ms while the cover travels for 400 ms. The root fade is shortened and the background is kept out of the snapshot pair (one shared, static background layer during the transition), so only the cover moves.
4. **The icon swap** blurs 2 px while it scales. The blur goes.

### Curves

- Movement (the cover, the page transition, the lyrics' follow): one curve, `cubic-bezier(.2, 0, 0, 1)` (a soft start and a long settle), replacing `--ease-in-out` for these. Fades and small state changes keep `--ease-out`.
- Durations stay as they are unless the measurements say a move is being cut short.
- `prefers-reduced-motion: reduce` keeps making every change immediate.

## 5. Out of scope

- New destinations or tabs.
- The translate menu, the row states and the saved-lines data.
- The questions left open from v3 (line or song for "already in this language"; the check icon).

## 6. Testing

- End to end: on each of the five screens the bar is present with both tabs in the same position (same left edge and top at 1440 and 390 wide); the right tab has `aria-current="page"` on home and `/salvas` and neither on the player; the removed controls are gone; one click from the player reaches `/salvas`; no horizontal scroll at 360 px; tabs are 44 px targets; the cover view hides the bar.
- Unit: the motion tokens test covers the new curve; no `filter: blur` remains on the background field, the verses or the icon swap unless a fallback was kept, in which case the test names it.
- The performance script's table before and after, in the pull request. It is a measurement, not a pass/fail test in CI: runner speed varies.

## 7. Not verifiable here

- How it feels on the owner's own devices, Safari and Firefox. The owner judges on the live site.
