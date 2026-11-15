import type { Page } from "@playwright/test";
import { expect, test, uploadFixture } from "./helpers.ts";

test.use({ locale: "pt-BR" });

const verse = (page: Page, i: number) => page.locator(`[data-verse][data-index="${i}"]`);
const audioState = (page: Page) =>
  page.evaluate(() => {
    const a = document.querySelector("audio")!;
    return { t: a.currentTime, paused: a.paused };
  });

test("?t= opens the song paused at that verse", async ({ page, request }) => {
  const track = await uploadFixture(request, "song.mp3");
  await page.goto(`${track.shareUrl}?t=2.5`);
  await expect(verse(page, 1)).toHaveAttribute("data-state", "active");
  await expect(page.locator("[data-elapsed]")).toHaveText("0:02");
  expect((await audioState(page)).paused).toBe(true);

  await page.locator("[data-play]").click();
  await expect.poll(async () => (await audioState(page)).t).toBeGreaterThan(2.5);
  // Never below the asked position, once it plays.
  for (let i = 0; i < 5; i++) {
    expect((await audioState(page)).t).toBeGreaterThanOrEqual(2.5);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
  }
});

test("?t= shows the moment before the file's metadata, and a verse clicked meanwhile keeps its place", async ({ page, request }) => {
  const track = await uploadFixture(request, "song.mp3");
  // The position just after the page's own loadedmetadata handlers have run.
  await page.addInitScript(() => {
    document.addEventListener(
      "loadedmetadata",
      (e) => setTimeout(() => ((window as unknown as { __afterMetadata: number }).__afterMetadata = (e.target as HTMLAudioElement).currentTime)),
      true,
    );
  });
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/media/*/audio", async (route) => {
    await held;
    await route.continue();
  });
  try {
    await page.goto(`${track.shareUrl}?t=2.5`);
    await expect(verse(page, 1)).toHaveAttribute("data-state", "active");
    await expect(page.locator("[data-elapsed]")).toHaveText("0:02");
    expect(await page.evaluate(() => document.querySelector("audio")!.readyState)).toBe(0);

    await verse(page, 3).click();
    await expect(verse(page, 3)).toHaveAttribute("data-state", "active");
  } finally {
    release();
  }
  const after = await page.waitForFunction(() => (window as unknown as { __afterMetadata?: number }).__afterMetadata);
  expect(await after.jsonValue()).toBeGreaterThanOrEqual(6.5);
  await expect(verse(page, 1)).not.toHaveAttribute("data-state", "active");
});

test("a bad ?t= is ignored", async ({ page, request }) => {
  const track = await uploadFixture(request, "song.mp3");
  for (const bad of ["abc", "-1", "1.25", "999"]) {
    await page.goto(`${track.shareUrl}?t=${bad}`);
    await expect(verse(page, 0)).toBeVisible();
    await expect(page.locator("[data-elapsed]")).toHaveText("0:00");
    expect((await audioState(page)).t, bad).toBe(0);
    await expect(page.locator('[data-verse][data-state="active"]'), bad).toHaveCount(0);
  }
});

test("the share link never carries t", async ({ page, request, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const track = await uploadFixture(request, "song.mp3");
  await page.goto(`${track.shareUrl}?t=2.5`);
  await page.locator("button[data-share]").click();
  const dialog = page.locator("dialog[data-share-dialog]");
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-share-action="copy"]').click();
  await expect(page.locator("[data-toast]")).toHaveText("Link copiado");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(track.shareUrl);
});
