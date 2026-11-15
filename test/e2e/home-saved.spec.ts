import type { Locator, Page } from "@playwright/test";
import type { SavedLine } from "../../web/shared/saved.ts";
import { expect, savedLine, seedSaved, test, upload, visit } from "./helpers.ts";

test.use({ locale: "pt-BR" });

const DAY = 24 * 60 * 60 * 1000;
const section = (page: Page) => page.locator("[data-saved-section]");
const cards = (page: Page) => page.locator("[data-saved-card]");
const savedTab = (page: Page) => page.locator('[data-nav] a[data-tab="saved"]');

const stored = (page: Page): Promise<SavedLine[]> =>
  page.evaluate(() => JSON.parse(localStorage.getItem("letra.saved.v1") ?? "[]") as SavedLine[]);

const type = (loc: Locator) =>
  loc.evaluate((n) => {
    const s = getComputedStyle(n);
    return `${s.fontSize}/${s.lineHeight} ${s.fontWeight} clamp:${s.getPropertyValue("-webkit-line-clamp")}`;
  });

test("the section shows only when a line is saved, above the listening history", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator("[data-home-view]")).toBeVisible();
  await expect(section(page)).toBeHidden();

  const a = await upload(request, "Faixa A");
  await seedSaved(page, [savedLine(a, 1)]);
  await page.goto("/");
  await expect(section(page)).toBeVisible();
  const saved = await page.getByRole("heading", { name: "Linhas salvas" }).boundingBox();
  const recent = await page.getByRole("heading", { name: "Ouvidas recentemente" }).boundingBox();
  expect(saved!.y).toBeLessThan(recent!.y);
});

test("it shows the three latest lines, newest first, and the tab leads to all of them", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  const now = Date.now();
  await seedSaved(page, [
    savedLine(a, 0, { at: now - 5 * 1000 }),
    savedLine(a, 1, { at: now - 1 * 1000 }),
    savedLine(a, 2, { at: now - 4 * 1000 }),
    savedLine(a, 3, { at: now - 2 * 1000 }),
    savedLine(a, 0, { trackId: "other", title: "Outra", at: now - 3 * 1000 }),
  ]);
  await page.goto("/");
  await expect(cards(page)).toHaveCount(3);
  await expect(cards(page).locator(".saved-card-q")).toHaveText([
    "Segundo verso, um pouco mais longo para quebrar a linha em telas estreitas",
    "Último verso",
    "Primeiro verso da música",
  ]);
  await expect(savedTab(page)).toHaveAttribute("href", "/salvas");
  await savedTab(page).click();
  await expect(page).toHaveURL(/\/salvas$/);
  await expect(page.locator("[data-line]")).toHaveCount(5);
});

test("a card opens the song at its verse", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  await seedSaved(page, [savedLine(a, 1)]);
  await page.goto("/");
  await expect(cards(page)).toHaveAttribute("href", `/t/${a.id}?t=2.5`);
  await cards(page).click();
  await expect(page).toHaveURL(new RegExp(`/t/${a.id}\\?t=2\\.5$`));
  await expect(page.locator('[data-verse][data-index="1"]')).toHaveAttribute("data-state", "active");
  expect(await page.evaluate(() => document.querySelector("audio")!.paused)).toBe(true);
});

test("a card of a removed song is not a link and says so", async ({ page, request }) => {
  const a = await upload(request, "Vai Sumir");
  await seedSaved(page, [savedLine(a, 1)]);
  expect((await request.delete(`/api/tracks/${a.id}`)).ok()).toBe(true);
  await page.goto("/");
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).locator(".saved-card-who i")).toHaveText("Música indisponível");
  await expect(cards(page)).toHaveJSProperty("tagName", "DIV");
  await expect(cards(page)).not.toHaveAttribute("href", /.*/);
});

test("Limpar histórico leaves the saved lines", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  await seedSaved(page, [savedLine(a, 1), savedLine(a, 2)]);
  await visit(page, a);
  await page.goto("/");
  await expect(cards(page)).toHaveCount(2);
  const before = await stored(page);
  await page.locator("[data-clear-recents]").click();
  await expect(page.locator("[data-recents-empty]")).toBeVisible();
  await expect(cards(page)).toHaveCount(2);
  expect(await stored(page)).toEqual(before);
});

test("saved lines show even with no listening history", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  await seedSaved(page, [savedLine(a, 1)]);
  await page.goto("/");
  await expect(section(page)).toBeVisible();
  await expect(page.locator("[data-recents-empty]")).toBeVisible();
  await expect(page.locator("[data-recents-empty]")).toHaveText("As músicas que você abrir por um link aparecem aqui.");
});

test("cards: three in a row on wide screens, stacked on phones", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  const now = Date.now();
  await seedSaved(page, [savedLine(a, 1, { at: now }), savedLine(a, 2, { at: now - 1000 }), savedLine(a, 3, { at: now - 2000 })]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(cards(page)).toHaveCount(3);
  const wide = await cards(page).evaluateAll((n) => n.map((x) => x.getBoundingClientRect().top));
  expect(new Set(wide).size).toBe(1);
  expect(await type(cards(page).first().locator(".saved-card-q"))).toBe("19px/25px 600 clamp:3");

  await page.setViewportSize({ width: 390, height: 844 });
  const lefts = await cards(page).evaluateAll((n) => n.map((x) => x.getBoundingClientRect().left));
  expect(new Set(lefts).size).toBe(1);
  const tops = await cards(page).evaluateAll((n) => n.map((x) => x.getBoundingClientRect().top));
  expect(new Set(tops).size).toBe(3);
  expect(await type(cards(page).first().locator(".saved-card-q"))).toBe("17px/23px 600 clamp:2");
});

