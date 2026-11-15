import type { Page } from "@playwright/test";
import { expect, randomIp, test, uploadFixture } from "./helpers.ts";

// The fake engine answers "[<code>] <line>" and always reports English as the source language.
test.use({ locale: "pt-BR", permissions: ["clipboard-read", "clipboard-write"] });

const verse = (page: Page, i: number) => page.locator(`[data-verse][data-index="${i}"]`);
const translate = (page: Page) => page.locator("[data-translate]");
const language = (page: Page) => page.locator("[data-language]");

async function open(page: Page, request: Parameters<typeof uploadFixture>[0]) {
  // Translation is limited to 30 requests a minute per IP: each test's page gets its own.
  await page.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
  const track = await uploadFixture(request, "song.mp3");
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
  });
  await page.goto(track.shareUrl);
  await expect(verse(page, 0)).toBeVisible();
  return track;
}

async function chooseLanguage(page: Page, name: string) {
  await language(page).click();
  await page.getByRole("menuitemradio", { name }).click();
}

test("toggle on shows a translation under every verse", async ({ page, request }) => {
  await open(page, request);
  await expect(translate(page)).toHaveAttribute("aria-pressed", "false");
  await expect(language(page)).toBeHidden();
  await translate(page).click();
  await expect(translate(page)).toHaveAttribute("aria-pressed", "true");
  await expect(language(page)).toBeVisible();
  await expect(verse(page, 0).locator(".verse-translation")).toHaveText("[pt-BR] Primeiro verso da música");
  await expect(page.locator(".verse-translation")).toHaveCount(4);
  // Each translation line declares its own language.
  await expect(verse(page, 0).locator(".verse-translation")).toHaveAttribute("lang", "pt-BR");
});

test("translation lines are 85% under the active verse and the verse's own dim under the others", async ({ page, request }) => {
  await open(page, request);
  await translate(page).click();
  await expect(page.locator(".verse-translation")).toHaveCount(4);
  await page.evaluate(() => {
    document.querySelector("audio")!.currentTime = 4.6;
  });
  await expect(verse(page, 2)).toHaveAttribute("data-state", "active");
  // Effective opacity: the line's own times its verse's.
  const opacity = (i: number) =>
    verse(page, i)
      .locator(".verse-translation")
      .evaluate((e) => Number(getComputedStyle(e).opacity) * Number(getComputedStyle(e.parentElement!).opacity));
  await expect.poll(() => opacity(2)).toBeCloseTo(0.85, 2);
  await expect.poll(() => opacity(1)).toBeCloseTo(0.55, 2);
});

test("switch language", async ({ page, request }) => {
  await open(page, request);
  await translate(page).click();
  await chooseLanguage(page, "Español");
  await expect(language(page)).toHaveText("Español");
  await expect(verse(page, 0).locator(".verse-translation")).toHaveText("[es] Primeiro verso da música");
  await expect(language(page)).toHaveAccessibleName("Idioma da tradução: Español");
});

test("the language menu works from the keyboard", async ({ page, request }) => {
  await open(page, request);
  await translate(page).click();
  await expect(verse(page, 0).locator(".verse-translation")).toHaveText("[pt-BR] Primeiro verso da música");
  const menu = page.getByRole("menu", { name: "Idiomas" });
  await language(page).focus();
  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: "Português" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  await expect(language(page)).toBeFocused();
  await expect(language(page)).toHaveText("हिन्दी");
  await expect(verse(page, 0).locator(".verse-translation")).toHaveText("[hi] Primeiro verso da música");
  // Reopen, then Tab leaves and closes it.
  await page.keyboard.press("ArrowDown");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(menu).toBeHidden();
  // Escape returns focus to the pill.
  await language(page).focus();
  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(language(page)).toBeFocused();
});

test("Tab closes the language menu and moves on", async ({ page, request }) => {
  await open(page, request);
  await translate(page).click();
  await language(page).click();
  const menu = page.getByRole("menu", { name: "Idiomas" });
  await expect(menu).toBeVisible();
  await page.getByRole("menuitemradio", { name: "Português" }).focus();
  await page.keyboard.press("Tab");
  await expect(menu).toBeHidden();
  // The browser moves on from the pill: the control after it is the share button.
  await expect(page.getByRole("button", { name: "Compartilhar" })).toBeFocused();
});

test("a press outside closes the language menu", async ({ page, request }) => {
  await open(page, request);
  await translate(page).click();
  await language(page).click();
  const menu = page.getByRole("menu", { name: "Idiomas" });
  await expect(menu).toBeVisible();
  await page.getByRole("heading", { level: 1 }).click();
  await expect(menu).toBeHidden();
  await expect(language(page)).not.toBeFocused();
});

