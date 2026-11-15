import type { APIRequestContext, Page } from "@playwright/test";
import { expect, noFullscreenApi, refuseFullscreen, test, uploadFixture } from "./helpers.ts";

async function open(page: Page, request: APIRequestContext, file = "song.mp3", asName?: string) {
  const track = await uploadFixture(request, file, asName);
  await page.goto(track.shareUrl);
  await expect(page.locator("[data-play]")).toBeVisible();
  return track;
}
const player = (page: Page) => page.locator(".player");
const button = (page: Page) => page.locator("[data-fullscreen]");
const isFullscreen = (page: Page) => page.evaluate(() => document.fullscreenElement !== null);

async function enterCoverView(page: Page) {
  await button(page).click();
  await expect(player(page)).toHaveAttribute("data-lyrics", "off");
}

test("the cover runs no animation when the page loads", async ({ page, request }) => {
  await noFullscreenApi(page);
  await page.addInitScript(() => {
    const w = window as unknown as { __coverAnimations: number };
    w.__coverAnimations = 0;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, ...args: Parameters<Element["animate"]>) {
      if (this.matches("[data-cover]")) w.__coverAnimations++;
      return animate.apply(this, args);
    };
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, request);
  const count = () => page.evaluate(() => (window as unknown as { __coverAnimations: number }).__coverAnimations);
  expect(await count()).toBe(0);
  await button(page).click();
  await expect(player(page)).toHaveAttribute("data-lyrics", "off");
  expect(await count()).toBe(1);
});

test("there is no lyrics pill and L does nothing", async ({ page, request }) => {
  await open(page, request);
  await expect(page.locator("[data-lyrics-toggle]")).toHaveCount(0);
  await page.keyboard.press("l");
  await expect(player(page)).toHaveAttribute("data-lyrics", "on");
  await expect(page.locator("[data-lyrics-state]")).toBeVisible();
});

test("the skip link is hidden in the cover view", async ({ page, request }) => {
  await noFullscreenApi(page);
  await open(page, request);
  const skip = page.locator("[data-skip-lyrics]");
  await expect(skip).not.toHaveAttribute("hidden", /.*/);
  await enterCoverView(page);
  await expect(skip).toHaveAttribute("hidden", "");
  await button(page).click();
  await expect(player(page)).toHaveAttribute("data-lyrics", "on");
  await expect(skip).not.toHaveAttribute("hidden", /.*/);
});

test("full screen shows the cover view", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, request);
  await button(page).click();
  await expect.poll(() => isFullscreen(page)).toBe(true);
  await expect(player(page)).toHaveAttribute("data-lyrics", "off");
  await expect(page.locator("[data-lyrics-state]")).toBeHidden();
  await expect(button(page)).toHaveAttribute("aria-pressed", "true");
  await expect(button(page)).toHaveAttribute("aria-label", "Tela cheia"); // the state is in aria-pressed, not in the name

  // The cover's box animates to its place: wait for the final box.
  const geometry = () =>
    page.evaluate(() => {
      const cover = document.querySelector("[data-cover]")!.getBoundingClientRect();
      const stage = document.querySelector(".stage")!.getBoundingClientRect();
      return {
        width: cover.width,
        height: cover.height,
        expected: Math.min(0.62 * innerHeight, 640, innerWidth - 144),
        dx: Math.abs(cover.x + cover.width / 2 - (stage.x + stage.width / 2)),
        dy: Math.abs(cover.y + cover.height / 2 - (stage.y + stage.height / 2)),
      };
    });
  await expect(async () => {
    const g = await geometry();
    expect(Math.abs(g.width - g.expected)).toBeLessThanOrEqual(1);
    expect(Math.abs(g.height - g.expected)).toBeLessThanOrEqual(1);
    expect(g.dx).toBeLessThan(2);
    expect(g.dy).toBeLessThan(2);
  }).toPass();
});

test("leaving full screen by Esc brings the lyrics back", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, request);
  await button(page).click();
  await expect(player(page)).toHaveAttribute("data-lyrics", "off");
  await page.evaluate(() => document.exitFullscreen());
  await expect(player(page)).toHaveAttribute("data-lyrics", "on");
  await expect(page.locator("[data-lyrics-state]")).toBeVisible();
  await expect(button(page)).toHaveAttribute("aria-pressed", "false");
  await expect(button(page)).toHaveAttribute("aria-label", "Tela cheia");
});

