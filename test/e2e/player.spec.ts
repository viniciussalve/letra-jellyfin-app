import type { APIRequestContext, Page } from "@playwright/test";
import type { TrackDTO } from "../../shared/types.ts";
import { expect, noFullscreenApi, test, upload, uploadFixture } from "./helpers.ts";

const verse = (page: Page, i: number) => page.locator(`[data-verse][data-index="${i}"]`);

const audioState = (page: Page) =>
  page.evaluate(() => {
    const a = document.querySelector("audio")!;
    return { t: a.currentTime, paused: a.paused };
  });

const setTime = (page: Page, seconds: number) =>
  page.evaluate((s) => {
    document.querySelector("audio")!.currentTime = s;
  }, seconds);

/** Waits until the audio element knows its duration (preload="metadata"). */
async function ready(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.querySelector("audio")?.readyState ?? 0)).toBeGreaterThan(0);
}

async function open(page: Page, request: APIRequestContext, name = "song.mp3", asName?: string): Promise<TrackDTO> {
  const track = await uploadFixture(request, name, asName);
  await page.goto(track.shareUrl);
  return track;
}

async function box(page: Page, selector: string) {
  const b = await page.locator(selector).boundingBox();
  if (!b) throw new Error(`${selector} has no box`);
  return b;
}

const middle = (b: { y: number; height: number }) => b.y + b.height / 2;

test("wide layout: cover left, lyrics beside it, bottom bar", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, request);
  await expect(verse(page, 0)).toBeVisible();

  const cover = await box(page, "[data-cover]");
  expect(Math.abs(cover.width - cover.height)).toBeLessThan(1);
  expect(cover.width).toBeLessThanOrEqual(426);

  const lyrics = await box(page, "section.lyrics");
  expect(lyrics.x).toBeGreaterThan(cover.x + cover.width);
  expect(lyrics.width).toBeLessThanOrEqual(520);
  // The group (cover + gap + lyrics column) is centered, with at least a 72 px margin.
  expect(cover.x).toBeGreaterThanOrEqual(72);
  expect(1440 - (lyrics.x + lyrics.width)).toBeGreaterThanOrEqual(72);

  // The navigation bar is the 64 px top row: 16 px above the tabs, 44 px of row, 4 px under it.
  const top = await box(page, "header.nav-bar[data-nav]");
  expect(top).toMatchObject({ y: 0, height: 64 });
  const bar = await box(page, "footer.bottom-bar");
  expect(bar.height).toBe(96);
  expect(bar.y + bar.height).toBe(900);
  // The cover sits centered between the bars.
  expect(Math.abs(middle(cover) - (top.height + bar.y) / 2)).toBeLessThan(2);

  // The bar: the tabs on the left, the player's actions on the right; the bottom bar holds title, transport and volume.
  for (const selector of ['a[data-tab="home"]', 'a[data-tab="saved"]', ".nav-actions [data-translate]", ".nav-actions [data-share]", ".nav-actions [data-fullscreen]"]) {
    await expect(page.locator(`header[data-nav] ${selector}`)).toBeVisible();
  }
  for (const selector of [".now .title", ".transport-area [data-play]", ".progress-row [data-progress]", ".volume"]) {
    await expect(page.locator(`footer.bottom-bar ${selector}`)).toBeVisible();
  }
  // The transport sits above the progress bar, which has the elapsed time on its left.
  const play = await box(page, "[data-play]");
  const progress = await box(page, "[data-progress]");
  const elapsed = await box(page, "[data-elapsed]");
  const remaining = await box(page, "[data-remaining]");
  expect(middle(play)).toBeLessThan(middle(progress));
  expect(elapsed.x + elapsed.width).toBeLessThanOrEqual(progress.x);
  expect(remaining.x).toBeGreaterThanOrEqual(progress.x + progress.width);
});

for (const [width, height] of [[1440, 900], [1920, 1080], [1024, 768]]) {
  test(`wide layout: the cover + lyrics group is centered at ${width}x${height}`, async ({ page, request }) => {
    await page.setViewportSize({ width, height });
    await open(page, request);
    await expect(verse(page, 0)).toBeVisible();
    const groupCenter = async () => {
      const cover = await box(page, "[data-cover]");
      const lyrics = await box(page, "section.lyrics");
      return (cover.x + lyrics.x + lyrics.width) / 2;
    };
    await expect.poll(async () => Math.abs((await groupCenter()) - width / 2)).toBeLessThanOrEqual(2); // the cover's left transition
    const cover = await box(page, "[data-cover]");
    const lyrics = await box(page, "section.lyrics");
    expect(cover.x).toBeGreaterThanOrEqual(72);
    expect(width - (lyrics.x + lyrics.width)).toBeGreaterThanOrEqual(72);
    // The verses still start 72 px after the cover, left-aligned in their column.
    const text = await verse(page, 0).locator(".verse-text").boundingBox();
    expect(Math.abs(text!.x - (cover.x + cover.width + 72))).toBeLessThanOrEqual(2);
  });
}

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

