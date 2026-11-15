import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, randomIp, test, upload, uploadFixture, visit } from "./helpers.ts";
import { decodePngRgba } from "./png.ts";

async function open(page: Page, request: APIRequestContext, file = "song.mp3") {
  const track = await uploadFixture(request, file);
  await page.goto(track.shareUrl);
  await expect(page.locator("[data-play]")).toBeVisible();
  return track;
}
const scaleOf = (page: Page, selector: string) =>
  page.locator(selector).evaluate((e) => new DOMMatrixReadOnly(getComputedStyle(e).transform).a);
async function press(page: Page, selector: string) {
  const b = (await page.locator(selector).boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
}

test("tokens are on the page", async ({ page, request }) => {
  await open(page, request);
  const read = (name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
  // The build minifies "120ms" to ".12s": compare the value, not the spelling.
  const ms = async (name: string) => {
    const raw = await read(name);
    return Math.round(parseFloat(raw) * (raw.endsWith("ms") ? 1 : 1000));
  };
  expect(await ms("--dur-fast")).toBe(120);
  expect(await ms("--dur-move")).toBe(400);
  expect(await read("--ease-spring")).toMatch(/^linear\(0, 0?\.051/);
});

test("a glass button presses to .97 and a transport button to .94", async ({ page, request }) => {
  await open(page, request);
  await press(page, "[data-share]");
  await expect.poll(() => scaleOf(page, "[data-share]")).toBeCloseTo(0.97, 2);
  await page.mouse.move(0, 0); // release off the button: no click, so the dialog stays closed
  await page.mouse.up();
  await expect.poll(() => scaleOf(page, "[data-share]")).toBe(1);
  await press(page, "[data-back]");
  await expect.poll(() => scaleOf(page, "[data-back]")).toBeCloseTo(0.94, 2);
  await page.mouse.up();
});

test("reduced motion: transitions are immediate", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, request);
  const durations = await page.locator("[data-share]").evaluate((e) => getComputedStyle(e).transitionDuration);
  for (const d of durations.split(",")) expect(parseFloat(d)).toBeLessThan(0.001);
});

const icons = (page: Page, selector: string) =>
  page.locator(`${selector} .icon`).evaluateAll((nodes) => nodes.map((n) => ({ name: n.getAttribute("data-icon"), leaving: n.classList.contains("is-leaving") })));

test("play and pause swap with a short cross-fade and end with one icon", async ({ page, request }) => {
  await open(page, request);
  await page.locator("[data-play]").click();
  await expect(page.locator("[data-play]")).toHaveAttribute("aria-label", "Pausar");
  expect((await icons(page, "[data-play]")).filter((i) => !i.leaving)).toEqual([{ name: "pause", leaving: false }]);
  await expect.poll(() => icons(page, "[data-play]")).toEqual([{ name: "pause", leaving: false }]);
});

test("toggling fast ends with one icon for the final state", async ({ page, request }) => {
  await open(page, request);
  const play = page.locator("[data-play]");
  for (let i = 0; i < 5; i++) await play.click({ delay: 0 });
  await expect(play).toHaveAttribute("aria-label", "Pausar"); // 5 clicks: playing
  await expect.poll(() => icons(page, "[data-play]")).toEqual([{ name: "pause", leaving: false }]);
});

test("the volume icon shows mute at zero", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, request);
  const slider = page.getByRole("slider", { name: "Volume" });
  await slider.fill("0");
  await expect.poll(() => icons(page, ".volume")).toEqual([{ name: "speaker-mute", leaving: false }]);
  await slider.fill("0.6");
  await expect.poll(() => icons(page, ".volume")).toEqual([{ name: "speaker", leaving: false }]);
});

test("with reduced motion a swap still ends with one icon", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, request);
  await page.locator("[data-play]").click();
  await expect(page.locator("[data-play]")).toHaveAttribute("aria-label", "Pausar");
  await expect.poll(() => icons(page, "[data-play]")).toEqual([{ name: "pause", leaving: false }]);
});

const dialogState = (page: Page) =>
  page.evaluate(() => {
    const all = document.querySelectorAll<HTMLDialogElement>("dialog.share-dialog");
    const d = all[all.length - 1];
    return d ? { open: d.open, shown: getComputedStyle(d).display !== "none" } : null;
  });

/**
 * Times, inside the page, how long the share dialog stays in the document after a click on its
 * close button. Arm it before the click, then read `removalDelay`. Timing in the page keeps the
 * runner's own latency out of the measure.
 */