test("F toggles it", async ({ page, request }) => {
  await open(page, request);
  await page.keyboard.press("f");
  await expect(player(page)).toHaveAttribute("data-lyrics", "off");
  await page.keyboard.press("f");
  await expect(player(page)).toHaveAttribute("data-lyrics", "on");
});

test("F with focus in the lyrics moves focus to the full-screen button", async ({ page, request }) => {
  await noFullscreenApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, request);
  await page.locator('[data-verse][data-index="0"]').focus();
  await page.keyboard.press("f");
  await expect(player(page)).toHaveAttribute("data-lyrics", "off");
  await expect(button(page)).toBeFocused();
});

test("F with focus on the translation button moves focus to the full-screen button", async ({ page, request }) => {
  await noFullscreenApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, request);
  await page.locator("[data-translate]").focus();
  await page.keyboard.press("f");
  await expect(player(page)).toHaveAttribute("data-lyrics", "off");
  await expect(button(page)).toBeFocused();
});

test("translation is out of reach in the cover view", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, request);
  await enterCoverView(page);
  await expect(page.locator(".translate-group")).toBeHidden();
  await expect(page.locator(".translate-group")).toHaveAttribute("inert", "");
  await expect(page.locator("section.lyrics")).toHaveAttribute("inert", "");
  await page.keyboard.press("t");
  await expect(page.locator("[data-translate]")).toHaveAttribute("aria-pressed", "false");
});

test("without the Fullscreen API the button toggles the cover in the page", async ({ page, request }) => {
  await noFullscreenApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, request);
  await expect(button(page)).toBeVisible();
  await expect(button(page)).toHaveAttribute("aria-label", "Mostrar capa");
  await button(page).click();
  await expect(player(page)).toHaveAttribute("data-lyrics", "off");
  await expect(button(page)).toHaveAttribute("aria-label", "Mostrar capa"); // the state is in aria-pressed, not in the name
  await expect(button(page)).toHaveAttribute("aria-pressed", "true");
  expect(await isFullscreen(page)).toBe(false);
  await button(page).click();
  await expect(player(page)).toHaveAttribute("data-lyrics", "on");
});

test("a refused full-screen request changes nothing", async ({ page, request }) => {
  await refuseFullscreen(page);
  await open(page, request);
  await button(page).click();
  await page.waitForTimeout(200);
  await expect(player(page)).toHaveAttribute("data-lyrics", "on");
  await expect(button(page)).toHaveAttribute("aria-pressed", "false");
});

test("resizing across 1024 px keeps the cover view", async ({ page, request }) => {
  await noFullscreenApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, request);
  await button(page).focus();
  await page.keyboard.press("Enter");
  await expect(player(page)).toHaveAttribute("data-lyrics", "off");

  // Stacking moves the progress row (layout-order.ts): focus stays on it.
  const progress = page.locator("[data-progress]");
  await progress.focus();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(player(page)).toHaveAttribute("data-lyrics", "off");
  await expect(page.locator("[data-cover] + .now")).toHaveCount(1);
  await expect(progress).toBeFocused();
  await expect(page.locator("[data-lyrics-state]")).toBeHidden();

  // Going wide moves the transport: focus stays on play.
  const play = page.locator("[data-play]");
  await play.focus();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(player(page)).toHaveAttribute("data-lyrics", "off");
  await expect(page.locator("footer.bottom-bar > .now:first-child")).toHaveCount(1);
  await expect(play).toBeFocused();
});

test("entering the cover view while a tab has focus moves focus to the full-screen button", async ({ page, request }) => {
  await noFullscreenApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, request);
  const home = page.locator('header[data-nav] a[data-tab="home"]');
  await home.focus();
  await expect(home).toBeFocused();
  await page.keyboard.press("f");
  await expect(player(page)).toHaveAttribute("data-lyrics", "off");
  await expect(button(page)).toBeFocused();
  await expect(page.locator("header[data-nav] nav.nav-tabs")).toHaveAttribute("inert", "");
});

test("a song with no lyrics still has the cover view", async ({ page, request }) => {
  await noFullscreenApi(page);
  await open(page, request, "Letra Fixtures - Sem Tags.mp3", "Letra Fixtures - Instrumental Teste.mp3");
  await button(page).click();
  await expect(player(page)).toHaveAttribute("data-lyrics", "off");
  await button(page).click();
  await expect(player(page)).toHaveAttribute("data-lyrics", "on");
});

// --- the cover-view transition (FLIP) ---------------------------------------------------