test("resizing: the column stays glued to the cover, with no slide", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, request);
  await expect(verse(page, 0)).toBeVisible();
  await expect.poll(async () => (await box(page, "[data-cover]")).x).toBeCloseTo(219, 0);
  await page.setViewportSize({ width: 1150, height: 900 });
  const now = await page.evaluate(
    () =>
      new Promise<{ gap: number; running: number }>((resolve) =>
        requestAnimationFrame(() => {
          const cover = document.querySelector("[data-cover]")!;
          const column = document.querySelector("section.lyrics")!;
          resolve({
            gap: column.getBoundingClientRect().left - cover.getBoundingClientRect().right,
            running: cover.getAnimations().length + column.getAnimations().length,
          });
        }),
      ),
  );
  expect(Math.abs(now.gap - 56)).toBeLessThanOrEqual(1);
  expect(now.running).toBe(0);
});

test("phone layout", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, request);
  await expect(verse(page, 0)).toBeVisible();

  // The bar on top: the tabs, then translation, share and full screen on the right.
  const tab = await box(page, '[data-nav] a[data-tab="home"]');
  const actions = ["[data-translate]", "[data-share]", "[data-fullscreen]"];
  for (const selector of actions) await expect(page.locator(`header[data-nav] .nav-actions ${selector}`)).toBeVisible();
  const fullscreen = await box(page, "[data-fullscreen]");
  expect(tab.y).toBe(16);
  expect(fullscreen.x + fullscreen.width).toBeLessThanOrEqual(390 - 20 + 0.5);
  // Under it, one header row: a 48 px cover, then title and artist.
  const bar = await box(page, "header[data-nav]");
  const cover = await box(page, "[data-cover]");
  const title = await box(page, ".now .title");
  expect(cover).toMatchObject({ width: 48, height: 48 });
  expect(cover.y).toBeGreaterThanOrEqual(bar.y + bar.height);
  expect(cover.y).toBeLessThan(140);
  expect(Math.abs(middle(title) - middle(cover))).toBeLessThan(16);
  expect(title.x).toBeGreaterThanOrEqual(cover.x + cover.width);

  // The progress bar sits above the transport.
  const progress = await box(page, "[data-progress]");
  const play = await box(page, "[data-play]");
  expect(middle(progress)).toBeLessThan(play.y);
  // The transport is the last row: no row of pills under it any more.
  await expect(page.locator(".bottom-row")).toHaveCount(0);
  expect(play.y + play.height).toBeGreaterThan(844 - 16 - 80);
});

test("no horizontal scroll at 360 px with a 200-character title", async ({ page, request }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const track = await upload(request, "T".repeat(200));
  await page.goto(track.shareUrl);
  await expect(verse(page, 0)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await expect(page.locator(".now .title")).toHaveCSS("text-overflow", "ellipsis");
  const share = await box(page, "[data-share]");
  expect(share.x + share.width).toBeLessThanOrEqual(360);
});

test("page background is veiled", async ({ page, request }) => {
  await open(page, request);
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(0, 0, 0)");
  const veil = await page.evaluate(() => {
    const layer = getComputedStyle(document.querySelector(".bg")!, "::after");
    return { color: layer.backgroundColor, position: layer.position, inset: layer.inset };
  });
  expect(veil).toEqual({ color: "rgba(0, 0, 0, 0.55)", position: "absolute", inset: "0px" });
});

/** The selectors sorted by their elements' position in the document. */
const domOrder = (page: Page, selectors: string[]) =>
  page.evaluate(
    (list) =>
      list
        .map((selector) => ({ selector, node: document.querySelector(selector)! }))
        .sort((a, b) => (a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
        .map((x) => x.selector),
    selectors,
  );

test("focus order follows the visual order on phones", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, request);
  await expect(verse(page, 0)).toBeVisible();
  // The bar (tabs, then its actions), then the controls as drawn: progress, then the transport.
  const visual = [
    '[data-tab="home"]', '[data-tab="saved"]', "[data-translate]", "[data-share]", "[data-fullscreen]",
    "[data-progress]", "[data-back]", "[data-play]", "[data-forward]",
  ];
  expect(await domOrder(page, visual)).toEqual(visual);
  for (const selector of ["[data-translate]", "[data-language]", "[data-fullscreen]"]) {
    await expect(page.locator(`header[data-nav] .nav-actions ${selector}`)).toHaveCount(1);
  }
  // The verses come between the header and the controls.
  const withVerse = ["[data-fullscreen]", "[data-verse]", "[data-progress]"];
  expect(await domOrder(page, withVerse)).toEqual(withVerse);
});

test("focus order on wide screens", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, request);
  await expect(verse(page, 0)).toBeVisible();
  const visual = [
    '[data-tab="home"]', '[data-tab="saved"]', "[data-translate]", "[data-share]", "[data-fullscreen]",
    "[data-back]", "[data-play]", "[data-forward]", "[data-progress]",
  ];
  expect(await domOrder(page, visual)).toEqual(visual);
  for (const selector of ["[data-translate]", "[data-share]", "[data-fullscreen]"]) {
    await expect(page.locator(`header[data-nav] .nav-actions ${selector}`)).toHaveCount(1);
  }
});

