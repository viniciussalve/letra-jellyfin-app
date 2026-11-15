import { expect, savedLine, seedSaved, test, uploadFixture } from "./helpers.ts";

// Runs against the second web server, started with TRANSLATOR=off (playwright.config.ts).
test("translate button absent when translation is disabled", async ({ page, request }) => {
  const track = await uploadFixture(request, "song.mp3");
  await page.goto(track.shareUrl);
  await expect(page.locator("[data-verse]").first()).toBeVisible();
  await expect(page.locator("[data-translate]")).toBeHidden();
  await expect(page.locator("[data-language]")).toBeHidden();
  await page.keyboard.press("t");
  await expect(page.locator(".verse-translation")).toHaveCount(0);
});

test("/salvas has no translate button when translation is disabled", async ({ page, request }) => {
  const track = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(track, 0)]);
  const answered = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/tracks/summary");
  await page.goto("/salvas");
  await answered;
  await expect(page.locator("[data-line-text]")).toHaveText("Primeiro verso da música");
  // After the page has had two frames to handle the answer.
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  await expect(page.locator("[data-translate]")).toHaveCount(0);
});