const armRemovalTimer = (page: Page) =>
  page.evaluate(() => {
    const dialog = document.querySelector("dialog.share-dialog")!;
    (window as unknown as { removalDelay?: Promise<number> }).removalDelay = new Promise<number>((resolve) => {
      let clicked = 0;
      dialog.querySelector(".share-close")!.addEventListener("click", () => (clicked = performance.now()), { capture: true, once: true });
      new MutationObserver((_, observer) => {
        if (dialog.isConnected) return;
        observer.disconnect();
        resolve(performance.now() - clicked);
      }).observe(document.documentElement, { childList: true, subtree: true });
    });
  });
const removalDelay = (page: Page) => page.evaluate(() => (window as unknown as { removalDelay: Promise<number> }).removalDelay);

/** Stretches the exit so the test can look at the dialog while it leaves. */
const slowExit = (page: Page) => page.evaluate(() => document.documentElement.style.setProperty("--dur-exit", "1000ms"));

test("the share dialog plays an exit before it leaves the page", async ({ page, request }) => {
  await open(page, request);
  await page.locator("[data-share]").click();
  await expect(page.locator("dialog.share-dialog")).toBeVisible();
  await slowExit(page);
  await page.locator("dialog.share-dialog .share-close").click();
  expect(await dialogState(page)).toEqual({ open: false, shown: true }); // still drawn while it fades
  await expect(page.locator("[data-share]")).toBeFocused();
  await expect.poll(() => dialogState(page)).toBeNull();
});

test("reopening the dialog while it closes keeps it open", async ({ page, request }) => {
  await open(page, request);
  const share = page.locator("[data-share]");
  await share.click();
  await slowExit(page);
  await page.locator("dialog.share-dialog .share-close").click();
  await share.click(); // inside the 1 s exit
  await page.waitForTimeout(1500);
  expect(await dialogState(page)).toEqual({ open: true, shown: true });
});

test("reduced motion: the dialog leaves at once", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, request);
  await page.locator("[data-share]").click();
  await armRemovalTimer(page);
  await page.locator("dialog.share-dialog .share-close").click();
  expect(await removalDelay(page)).toBeLessThan(500);
});

test("without the overlay property the dialog leaves at once", async ({ page, request }) => {
  // A browser that honors display … allow-discrete but has no overlay: an exit would play out of the top layer.
  await page.addInitScript(() => {
    const supports = CSS.supports.bind(CSS);
    CSS.supports = ((...args: [string, string?]) =>
      args.length === 2 && args[0] === "overlay" ? false : supports(...(args as [string]))) as typeof CSS.supports;
  });
  await open(page, request);
  await page.locator("[data-share]").click();
  await expect(page.locator("dialog.share-dialog")).toBeVisible();
  await slowExit(page); // were the exit kept, it would hold the dialog for a second
  await armRemovalTimer(page);
  await page.locator("dialog.share-dialog .share-close").click();
  expect(await removalDelay(page)).toBeLessThan(500);
});

test("the toast enters over --dur-base and leaves over --dur-exit", async ({ page, request }) => {
  await open(page, request);
  const toast = page.locator("[data-toast]");
  expect(await toast.evaluate((e) => getComputedStyle(e).transitionDuration)).toContain("0.15s");
  await page.evaluate(() => document.querySelector("[data-toast]")!.classList.add("is-shown"));
  expect(await toast.evaluate((e) => getComputedStyle(e).transitionDuration)).toContain("0.2s");
});

test("the language menu grows from its button's corner", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, request);
  await page.locator("[data-translate]").click();
  await page.locator("[data-language]").click();
  const menu = page.locator(".language-menu");
  await expect(menu).toBeVisible();
  await expect.poll(() => menu.evaluate((e) => getComputedStyle(e).opacity)).toBe("1"); // settled: the box is measured at full scale
  const origin = await menu.evaluate((e) => getComputedStyle(e).transformOrigin.split(" ").map(parseFloat));
  const width = (await menu.boundingBox())!.width;
  expect(origin[0]).toBeCloseTo(width, 0); // right
  expect(origin[1]).toBe(0);               // top
});

test("a home tile lifts its cover under the pointer and presses in", async ({ page, request }) => {
  const track = await upload(request, "Faixa do teste");
  await visit(page, track);
  await page.goto("/");
  const tile = page.locator("a[data-recent]").first();
  await tile.hover();
  await expect.poll(() => tile.locator(".home-cover > *").evaluate((e) => getComputedStyle(e).scale)).toBe("1.02");
  await page.mouse.down();
  await expect.poll(() => tile.evaluate((e) => getComputedStyle(e).scale)).toBe("0.98");
  await page.mouse.move(0, 0);
  await page.mouse.up();
});