test("resizing across 1024 px reorders without losing focus", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, request);
  await ready(page);
  await expect(verse(page, 0)).toBeVisible();
  // Stacking moves the progress row (layout-order.ts): a focused progress bar keeps focus.
  const progress = page.locator("[data-progress]");
  await progress.focus();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("[data-cover] + .now")).toHaveCount(1);
  const phone = ["[data-progress]", "[data-play]"];
  expect(await domOrder(page, phone)).toEqual(phone);
  await expect(progress).toBeFocused();

  // Going wide moves the transport back before it: a focused play button keeps focus.
  const play = page.locator("[data-play]");
  await play.focus();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator("footer.bottom-bar > .now:first-child")).toHaveCount(1);
  const wide = ["[data-play]", "[data-progress]"];
  expect(await domOrder(page, wide)).toEqual(wide);
  await expect(play).toBeFocused();

  // The moved nodes keep their listeners.
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await audioState(page)).paused).toBe(false);
});

/** Presses Tab up to `max` times; returns the press that put focus on `selector`, or null. */
async function tabsUntil(page: Page, selector: string, max: number): Promise<number | null> {
  const target = page.locator(selector);
  for (let n = 1; n <= max; n++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((node) => node === document.activeElement)) return n;
  }
  return null;
}

const tabStops = (page: Page) => page.locator("button.verse[tabindex='0']");

test("phones: the title is read after the bar and before the lyrics, and the lyrics cost one Tab stop", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, request);
  await expect(verse(page, 0)).toBeVisible();
  await expect(page.locator("footer.bottom-bar .now")).toHaveCount(0);
  const order = ["header[data-nav]", ".now", "[data-verse]"];
  expect(await domOrder(page, order)).toEqual(order);
  await expect(page.getByRole("region", { name: "Letra" })).toHaveCount(1);
  // Full screen is the bar's last control, before the lyrics: the same budget as from share before.
  await page.locator("[data-fullscreen]").focus();
  expect(await tabsUntil(page, "[data-progress]", 3)).not.toBeNull();
});

test("wide: from share, Tab reaches the transport within 4 presses", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, request);
  await expect(verse(page, 0)).toBeVisible();
  await page.locator("[data-share]").focus();
  expect(await tabsUntil(page, "[data-back]", 4)).not.toBeNull();
});

test("the verses are one Tab stop: arrows move between them and Enter seeks", async ({ page, request }) => {
  await open(page, request);
  await ready(page);
  // Before any verse is active the first verse is the stop; then the active one.
  await expect(tabStops(page)).toHaveCount(1);
  await expect(verse(page, 0)).toHaveAttribute("tabindex", "0");
  await setTime(page, 4.6);
  await expect(verse(page, 2)).toHaveAttribute("data-state", "active");
  await expect(verse(page, 2)).toHaveAttribute("tabindex", "0");
  await expect(tabStops(page)).toHaveCount(1);

  // ↓/↑ move focus between verses; the page's shortcuts and the column's scroll never see them.
  await page.evaluate(() => {
    const w = window as unknown as { __arrows: boolean[] };
    w.__arrows = [];
    window.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") w.__arrows.push(e.defaultPrevented);
    });
  });
  await verse(page, 2).focus();
  await page.keyboard.press("ArrowDown");
  await expect(verse(page, 3)).toBeFocused();
  await expect(verse(page, 3)).toHaveAttribute("tabindex", "0");
  await expect(tabStops(page)).toHaveCount(1);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(verse(page, 1)).toBeFocused();
  expect(await page.evaluate(() => (window as unknown as { __arrows: boolean[] }).__arrows)).toEqual([true, true, true]);
  expect((await audioState(page)).t).toBeCloseTo(4.6, 1);

  // A playing song never takes focus from the verse the reader is on.
  await setTime(page, 6.6);
  await expect(verse(page, 3)).toHaveAttribute("data-state", "active");
  await expect(verse(page, 1)).toBeFocused();
  await expect(verse(page, 1)).toHaveAttribute("tabindex", "0");
  await expect(tabStops(page)).toHaveCount(1);

  // Enter seeks to the focused verse.
  await page.keyboard.press("Enter");
  await expect(verse(page, 1)).toHaveAttribute("data-state", "active");
  const { t } = await audioState(page);
  expect(t).toBeGreaterThan(2.2);
  expect(t).toBeLessThan(4.5); // verse 1 runs 2.5 s to 4.5 s, and playback has started

  // Once focus leaves the list, the stop goes back to the active verse.
  await setTime(page, 6.6);
  await expect(verse(page, 3)).toHaveAttribute("data-state", "active");
  await page.locator("[data-share]").focus();
  await expect(verse(page, 3)).toHaveAttribute("tabindex", "0");
  await expect(tabStops(page)).toHaveCount(1);
});