test("Home and End jump to the first and last language", async ({ page, request }) => {
  await open(page, request);
  await translate(page).click();
  await language(page).click();
  const menu = page.getByRole("menu", { name: "Idiomas" });
  await expect(menu).toBeVisible();
  const rows = menu.getByRole("menuitemradio");
  await page.keyboard.press("End");
  await expect(rows.last()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(rows.first()).toBeFocused();
});

test("focus leaving the menu closes it", async ({ page, request }) => {
  await open(page, request);
  await translate(page).click();
  await language(page).click();
  const menu = page.getByRole("menu", { name: "Idiomas" });
  await expect(menu).toBeVisible();
  await page.getByRole("button", { name: "Compartilhar" }).focus();
  await expect(menu).toBeHidden();
});

test("a pointer press that blurs the focused row does not close the menu", async ({ page, request }) => {
  await open(page, request);
  await translate(page).click();
  await language(page).click();
  const menu = page.getByRole("menu", { name: "Idiomas" });
  await expect(menu).toBeVisible();
  await page.getByRole("menuitemradio", { name: "Português" }).focus();
  // Safari path: the press reaches the menu, and the focused row blurs with relatedTarget null.
  await page.evaluate(() => {
    document.querySelector('[data-code="fr"]')!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    (document.activeElement as HTMLElement).blur();
  });
  await expect(menu).toBeVisible();
  await page.getByRole("menuitemradio", { name: "Français" }).click();
  await expect(menu).toBeHidden();
  await expect(language(page)).toHaveText("Français");
  await expect(verse(page, 0).locator(".verse-translation")).toHaveText("[fr] Primeiro verso da música");
});

for (const [asName, label] of [
  ["Letra Fixtures - Sem Letra.mp3", "no lyrics"],
  ["Letra Fixtures - Instrumental Teste.mp3", "instrumental"],
] as const) {
  test(`translation is not offered for a track with ${label}`, async ({ page, request }) => {
    const track = await uploadFixture(request, "Letra Fixtures - Sem Tags.mp3", asName);
    await page.goto(track.shareUrl);
    await expect(page.locator("[data-lyrics-state]")).toBeVisible();
    await expect(translate(page)).toBeHidden();
    await page.keyboard.press("t");
    await expect(page.locator(".translation-error")).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem("letra:translation"))).toBeNull();
  });
}

test("preference survives reload", async ({ page, request }) => {
  await open(page, request);
  await translate(page).click();
  await chooseLanguage(page, "Español");
  await expect(verse(page, 0).locator(".verse-translation")).toHaveText("[es] Primeiro verso da música");
  await page.reload();
  await expect(translate(page)).toHaveAttribute("aria-pressed", "true");
  await expect(language(page)).toHaveText("Español");
  await expect(verse(page, 0).locator(".verse-translation")).toHaveText("[es] Primeiro verso da música");
});

test("same language note", async ({ page, request }) => {
  await open(page, request);
  await translate(page).click();
  await chooseLanguage(page, "English");
  await expect(page.getByText("A música já está em English")).toBeVisible();
  await expect(page.locator(".verse-translation")).toHaveCount(0);
});

test("failure shows retry and the lyrics keep playing", async ({ page, request }) => {
  await open(page, request);
  let fail = true;
  await page.route("**/api/tracks/*/translation*", (route) =>
    fail
      ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "translation_unavailable", message: "x" } }) })
      : route.continue(),
  );
  await translate(page).click();
  await expect(page.getByText("Tradução indisponível agora.")).toBeVisible();
  const retry = page.getByRole("button", { name: "Tentar de novo" });
  await expect(retry).toBeVisible();
  await page.locator("[data-play]").click();
  await expect.poll(() => page.evaluate(() => !document.querySelector("audio")!.paused)).toBe(true);
  fail = false;
  await retry.click();
  await expect(verse(page, 0).locator(".verse-translation")).toHaveText("[pt-BR] Primeiro verso da música");
  await expect(page.getByText("Tradução indisponível agora.")).toBeHidden();
});

test("share copies the link from the share dialog", async ({ page, request }) => {
  const track = await open(page, request);
  await page.getByRole("button", { name: "Compartilhar" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Copiar link" }).click();
  await expect(page.getByText("Link copiado")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(track.shareUrl);
  await expect(page.getByText("Link copiado")).toBeHidden({ timeout: 4000 });
});

test("T toggles translation", async ({ page, request }) => {
  await open(page, request);
  await page.keyboard.press("t");
  await expect(translate(page)).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("T");
  await expect(translate(page)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".verse-translation")).toHaveCount(0);
});

test("the full screen button is present and labelled", async ({ page, request }) => {
  await open(page, request);
  await expect(page.getByRole("button", { name: "Tela cheia" })).toBeVisible();
});

test("more contrast: the language menu turns solid #1C1C1E", async ({ page, request }) => {
  await page.emulateMedia({ contrast: "more" });
  await open(page, request);
  await translate(page).click();
  await language(page).click();
  const menu = page.getByRole("menu", { name: "Idiomas" });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveCSS("background-color", "rgb(28, 28, 30)");
  await page.emulateMedia({ contrast: "no-preference" });
  await expect(menu).toHaveCSS("background-color", "rgba(28, 28, 30, 0.84)");
});