type Box = { x: number; y: number; width: number; height: number };
const rect = (page: Page): Promise<Box> =>
  page.evaluate(() => {
    const r = document.querySelector("[data-cover]")!.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
const settled = (page: Page) =>
  page.evaluate(() => {
    const cover = document.querySelector("[data-cover]")!;
    return Promise.all(cover.getAnimations().map((a) => a.finished)).then(() => undefined);
  });
const wide = async (page: Page, request: APIRequestContext) => {
  await noFullscreenApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, request);
  await expect.poll(async () => (await rect(page)).x).toBeCloseTo(219, 0);
};

test("the cover moves by transform", async ({ page, request }) => {
  await wide(page, request);
  const start = await rect(page);
  await button(page).click();
  const info = await page.evaluate(() => {
    const cover = document.querySelector("[data-cover]")!;
    const running = cover.getAnimations().filter((a) => a.playState === "running");
    const keyframes = running[0]?.effect instanceof KeyframeEffect ? running[0].effect.getKeyframes() : [];
    return {
      count: cover.getAnimations().length,
      running: running.length,
      transform: keyframes.some((k) => "transform" in k),
      property: getComputedStyle(cover).transitionProperty,
    };
  });
  expect(start.width).toBeGreaterThan(0);
  expect(info.count).toBe(1);
  expect(info.running).toBe(1);
  expect(info.transform).toBe(true);
  expect(info.property).not.toMatch(/\b(left|width|height)\b/);
});

test("it ends on the layout box", async ({ page, request }) => {
  await wide(page, request);
  await enterCoverView(page);
  await settled(page);
  const g = await page.evaluate(() => {
    const cover = document.querySelector("[data-cover]")!;
    const r = cover.getBoundingClientRect();
    const stage = document.querySelector(".stage")!.getBoundingClientRect();
    return {
      width: r.width,
      height: r.height,
      expected: Math.min(0.62 * innerHeight, 640, innerWidth - 144),
      dx: Math.abs(r.x + r.width / 2 - (stage.x + stage.width / 2)),
      dy: Math.abs(r.y + r.height / 2 - (stage.y + stage.height / 2)),
      animations: cover.getAnimations().length,
    };
  });
  expect(Math.abs(g.width - g.expected)).toBeLessThanOrEqual(1);
  expect(Math.abs(g.height - g.expected)).toBeLessThanOrEqual(1);
  expect(g.dx).toBeLessThan(2);
  expect(g.dy).toBeLessThan(2);
  expect(g.animations).toBe(0);
});

test("toggling mid-way reverses from where the cover is", async ({ page, request }) => {
  await wide(page, request);
  const start = await rect(page);
  await button(page).click();
  // 150 ms into the move: the animation's own clock, since its first frame can come late.
  await page.waitForFunction(() => (document.querySelector("[data-cover]")!.getAnimations()[0]?.currentTime as number) >= 150);
  // The second click and the measurements run in one task: nothing moves in between.
  const { mid, after } = await page.evaluate(() => {
    const read = () => {
      const r = document.querySelector("[data-cover]")!.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const mid = read();
    document.querySelector<HTMLElement>("[data-fullscreen]")!.click();
    return { mid, after: read() };
  });
  const final = Math.min(0.62 * 900, 640, 1440 - 144);
  expect(mid.width).toBeGreaterThan(start.width);
  expect(mid.width).toBeLessThan(final);
  for (const k of ["x", "y", "width"] as const) expect(Math.abs(after[k] - mid[k])).toBeLessThanOrEqual(2);
  await settled(page);
  const end = await rect(page);
  for (const k of ["x", "y", "width", "height"] as const) expect(Math.abs(end[k] - start[k])).toBeLessThanOrEqual(1);
});

test("reduced motion: no animation", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await wide(page, request);
  await button(page).click();
  const g = await page.evaluate(() => {
    const cover = document.querySelector("[data-cover]")!;
    const r = cover.getBoundingClientRect();
    return { animations: cover.getAnimations().length, width: r.width, expected: Math.min(0.62 * innerHeight, 640, innerWidth - 144) };
  });
  expect(g.animations).toBe(0);
  expect(Math.abs(g.width - g.expected)).toBeLessThanOrEqual(1);
});

test("coming back, the lyrics are at the playing verse", async ({ page, request }) => {
  await wide(page, request);
  await expect(page.locator('[data-verse][data-index="0"]')).toBeVisible();
  await page.evaluate(() => {
    document.querySelector("audio")!.currentTime = 4.6;
  });
  await expect(page.locator('[data-verse][data-state="active"]')).toBeVisible();
  await enterCoverView(page);
  await button(page).click();
  await expect(player(page)).toHaveAttribute("data-lyrics", "on");
  await expect(async () => {
    const f = await page.evaluate(() => {
      const column = document.querySelector("section.lyrics")!.getBoundingClientRect();
      const active = document.querySelector('[data-verse][data-state="active"]')!.getBoundingClientRect();
      return (active.top - column.top) / column.height;
    });
    expect(f).toBeGreaterThanOrEqual(0.2);
    expect(f).toBeLessThanOrEqual(0.4);
  }).toPass();
});

test("the lyrics fade over the tokens", async ({ page, request }) => {
  await wide(page, request);
  const duration = () => page.locator("section.lyrics").evaluate((e) => getComputedStyle(e).transitionDuration);
  expect(await duration()).toContain("0.2s");
  await enterCoverView(page);
  expect(await duration()).toContain("0.15s");
});

type ReturnSample = { coverMs: number; opacity: number; crossing: boolean };
type Sampled = { returnSamples?: ReturnSample[] };

/**
 * Records, every frame from now on, the clock of the cover's FLIP, the lyrics' opacity and whether
 * the cover is over a verse in the visible part of the column. Call it before the change.
 */
const sampleReturn = (page: Page) =>
  page.evaluate(() => {
    const samples: { coverMs: number; opacity: number; crossing: boolean }[] = [];
    (window as unknown as { returnSamples?: typeof samples }).returnSamples = samples;
    const cover = document.querySelector("[data-cover]")!;
    const lyrics = document.querySelector("section.lyrics")!;
    const tick = () => {
      const coverMs = cover.getAnimations()[0]?.currentTime;
      if (typeof coverMs === "number") {
        const c = cover.getBoundingClientRect();
        const view = lyrics.getBoundingClientRect();
        const crossing = [...lyrics.querySelectorAll(".verse-text")].some((verse) => {
          const range = document.createRange();
          range.selectNodeContents(verse);
          return [...range.getClientRects()].some(
            (r) =>
              r.width > 0 &&
              r.left < c.right &&
              r.right > c.left &&
              Math.max(r.top, view.top) < Math.min(c.bottom, view.bottom) &&
              Math.min(r.bottom, view.bottom) > Math.max(c.top, view.top),
          );
        });
        samples.push({ coverMs, opacity: Number(getComputedStyle(lyrics).opacity), crossing });
      }
      if (samples.length < 600) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
const returnSamples = (page: Page) => page.evaluate(() => (window as unknown as Sampled).returnSamples ?? []);
const lyricsOpacity = (page: Page) => page.locator("section.lyrics").evaluate((e) => getComputedStyle(e).opacity);

// The cover moves over the place where the verses come back: none may show under it.
for (const [name, width, height] of [
  ["side by side", 1440, 900],
  ["on a phone", 390, 844],
  ["on a short phone", 360, 640],
] as const) {
  test(`leaving the cover view ${name}, no verse shows while the cover is over it`, async ({ page, request }) => {
    await noFullscreenApi(page);
    await page.setViewportSize({ width, height });
    await open(page, request);
    await expect.poll(() => lyricsOpacity(page)).toBe("1"); // no fade when the page loads
    // At the third verse the earlier ones reach the top of the column, where the cover passes last.
    await page.evaluate(() => {
      document.querySelector("audio")!.currentTime = 4.6;
    });
    await expect(page.locator('[data-verse][data-index="2"][data-state="active"]')).toBeVisible();
    await page.evaluate(() =>
      Promise.all(document.querySelector("section.lyrics")!.getAnimations({ subtree: true }).map((a) => a.finished)).then(() => undefined),
    );
    await enterCoverView(page);
    await settled(page);
    await sampleReturn(page);
    await button(page).click();
    await settled(page);
    const samples = await returnSamples(page);
    const crossing = samples.filter((s) => s.crossing);
    expect(crossing.length).toBeGreaterThan(0); // the cover does pass over the verses
    expect(Math.max(...crossing.map((s) => s.opacity))).toBe(0);
    expect(Math.max(...samples.filter((s) => s.coverMs < 180).map((s) => s.opacity))).toBe(0);
    await expect.poll(() => lyricsOpacity(page)).toBe("1");
  });
}