test("the arrows skip break rows", async ({ page, request }) => {
  const track = await uploadFixture(request, "song.mp3");
  const text = ["[00:00.50]Antes da pausa", "[00:02.00]", "[00:03.00]Depois da pausa"].join("\n");
  const res = await request.put(`/api/tracks/${track.id}/lyrics`, { data: { text } });
  expect(res.ok()).toBe(true);
  await page.goto(track.shareUrl);
  await expect(verse(page, 1)).toHaveClass(/is-break/);
  await verse(page, 0).focus();
  await page.keyboard.press("ArrowDown");
  await expect(verse(page, 2)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(verse(page, 0)).toBeFocused();
  await expect(tabStops(page)).toHaveCount(1);
});

test("opens with cover, title and lyrics; the play button starts playback", async ({ page, request }) => {
  await open(page, request);
  await expect(page.getByRole("heading", { level: 1, name: "Linha de Teste" })).toBeVisible();
  await expect(page.getByText("Letra Fixtures", { exact: true })).toBeVisible();
  const cover = page.locator("[data-cover] img");
  await expect(cover).toBeVisible();
  await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('[data-lyrics-state="synced"] [data-verse]')).toHaveCount(4);
  await expect(verse(page, 0)).toHaveText("Primeiro verso da música");

  await page.locator("[data-play]").click();
  await expect.poll(async () => (await audioState(page)).paused).toBe(false);
  await expect(page.locator("[data-play]")).toHaveAttribute("aria-label", "Pausar");
});

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

test("background takes the cover palette", async ({ page, request }) => {
  const track = await open(page, request);
  const mesh = await page.evaluate(() =>
    [1, 2, 3, 4].map((i) => getComputedStyle(document.documentElement).getPropertyValue(`--mesh-${i}`).trim().toUpperCase()),
  );
  // Client extracts the cover's #2F3E57 / #738488 palette, replacing the server's deterministic fallback.
  expect(mesh).not.toEqual(track.palette.mesh.map((c) => c.toUpperCase()));
  expect(mesh).toEqual(["#2F3C56", "#69797D", "#3B495F", "#62727B"]);
});

test("active verse follows time and wipes", async ({ page, request }) => {
  await open(page, request);
  await ready(page);
  await setTime(page, 4.6);
  await expect(verse(page, 2)).toHaveAttribute("data-state", "active");
  await expect(verse(page, 1)).toHaveAttribute("data-state", "past");
  await expect(verse(page, 3)).toHaveAttribute("data-state", "future");

  const p = await verse(page, 2).locator("span").first().evaluate((s) => s.style.getPropertyValue("--p"));
  expect(p).toMatch(/%$/);
  expect(parseFloat(p)).toBeGreaterThan(0);
  expect(parseFloat(p)).toBeLessThan(100);

  // The active verse's first line settles 30% down the lyrics column.
  const position = () =>
    page.evaluate(() => {
      const column = document.querySelector("[data-lyrics-state]")!.getBoundingClientRect();
      const active = document.querySelector<HTMLElement>('[data-verse][data-state="active"]')!;
      const top = active.getBoundingClientRect().top + parseFloat(getComputedStyle(active).paddingTop);
      return Math.round(((top - column.top) / column.height) * 100);
    });
  await expect.poll(position).toBe(30);
});

test("tap a verse to seek", async ({ page, request }) => {
  await open(page, request);
  await ready(page);
  await verse(page, 3).click();
  const { t } = await audioState(page);
  expect(t).toBeGreaterThan(6.2);
  expect(t).toBeLessThan(6.8);
  await expect(verse(page, 3)).toHaveAttribute("data-state", "active");
});