test("dates on cards use the short form", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  const at = (y: number, m: number, d: number, h = 9) => new Date(y, m, d, h).getTime();
  await page.clock.install({ time: new Date(2026, 10, 10, 15, 0) });
  await seedSaved(page, [savedLine(a, 0, { at: at(2026, 10, 10) }), savedLine(a, 1, { at: at(2026, 10, 9, 23) }), savedLine(a, 2, { at: at(2026, 10, 2) })]);
  await page.goto("/");
  const when = page.locator(".saved-card-when");
  await expect(when).toHaveText(["Hoje", "Ontem", "2 de nov."]);
  for (let i = 0; i < 3; i++) {
    expect(Number.isNaN(Date.parse((await when.nth(i).getAttribute("datetime"))!))).toBe(false);
    await expect(when.nth(i)).toHaveAttribute("title", /.+/);
  }
});

test("line text is drawn as text", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  const text = "<b>negrito</b> & <img src=x onerror=alert(1)>";
  await seedSaved(page, [savedLine(a, 0, { text })]);
  await page.goto("/");
  await expect(page.locator(".saved-card-q")).toHaveText(text);
  await expect(page.locator("[data-saved-card] b:not(.saved-card-who b), [data-saved-card] img:not(.saved-cover img)")).toHaveCount(0);
});

test("the wordmark is the page's h1 and the two sections are h2", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  await seedSaved(page, [savedLine(a, 1)]);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1, name: "letra" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Linhas salvas" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Ouvidas recentemente" })).toBeVisible();
});

test("a save in another tab appears on the home", async ({ page, context, request }) => {
  const a = await upload(request, "Faixa A");
  await page.goto("/");
  await expect(section(page)).toBeHidden();
  const other = await context.newPage();
  await other.goto(a.shareUrl);
  await other.locator('[data-verse][data-index="1"] .verse-save').click();
  await expect(cards(page)).toHaveCount(1);
});

test("no horizontal scroll at 360 px with three cards", async ({ page, request }) => {
  const a = await upload(request, "Faixa A com um título bem comprido para forçar a largura", "Artista com um nome também muito comprido");
  const now = Date.now();
  await seedSaved(page, [savedLine(a, 1, { at: now - 2 * DAY }), savedLine(a, 2, { at: now - DAY }), savedLine(a, 3, { text: "x".repeat(200), at: now })]);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await expect(cards(page)).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("a card's line carries its song's language", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  const now = Date.now();
  await seedSaved(page, [savedLine(a, 0, { lang: "en", at: now }), savedLine(a, 1, { lang: "", at: now - 1000 })]);
  await page.goto("/");
  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page).nth(0).locator(".saved-card-q")).toHaveAttribute("lang", "en");
  expect(await cards(page).nth(1).locator(".saved-card-q").getAttribute("lang")).toBeNull();
});

test("a refresh of the cards that changes nothing writes nothing", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  await seedSaved(page, [savedLine(a, 1)]);
  await page.addInitScript(() => {
    const w = window as unknown as { __writes: number };
    w.__writes = 0;
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === "letra.saved.v1") w.__writes++;
      return set.call(this, key, value);
    };
  });
  let release: () => void = () => {};
  const held = new Promise<void>((r) => (release = r));
  let reached: () => void = () => {};
  const asked = new Promise<void>((r) => (reached = r));
  await page.route("**/api/tracks/summary*", async (route) => {
    reached();
    await held;
    await route.continue();
  });
  await page.goto("/");
  await asked;
  await expect(cards(page)).toHaveCount(1);
  await cards(page).first().evaluate((n) => n.setAttribute("data-old", ""));
  release();
  await expect(page.locator("[data-saved-card][data-old]")).toHaveCount(0);
  await expect(cards(page)).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as { __writes: number }).__writes)).toBe(0);
});

test("keyboard focus on a card survives a redraw", async ({ page, context, request }) => {
  const a = await upload(request, "Faixa A");
  await seedSaved(page, [savedLine(a, 1)]);
  await page.goto("/");
  await expect(cards(page)).toHaveCount(1);
  await cards(page).first().focus();
  await expect(cards(page).first()).toBeFocused();
  const other = await context.newPage();
  await other.goto(a.shareUrl);
  await other.locator('[data-verse][data-index="2"] .verse-save').click();
  await expect(cards(page)).toHaveCount(2);
  await expect(page.locator(`[data-saved-card][href="/t/${a.id}?t=2.5"]`)).toBeFocused();
});

test("a card with an id the server would refuse is drawn as unavailable and the others refresh", async ({ page, request }) => {
  const a = await upload(request, "Título Novo");
  const now = Date.now();
  await seedSaved(page, [savedLine(a, 0, { title: "Título antigo", at: now - 1000 }), savedLine(a, 1, { trackId: "não é um id", title: "Outra", at: now })]);
  const asked: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname === "/api/tracks/summary") asked.push(url.searchParams.get("ids")!);
  });
  await page.goto("/");
  await expect(cards(page).locator("b")).toHaveText(["Outra", "Título Novo"]);
  await expect(cards(page).first()).not.toHaveAttribute("href", /.*/);
  await expect(cards(page).first()).toContainText("Música indisponível");
  expect(asked).toEqual([a.id]);
});