test("the progress handle shows on hover, on focus and while dragging", async ({ page, request, browser, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const track = await open(page, request);
  const shownOn = (p: Page) => p.locator("[data-progress]").evaluate((e) => getComputedStyle(e).getPropertyValue("--thumb-scale").trim());
  const bar = page.locator("[data-progress]");
  expect(await shownOn(page)).toBe("0");
  await bar.hover();
  expect(await shownOn(page)).toBe("1");
  await page.mouse.move(0, 0);
  expect(await shownOn(page)).toBe("0");
  await bar.focus();
  await page.keyboard.press("ArrowRight"); // keyboard modality
  expect(await shownOn(page)).toBe("1");

  // A drag, where nothing hovers (a phone or tablet): with a mouse, the slider's pointer capture
  // would keep :hover on it and show the handle whatever the drag rule says.
  const touch = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": randomIp() }, baseURL, viewport: { width: 1440, height: 900 }, hasTouch: true, isMobile: true });
  try {
    const p = await touch.newPage();
    await p.goto(track.shareUrl);
    await expect(p.locator("[data-play]")).toBeVisible();
    expect(await p.evaluate(() => matchMedia("(hover: hover)").matches)).toBe(false);
    const drag = p.locator("[data-progress]");
    const box = (await drag.boundingBox())!;
    await p.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
    await p.mouse.down(); // pressed on the bar
    await p.mouse.move(box.x + box.width * 0.3, box.y - 120, { steps: 4 }); // and off it, still pressed
    await expect(drag).toHaveAttribute("data-dragging", "");
    expect(await shownOn(p)).toBe("1");
    await p.mouse.up();
    await expect(drag).not.toHaveAttribute("data-dragging", /.*/);
    expect(await shownOn(p)).toBe("0");
  } finally {
    await touch.close();
  }
});

test("the fill ratio follows the playing position", async ({ page, request }) => {
  await open(page, request);
  const bar = page.locator("[data-progress]");
  expect(await bar.evaluate((e) => getComputedStyle(e).getPropertyValue("--fill-n").trim())).toBe("0");
  await page.evaluate(() => { const a = document.querySelector("audio")!; a.currentTime = a.duration / 2; });
  await expect.poll(async () => Number(await bar.evaluate((e) => getComputedStyle(e).getPropertyValue("--fill-n")))).toBeCloseTo(0.5, 1);
});

/** The RGB of the pixels on the bar's middle row, left to right, from a screenshot of the slider. */
async function barRow(slider: Locator): Promise<[number, number, number][]> {
  const { data, width, height } = decodePngRgba(await slider.screenshot());
  const y = Math.floor(height / 2);
  return Array.from({ length: width }, (_, x) => {
    const i = (y * width + x) * 4;
    return [data[i]!, data[i + 1]!, data[i + 2]!];
  });
}
const isFill = ([r, g, b]: [number, number, number]) => Math.min(r, g, b) >= 245; // --bar-fill is #fff

test("at rest the fill is exact at both ends of the bar", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, request);
  await page.mouse.move(0, 0); // no hover: the handle is hidden

  // Volume 1 (its default): the bar is full to its right end.
  const volume = await barRow(page.getByRole("slider", { name: "Volume" }));
  const right = volume.slice(-6, -2); // the last pixels inside the rounded end
  expect(right.every(isFill), JSON.stringify(right)).toBe(true);

  // Position 0: nothing is filled, not even at the left end.
  const progress = await barRow(page.locator("[data-progress]"));
  const left = progress.slice(2, 6);
  expect(left.some(isFill), JSON.stringify(left)).toBe(false);
  const track = progress[40]!; // well inside the empty bar
  for (const px of left) for (let c = 0; c < 3; c++) expect(Math.abs(px[c]! - track[c]!)).toBeLessThanOrEqual(12);
});

test("a swapping icon starts its fade in the same frame", async ({ page, request }) => {
  await open(page, request);
  const state = await page.evaluate(() => {
    const slider = document.querySelector<HTMLInputElement>(".volume input[type=range]")!;
    slider.value = "0";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    const icons = [...document.querySelectorAll<HTMLElement>(".volume-icon .icon")];
    return {
      count: icons.length,
      leaving: icons[0]?.classList.contains("is-leaving"),
      running: icons[1]?.getAnimations().length ?? 0,
    };
  });
  expect(state.count).toBe(2);
  expect(state.leaving).toBe(true);
  expect(state.running).toBeGreaterThan(0);
});