test("times show elapsed and remaining with U+2212", async ({ page, request }) => {
  await open(page, request);
  await ready(page);
  await expect(page.locator("[data-elapsed]")).toHaveText("0:00");
  await expect(page.locator("[data-remaining]")).toHaveText(/^−\d+:\d\d$/);
  await setTime(page, 3.2);
  await expect(page.locator("[data-elapsed]")).toHaveText("0:03");
  const fontVariant = await page.locator("[data-elapsed]").evaluate((e) => getComputedStyle(e).fontVariantNumeric);
  expect(fontVariant).toContain("tabular-nums");
});

test("manual scroll shows 'Voltar ao verso atual'", async ({ page, request }) => {
  await open(page, request);
  const back = page.locator("[data-back-to-current]");
  await expect(back).toBeHidden();
  await verse(page, 0).hover();
  await page.mouse.wheel(0, 300);
  await expect(back).toBeVisible();
  await expect(back).toHaveText("Voltar ao verso atual");
  await back.click();
  await expect(back).toBeHidden();
  await expect.poll(() => page.locator("[data-lyrics-scroll]").evaluate((e) => e.scrollTop)).toBe(0);
});

test("phone viewport has no horizontal scroll", async ({ page, request }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await open(page, request);
  await expect(page.locator("[data-verse]")).toHaveCount(4);
  await expect(page.locator("[data-play]")).toBeInViewport();
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow).toEqual({ doc: 0, body: 0 });
});

test("reduced motion: no wipe gradient, active verse fully white", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, request);
  await ready(page);
  await setTime(page, 4.6);
  await expect(verse(page, 2)).toHaveAttribute("data-state", "active");
  const style = await verse(page, 2)
    .locator("span")
    .first()
    .evaluate((s) => ({ bg: getComputedStyle(s).backgroundImage, color: getComputedStyle(s).color, p: s.style.getPropertyValue("--p") }));
  expect(style).toEqual({ bg: "none", color: "rgb(255, 255, 255)", p: "" });
});

test("unknown link shows the 404 copy", async ({ page }) => {
  const res = await page.goto("/t/naoexiste1");
  expect(res?.status()).toBe(404);
  await expect(page.getByText("Esse link não existe ou a música foi apagada.")).toBeVisible();
  await expect(page.locator("audio")).toHaveCount(0);
  // The bar's "Início" tab, as on the player, leads back to the home.
  await expect(page.locator("[data-home]")).toHaveCount(0);
  const home = page.locator('header[data-nav] a[data-tab="home"]');
  await expect(home).toBeVisible();
  await expect(home).toHaveAccessibleName("Início");
  await home.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("[data-home-view]")).toBeVisible();
});

test("keyboard: Space toggles, ArrowRight seeks +5 s, L does nothing", async ({ page, request }) => {
  await open(page, request);
  await ready(page);
  await page.keyboard.press("Space");
  await expect.poll(async () => (await audioState(page)).paused).toBe(false);
  await page.keyboard.press("Space");
  await expect.poll(async () => (await audioState(page)).paused).toBe(true);

  const { t } = await audioState(page);
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await audioState(page)).t).toBeCloseTo(t + 5, 1);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => (await audioState(page)).t).toBeCloseTo(t, 1);

  await page.keyboard.press("l");
  await expect(page.locator(".player")).toHaveAttribute("data-lyrics", "on");
  await expect(page.locator("[data-lyrics-state]")).toBeVisible();
});

test("Media Session metadata after play", async ({ page, request }) => {
  const track = await open(page, request);
  await page.locator("[data-play]").click();
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.metadata?.title)).toBe("Linha de Teste");
  const meta = await page.evaluate(() => {
    const m = navigator.mediaSession.metadata!;
    return { artist: m.artist, album: m.album, artwork: m.artwork.map((a) => a.src) };
  });
  expect(meta).toEqual({
    artist: "Letra Fixtures",
    album: "Fixtures",
    artwork: [new URL(`/media/${track.id}/cover.jpg`, track.shareUrl).href],
  });
});

test("plain lyrics -> unsynced state", async ({ page, request }) => {
  const track = await uploadFixture(request, "song.mp3");
  const res = await request.put(`/api/tracks/${track.id}/lyrics`, { data: { text: "Primeira linha\nSegunda linha" } });
  expect(res.ok()).toBe(true);
  await page.goto(track.shareUrl);
  await expect(page.locator('[data-lyrics-state="unsynced"]')).toBeVisible();
  await expect(page.getByText("Letra sem sincronia")).toBeVisible();
  await expect(page.locator("[data-verse]")).toHaveCount(2);
  await ready(page);
  await verse(page, 0).click();
  expect(await audioState(page)).toEqual({ t: 0, paused: true });
  await expect(page.locator("[data-back-to-current]")).toBeHidden();
});

test("instrumental and missing lyrics states", async ({ page, request }) => {
  const instrumental = await open(page, request, "Letra Fixtures - Sem Tags.mp3", "Letra Fixtures - Instrumental Teste.mp3");
  expect(instrumental.lyrics?.instrumental).toBe(true);
  await expect(page.locator('[data-lyrics-state="none"]')).toBeVisible();

  await open(page, request, "Letra Fixtures - Sem Tags.mp3", "Letra Fixtures - Sem Letra.mp3");
  await expect(page.locator('[data-lyrics-state="none"]')).toContainText("A letra desta música não foi encontrada.");
  await expect(page.locator("[data-verse]")).toHaveCount(0);
  await ready(page);
  await page.locator("[data-play]").click();
  await expect.poll(async () => (await audioState(page)).paused).toBe(false);
});

test("untagged file gets synced lyrics from the LRCLIB stub", async ({ page, request }) => {
  const track = await open(page, request, "Letra Fixtures - Sem Tags.mp3");
  expect(track).toMatchObject({ title: "Sem Tags", artist: "Letra Fixtures", lyricsSource: "lrclib", hasCover: false });
  await expect(page.locator('[data-lyrics-state="synced"] [data-verse]')).toHaveCount(3);
  await expect(page.locator("[data-cover] svg")).toBeVisible();
});

test("audio error message", async ({ page, request }) => {
  const track = await uploadFixture(request, "song.mp3");
  await page.route(`**/media/${track.id}/audio`, (route) => route.fulfill({ status: 404, body: "" }));
  await page.goto(track.shareUrl);
  await expect(page.getByText("Não foi possível tocar este arquivo neste navegador.")).toBeVisible();
});

test("HTML in title renders as text", async ({ page, request }) => {
  const track = await upload(request, "<b>x</b>");
  await page.goto(track.shareUrl);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("<b>x</b>");
  await expect(page.locator("main b")).toHaveCount(0);
});

test("shortcuts keep working after using a slider", async ({ page, request }) => {
  await noFullscreenApi(page);
  await open(page, request);
  await ready(page);
  const progress = page.locator("[data-progress]");
  await progress.click();
  await expect(progress).toBeFocused();
  await page.keyboard.press("Space");
  await expect.poll(async () => (await audioState(page)).paused).toBe(false);
  await page.keyboard.press("Space");
  await expect.poll(async () => (await audioState(page)).paused).toBe(true);
  await page.keyboard.press("f");
  await expect(page.locator(".player")).toHaveAttribute("data-lyrics", "off");
  await page.keyboard.press("f");
  await expect(page.locator(".player")).toHaveAttribute("data-lyrics", "on");

  const volume = page.getByRole("slider", { name: "Volume" });
  await volume.click();
  await expect(volume).toBeFocused();
  await page.keyboard.press("Space");
  await expect.poll(async () => (await audioState(page)).paused).toBe(false);
});

test("progress slider has a 44 px hit target on phones", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, request);
  const box = (await page.locator("[data-progress]").boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  // The visible bar stays thin: --bar-height (spec v2 §4 Tokens).
  const bar = await page.locator("[data-progress]").evaluate((e) => getComputedStyle(e).getPropertyValue("--bar").trim());
  expect(bar).toBe("4px");
});

test("lyrics language is set on the verses only", async ({ page, request }) => {
  const track = await uploadFixture(request, "song.mp3");
  // The fake engine reports English as the source language; the first translation stores it.
  const res = await request.get(`/api/tracks/${track.id}/translation?lang=pt-BR`);
  expect(res.ok()).toBe(true);
  await page.goto(track.shareUrl);
  await expect(page.locator("[data-verse]").first()).toBeVisible();
  const langOf = (selector: string) =>
    page.locator(selector).first().evaluate((e) => e.closest("[lang]")?.getAttribute("lang") ?? null);
  expect(await langOf("[data-verse]")).toBe("en");
  expect(await langOf("[data-back-to-current]")).toBe("pt-BR");
  expect(await langOf("[data-lyrics-state]")).toBe("pt-BR");
});

test("stacked layout keeps its sides clear of the notch in landscape", async ({ page, request }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  // Chromium can fake the safe-area insets of a phone held sideways.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { left: 47, right: 47, bottom: 21 } });
  await open(page, request);
  await expect(verse(page, 0)).toBeVisible();
  // The rows are one grid on .player, whose padding sets the sides; the lyrics run edge to edge.
  for (const selector of [".player", "[data-lyrics-scroll]"]) {
    await expect(page.locator(selector)).toHaveCSS("padding-left", "47px");
    await expect(page.locator(selector)).toHaveCSS("padding-right", "47px");
  }
  // Without insets the sides fall back to the layout's own 32 px.
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: {} });
  await expect(page.locator(".player")).toHaveCSS("padding-left", "32px");
});

const INTRO_FILE = "Letra Fixtures - Intro Longa.mp3";

test("intro dots before the first verse", async ({ page, request }) => {
  await open(page, request, "Letra Fixtures - Sem Tags.mp3", INTRO_FILE);
  const intro = page.locator("[data-intro]");
  await expect(intro).toBeVisible();
  await expect(intro).toHaveAttribute("data-state", "active");
  await expect(intro).toHaveAttribute("aria-hidden", "true");
  await expect(intro.locator("i.dot")).toHaveCount(3);
  await expect(verse(page, 0)).toHaveAttribute("data-state", "future");
});

test("the intro hands over to the first verse", async ({ page, request }) => {
  await open(page, request, "Letra Fixtures - Sem Tags.mp3", INTRO_FILE);
  await ready(page);
  await setTime(page, 1.5);
  await expect(page.locator("[data-intro]")).toHaveAttribute("data-state", "active");
  await expect(verse(page, 0)).toHaveAttribute("data-state", "future");
  await setTime(page, 4.5);
  await expect(page.locator("[data-intro]")).toHaveAttribute("data-state", "past");
  await expect(verse(page, 0)).toHaveAttribute("data-state", "active");
  // The past intro row blurs like a verse right above the active one.
  await expect.poll(() => page.locator("[data-intro]").evaluate((e) => getComputedStyle(e).filter)).toBe("blur(1px)");
});

test("the intro row is sharp while it is active", async ({ page, request }) => {
  await open(page, request, "Letra Fixtures - Sem Tags.mp3", INTRO_FILE);
  await expect(page.locator("[data-intro]")).toHaveAttribute("data-state", "active");
  expect(await page.locator("[data-intro]").evaluate((e) => getComputedStyle(e).filter)).toBe("none");
  await expect.poll(() => filterOf(page, 0)).toBe("blur(1px)");
});

test("during the scroll jump the previously active verse's translate does not transition, but its fades do", async ({ page, request }) => {
  await open(page, request);
  await ready(page);
  await setTime(page, 0.6);
  await expect(verse(page, 0)).toHaveAttribute("data-state", "active");
  // The FLIP offsets rows instantly (.is-jumping); the active verse used to win that cascade.
  // Only translate is dropped, so opacity and transform keep running (and their timing).
  const t = await page.evaluate(() => {
    const list = document.querySelector(".lyrics-list")!;
    const read = () => {
      const cs = getComputedStyle(document.querySelector('[data-verse][data-state="active"]')!);
      return { props: cs.transitionProperty, durations: cs.transitionDuration };
    };
    const before = read();
    list.classList.add("is-jumping");
    const during = read();
    list.classList.remove("is-jumping");
    return { before, during };
  });
  expect(t.during.props.split(",").map((x) => x.trim())).toEqual(["opacity", "transform"]);
  expect(t.during.durations.split(",").map((x) => parseFloat(x))[0]).toBeGreaterThan(0);
  expect(t.during.durations.split(",")[0]).toBe(t.before.durations.split(",")[0]);
});

test("the active verse leads the audio clock by 300 ms (lines at 0.5, 3.0, 5.5 s)", async ({ page, request }) => {
  await open(page, request, "Letra Fixtures - Sem Tags.mp3");
  await ready(page);
  await setTime(page, 2.65);
  await expect(verse(page, 0)).toHaveAttribute("data-state", "active");
  await expect(verse(page, 1)).not.toHaveAttribute("data-state", "active");
  await setTime(page, 2.75);
  await expect(verse(page, 1)).toHaveAttribute("data-state", "active");
  await expect(verse(page, 0)).toHaveAttribute("data-state", "past");
  // The wipe stays on real time: nothing sung yet, although the verse is already lit.
  expect(await verse(page, 1).locator(".verse-text").evaluate((e) => (e as HTMLElement).style.getPropertyValue("--p"))).toBe("0.0%");
});

const filterOf = (page: Page, i: number) => verse(page, i).evaluate((e) => getComputedStyle(e).filter);

test("inactive verses are dimmed, scaled and blurred by distance from the active one", async ({ page, request }) => {
  await open(page, request);
  await ready(page);
  await setTime(page, 0.6);
  await expect(verse(page, 0)).toHaveAttribute("data-state", "active");
  await expect(verse(page, 1)).toHaveAttribute("data-state", "future");
  await expect.poll(() => verse(page, 1).evaluate((e) => getComputedStyle(e).opacity)).toBe("0.55");
  await expect.poll(() => filterOf(page, 1)).toBe("blur(1px)");
  await expect.poll(() => filterOf(page, 2)).toBe("blur(2px)");
  await expect.poll(() => filterOf(page, 3)).toBe("blur(3px)");
  await expect.poll(() => filterOf(page, 0)).toBe("none");
  const t = await verse(page, 1).evaluate((e) => getComputedStyle(e).transform);
  expect(t).toMatch(/^matrix\(/);
  expect(Number(t.slice(7, -1).split(",")[0])).toBeCloseTo(0.9, 2);
  await expect.poll(() => verse(page, 0).evaluate((e) => getComputedStyle(e).opacity)).toBe("1");

  // Past verses blur by distance too.
  await setTime(page, 4.6);
  await expect(verse(page, 2)).toHaveAttribute("data-state", "active");
  await expect.poll(() => filterOf(page, 1)).toBe("blur(1px)");
  await expect.poll(() => filterOf(page, 0)).toBe("blur(2px)");
  await expect.poll(() => filterOf(page, 2)).toBe("none");
});

test("verses sit half a line apart with a 1.1 line height", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, request);
  await expect(verse(page, 1)).toBeVisible();
  const m = await verse(page, 1).evaluate((e) => {
    const cs = getComputedStyle(e);
    return { size: parseFloat(cs.fontSize), line: parseFloat(cs.lineHeight), gap: parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) };
  });
  expect(m.line / m.size).toBeCloseTo(1.1, 2);
  expect(m.gap / m.size).toBeCloseTo(0.5, 2);
});

test("a focused or hovered inactive verse is sharp", async ({ page, request }) => {
  await open(page, request);
  await ready(page);
  await setTime(page, 0.6);
  await expect.poll(() => filterOf(page, 2)).toBe("blur(2px)");
  await verse(page, 2).hover();
  await expect.poll(() => filterOf(page, 2)).toBe("none");
  await expect.poll(() => verse(page, 2).evaluate((e) => getComputedStyle(e).opacity)).toBe("0.8");
  await page.mouse.move(0, 0);
  await expect.poll(() => filterOf(page, 2)).toBe("blur(2px)");
  await page.keyboard.press("Tab"); // keyboard modality, so the focus below matches :focus-visible
  await verse(page, 3).focus();
  await expect(verse(page, 3)).toBeFocused();
  await expect.poll(() => filterOf(page, 3)).toBe("none");
});

test("more contrast: no blur", async ({ page, request }) => {
  await page.emulateMedia({ contrast: "more" });
  await open(page, request);
  await ready(page);
  await setTime(page, 0.6);
  await expect(verse(page, 0)).toHaveAttribute("data-state", "active");
  for (const i of [1, 2, 3]) await expect.poll(() => filterOf(page, i)).toBe("none");
  await expect.poll(() => verse(page, 1).evaluate((e) => getComputedStyle(e).opacity)).toBe("0.7");
});

test("the background drifts on transform alone", async ({ page, request }) => {
  await open(page, request);
  const field = page.locator(".bg-field");
  expect(await field.evaluate((e) => getComputedStyle(e).filter)).toBe("none");
  const anims = await field.evaluate((e) =>
    e.getAnimations().map((a) => ({
      state: a.playState,
      props: [...new Set((a.effect as KeyframeEffect).getKeyframes().flatMap((k: Keyframe) => Object.keys(k)))].filter(
        (k) => !["offset", "easing", "composite", "computedOffset"].includes(k),
      ),
    })),
  );
  expect(anims).toEqual([{ state: "running", props: ["transform"] }]);
});

test("reduced motion stops the drift", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, request);
  expect(await page.locator(".bg-field").evaluate((e) => ({ name: getComputedStyle(e).animationName, n: e.getAnimations().length }))).toEqual({
    name: "none",
    n: 0,
  });
});

test("phones blur less", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, request);
  await ready(page);
  await setTime(page, 0.6);
  await expect.poll(() => filterOf(page, 1)).toBe("blur(0.6px)");
  await expect.poll(() => filterOf(page, 2)).toBe("blur(1.2px)");
  await expect.poll(() => filterOf(page, 3)).toBe("blur(2px)");
});

test("unsynced lyrics are not blurred", async ({ page, request }) => {
  const track = await uploadFixture(request, "song.mp3");
  await request.put(`/api/tracks/${track.id}/lyrics`, { data: { text: "Primeira linha\nSegunda linha\nTerceira linha" } });
  await page.goto(track.shareUrl);
  await expect(page.locator('[data-lyrics-state="unsynced"]')).toBeVisible();
  for (const i of [0, 1, 2]) expect(await filterOf(page, i)).toBe("none");
});

test("reduced motion: no scale and no pulse", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, request, "Letra Fixtures - Sem Tags.mp3", INTRO_FILE);
  await expect(verse(page, 0)).toBeVisible();
  expect(await verse(page, 0).evaluate((e) => getComputedStyle(e).transform)).toBe("none");
  expect(await page.locator("[data-intro] i.dot").first().evaluate((e) => getComputedStyle(e).animationName)).toBe("none");
});
