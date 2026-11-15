import type { Locator, Page, Request } from "@playwright/test";
import type { SavedLine } from "../../web/shared/saved.ts";
import { expect, savedLine, seedSaved, setLyrics, test, uploadFixture } from "./helpers.ts";

test.use({ locale: "pt-BR" });

const ENABLED_KEY = "letra.translation.enabled.v1";
const button = (page: Page) => page.locator("[data-translate]");
const menu = (page: Page) => page.getByRole("menu", { name: "Traduzir linha" });
const radio = (page: Page, name: "Português" | "Inglês") => menu(page).locator(`[role="menuitemradio"][data-lang="${name === "Português" ? "pt-BR" : "en"}"]`);
const hide = (page: Page) => menu(page).getByRole("menuitem", { name: "Ocultar tradução" });
const translation = (page: Page) => page.locator("[data-line-translation]");

const stored = (page: Page): Promise<SavedLine[]> =>
  page.evaluate(() => JSON.parse(localStorage.getItem("letra.saved.v1") ?? "[]") as SavedLine[]);

const isLineRoute = (req: Request) => new URL(req.url()).pathname.endsWith("/translation/line");

/** Every request to the line route this page makes from now on. */
const lineRequests = (page: Page) => {
  const asked: URL[] = [];
  page.on("request", (req) => {
    if (isLineRoute(req)) asked.push(new URL(req.url()));
  });
  return asked;
};

/** Two frames: enough for the page to handle what it has been given. */
const frames = (page: Page) => page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));

const summaryAnswered = (page: Page) => page.waitForResponse((r) => new URL(r.url()).pathname === "/api/tracks/summary");

/** Holds the summary route until the returned function is called. */
async function holdSummary(page: Page): Promise<() => void> {
  let release = () => {};
  const held = new Promise<void>((done) => (release = done));
  await page.route("**/api/tracks/summary*", async (route) => {
    await held;
    await route.continue();
  });
  return release;
}

test("a row of a song the server has gets a translate button; a row of a gone song does not", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  const b = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0), savedLine(b, 1)]);
  expect((await request.delete(`/api/tracks/${b.id}`)).ok()).toBe(true);
  await page.goto("/salvas");
  await expect(page.locator("[data-song].is-gone")).toHaveCount(1);
  const row = page.locator(`[data-line][data-track="${a.id}"]`);
  await expect(page.locator(`[data-line][data-track="${b.id}"] [data-translate]`)).toHaveCount(0);

  const translate = row.getByRole("button", { name: "Traduzir linha" });
  await expect(translate).toBeVisible();
  const id = await translate.getAttribute("aria-describedby");
  expect(id).toBeTruthy();
  await expect(page.locator(`[id="${id}"]`)).toHaveText("Primeiro verso da música");
  await expect(translate).toHaveAttribute("aria-haspopup", "menu");
  await expect(translate).toHaveAttribute("aria-expanded", "false");
  const box = (await translate.boundingBox())!;
  expect([box.width, box.height]).toEqual([44, 44]);

  await row.locator("[data-line-link]").focus();
  await page.keyboard.press("Tab");
  await expect(translate).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(row.locator("[data-remove]")).toBeFocused();
});

test("the button opens a menu of two languages", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0)]);
  await page.goto("/salvas");
  const color = () => button(page).evaluate((n) => getComputedStyle(n).color);
  await expect(button(page)).toBeVisible();
  expect(await color()).toBe("rgba(175, 175, 182, 0.8)");

  await button(page).click();
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).getByRole("menuitemradio")).toHaveText(["Português", "Inglês"]);
  await expect(hide(page)).toHaveCount(0);
  await expect(button(page)).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("[data-line]")).toHaveClass(/\bhas-menu\b/);
  await expect(radio(page, "Português")).toBeFocused();
  await expect.poll(color).toBe("rgb(255, 255, 255)");
});

test("the lyric's language is disabled and says why", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0, { lang: "pt-BR" })]);
  const asked = lineRequests(page);
  await page.goto("/salvas");
  await button(page).click();
  await expect(radio(page, "Português")).toHaveAttribute("aria-disabled", "true");
  await expect(radio(page, "Português")).toContainText("Idioma da letra");
  await expect(radio(page, "Português").locator("small.menu-note")).toHaveText("Idioma da letra");
  await expect(radio(page, "Inglês")).not.toHaveAttribute("aria-disabled", "true");
  await expect(radio(page, "Inglês")).toBeFocused();
  await radio(page, "Português").click({ force: true });
  await frames(page);
  expect(asked).toHaveLength(0);
  await expect(menu(page)).toBeVisible();

  await page.evaluate((line) => localStorage.setItem("letra.saved.v1", JSON.stringify([line])), savedLine(a, 0, { lang: "en-US" }));
  await page.reload();
  await button(page).click();
  await expect(radio(page, "Inglês")).toHaveAttribute("aria-disabled", "true");
  await expect(radio(page, "Inglês")).toContainText("Idioma da letra");
  await expect(radio(page, "Português")).not.toHaveAttribute("aria-disabled", "true");

  await page.evaluate((line) => localStorage.setItem("letra.saved.v1", JSON.stringify([line])), savedLine(a, 0, { lang: null }));
  await page.reload();
  await button(page).click();
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).locator('[aria-disabled="true"]')).toHaveCount(0);
  await expect(menu(page).locator(".menu-note")).toHaveCount(0);
});

test("the menu works from the keyboard", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0, { lang: "pt-BR" })]);
  await page.goto("/salvas");
  await button(page).focus();
  await page.keyboard.press("Enter");
  await expect(menu(page)).toBeVisible();
  await expect(radio(page, "Inglês")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(radio(page, "Português")).toBeFocused(); // the disabled row is in the order, and the order wraps
  await page.keyboard.press("ArrowDown");
  await expect(radio(page, "Inglês")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(radio(page, "Português")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(radio(page, "Inglês")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu(page)).toBeHidden();
  await expect(button(page)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu(page)).toBeVisible();
});

test("a press outside and focus leaving close the menu", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0)]);
  await page.goto("/salvas");
  await button(page).click();
  await expect(menu(page)).toBeVisible();
  await page.locator("h1").click();
  await expect(menu(page)).toBeHidden();
  await expect(button(page)).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("[data-line]")).not.toHaveClass(/\bhas-menu\b/);

  await button(page).click();
  await expect(menu(page)).toBeVisible();
  await page.locator('[data-tab="home"]').focus();
  await expect(menu(page)).toBeHidden();
});

/** Opens the first row's menu and chooses Português, then waits for the translation. */
async function translateFirst(page: Page): Promise<void> {
  await button(page).click();
  await radio(page, "Português").click();
  await expect(translation(page)).toHaveText("[pt-BR] Primeiro verso da música");
}

test("choosing Português translates the line, shows it and keeps it", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0)]);
  const asked = lineRequests(page);
  await page.goto("/salvas");
  await translateFirst(page);
  await expect(translation(page)).toHaveAttribute("lang", "pt-BR");
  expect(asked).toHaveLength(1);
  expect(asked[0]!.searchParams.get("index")).toBe("0");
  expect(asked[0]!.searchParams.get("lang")).toBe("pt-BR");
  expect(asked[0]!.searchParams.get("text")).toBe("Primeiro verso da música");
  const [record] = await stored(page);
  expect(record!.tr).toEqual({ lang: "pt-BR", text: "[pt-BR] Primeiro verso da música" });
  expect(record!.lang).toBe("en");
  await expect(button(page)).toBeFocused();
  await expect(button(page)).toHaveClass(/\bis-on\b/);
});

test("the translation is there after a reload, with a check on its language", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0)]);
  await page.goto("/salvas");
  await translateFirst(page);
  const asked = lineRequests(page);
  await page.reload();
  await expect(translation(page)).toHaveText("[pt-BR] Primeiro verso da música");
  await button(page).click();
  await expect(radio(page, "Português")).toHaveAttribute("aria-checked", "true");
  await expect(radio(page, "Inglês")).toHaveAttribute("aria-disabled", "true");
  const last = menu(page).locator(".menu-row").last();
  await expect(last).toHaveText("Ocultar tradução");
  await expect(last).toHaveAttribute("role", "menuitem");
  expect(asked).toHaveLength(0);
});

test("choosing the language in use asks nothing", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0, { tr: { lang: "pt-BR", text: "Tradução guardada" } })]);
  const asked = lineRequests(page);
  await page.goto("/salvas");
  await button(page).click();
  await expect(radio(page, "Português")).toHaveAttribute("aria-checked", "true");
  await radio(page, "Português").click();
  await expect(menu(page)).toBeHidden();
  await expect(button(page)).toBeFocused();
  await frames(page);
  expect(asked).toHaveLength(0);
  await expect(translation(page)).toHaveText("Tradução guardada");
});

test("Ocultar tradução clears it", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0, { tr: { lang: "pt-BR", text: "Tradução guardada" } })]);
  await page.goto("/salvas");
  await expect(button(page)).toHaveClass(/\bis-on\b/);
  await button(page).click();
  await hide(page).click();
  await expect(translation(page)).toHaveCount(0);
  expect((await stored(page))[0]!.tr).toBeNull();
  await expect(button(page)).not.toHaveClass(/\bis-on\b/);
  await expect(button(page)).toBeFocused();
});

test("markup in a translation is drawn as text", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0)]);
  const text = "<b>oi</b> & tchau";
  await page.route("**/translation/line*", (route) => route.fulfill({ json: { lang: "pt-BR", sourceLang: "en", sameLanguage: false, text } }));
  await page.goto("/salvas");
  await button(page).click();
  await radio(page, "Português").click();
  await expect(translation(page)).toHaveCount(1);
  expect(await translation(page).evaluate((n) => n.textContent)).toBe(text);
  await expect(page.locator(".saved-line b")).toHaveCount(0);
});

test("the menu covers the next row's buttons", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0), savedLine(a, 1)]);
  await page.goto("/salvas");
  await button(page).first().click();
  await expect(menu(page)).toBeVisible();
  const second = radio(page, "Inglês");
  await expect.poll(() => menu(page).evaluate((n) => getComputedStyle(n).scale)).toBe("1");
  const box = (await second.boundingBox())!;
  const inside = await menu(page).evaluate(
    (n, p) => n.contains(document.elementFromPoint(p.x, p.y)),
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect(inside).toBe(true);
  // Where the menu lies over the next row's buttons, the menu takes the press.
  const next = (await page.locator('[data-line][data-index="1"] [data-translate]').boundingBox())!;
  const point = { x: next.x + next.width / 2, y: next.y + next.height / 2 };
  const area = (await menu(page).boundingBox())!;
  expect(point.y).toBeGreaterThan(area.y);
  expect(point.y).toBeLessThan(area.y + area.height);
  expect(await menu(page).evaluate((n, p) => n.contains(document.elementFromPoint(p.x, p.y)), point)).toBe(true);
});

test("the menu's panel hides the rows behind it", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0), savedLine(a, 1)]);
  await page.goto("/salvas");
  await button(page).first().click();
  await expect(menu(page)).toBeVisible();
  expect(await menu(page).evaluate((n) => getComputedStyle(n).backgroundColor)).toBe("rgb(28, 28, 30)");
});

test("the menu opens upward when there is no room below", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [0, 1, 2, 3].map((i) => savedLine(a, i)));
  await page.setViewportSize({ width: 1280, height: 420 });
  await page.goto("/salvas");
  const last = page.locator("[data-line]").last();
  await expect(last.locator("[data-translate]")).toBeVisible();
  await last.evaluate((n) => n.scrollIntoView({ block: "end" }));
  await last.locator("[data-translate]").click();
  const open = last.locator(".line-menu");
  await expect(open).toBeVisible();
  await expect(open).toHaveClass(/\bis-up\b/);
  const trigger = (await last.locator("[data-translate]").boundingBox())!;
  const box = (await open.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(trigger.y);
});

test("at 360 px the menu stays inside the page", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 1)]);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/salvas");
  await button(page).click();
  await expect(menu(page)).toBeVisible();
  await expect.poll(() => menu(page).evaluate((n) => getComputedStyle(n).scale)).toBe("1");
  const box = (await menu(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(360);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("a click on the translate button or in its menu does not open the song", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0)]);
  await page.goto("/salvas");
  await button(page).click();
  await expect(menu(page)).toBeVisible();
  await expect(page).toHaveURL(/\/salvas$/);
  await radio(page, "Inglês").click();
  await expect(menu(page)).toBeHidden();
  await frames(page);
  await expect(page).toHaveURL(/\/salvas$/);
});

test("the buttons are there at once on a later visit", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0)]);
  await page.goto("/salvas");
  await expect(button(page)).toBeVisible();
  const release = await holdSummary(page);
  await page.reload();
  await expect(button(page)).toBeVisible();
  const answered = summaryAnswered(page);
  release();
  await answered;
});

test("the page follows the server when translation goes off", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0)]);
  await page.goto("/salvas");
  await expect(button(page)).toBeVisible();
  await page.route("**/api/tracks/summary*", async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as Record<string, unknown>;
    await route.fulfill({ response: res, json: { ...body, translationEnabled: false } });
  });
  await page.reload();
  await expect(button(page)).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), ENABLED_KEY)).toBe("0");
});

test("the song details arriving do not close an open menu", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0)]);
  await page.goto("/salvas");
  await expect(button(page)).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), ENABLED_KEY)).toBe("1");
  const release = await holdSummary(page);
  await page.reload();
  await button(page).click();
  await expect(menu(page)).toBeVisible();
  const answered = summaryAnswered(page);
  release();
  await answered;
  await frames(page);
  await expect(menu(page)).toBeVisible();
  expect(await menu(page).evaluate((n) => n.contains(document.activeElement))).toBe(true);
});

test("another tab's change closes the menu and keeps focus on the button", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0), savedLine(a, 1)]);
  await page.goto("/salvas");
  const second = page.locator('[data-line][data-index="1"] [data-translate]');
  await second.click();
  await expect(menu(page)).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new StorageEvent("storage", { key: "letra.saved.v1" })));
  await expect(menu(page)).toHaveCount(0);
  await expect(second).toBeFocused();
});

test("a translation saved from the player in another language can be hidden", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0, { tr: { lang: "es", text: "Primer verso" } })]);
  await page.goto("/salvas");
  await expect(translation(page)).toHaveText("Primer verso");
  await expect(translation(page)).toHaveAttribute("lang", "es");
  await expect(button(page)).toHaveClass(/\bis-on\b/);
  await button(page).click();
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).locator('[aria-checked="true"]')).toHaveCount(0);
  await hide(page).click();
  await expect(translation(page)).toHaveCount(0);
  expect((await stored(page))[0]!.tr).toBeNull();
});

// --- a row's states while and after translating ---------------------------------------------------

const busy = (page: Page) => page.locator("[data-line-busy]");
const note = (page: Page) => page.locator("[data-line-note]");
const retry = (page: Page) => page.getByRole("button", { name: "Tentar de novo" });
const status = (page: Page) => page.locator("[data-translate-status]");
const toastEl = (page: Page) => page.locator("[data-toast]");
const FAILED = "Não foi possível traduzir agora.";

/** Opens the row's menu and chooses a language. */
async function pick(page: Page, name: "Português" | "Inglês", row: Locator = page.locator("[data-line]").first()): Promise<void> {
  await row.locator("[data-translate]").click();
  await radio(page, name).click();
}

/** Holds the line route (only the requests `which` picks, all by default) until the returned function is called. */
async function holdLine(page: Page, which: (url: URL) => boolean = () => true): Promise<() => void> {
  let release = () => {};
  const held = new Promise<void>((done) => (release = done));
  await page.route("**/translation/line*", async (route) => {
    if (which(new URL(route.request().url()))) await held;
    await route.fallback();
  });
  return release;
}

/** Answers the line route's next request with a 503, then lets the rest through. */
async function failOnce(page: Page): Promise<void> {
  let failed = false;
  await page.route("**/translation/line*", async (route) => {
    if (failed) return route.fallback();
    failed = true;
    await route.fulfill({ status: 503, json: { error: { code: "translation_unavailable", message: "Tradução indisponível agora." } } });
  });
}

const lineAnswered = (page: Page, lang?: string) =>
  page.waitForResponse((r) => isLineRoute(r.request()) && (lang === undefined || new URL(r.url()).searchParams.get("lang") === lang));

test("a row with nothing to say keeps its height", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0)]);
  for (const [width, height, tall] of [[1440, 900, 72], [390, 844, 90]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("/salvas");
    await expect(button(page)).toBeVisible();
    expect(await page.locator("[data-line]").first().evaluate((n) => n.getBoundingClientRect().height)).toBe(tall);
  }
});

test("while the request runs the row says it is translating", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0, { lang: null, tr: { lang: "es", text: "Primer verso" } })]);
  const release = await holdLine(page);
  await page.goto("/salvas");
  await pick(page, "Português");
  await expect(busy(page)).toHaveText("Traduzindo para português…");
  await expect(translation(page)).toHaveCount(0);
  await expect(button(page)).toHaveClass(/\bis-on\b/);
  release();
  await expect(translation(page)).toHaveText("[pt-BR] Primeiro verso da música");
  await expect(busy(page)).toHaveCount(0);
});

test("the translating text stays at least 300 ms", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0)]);
  await page.clock.install({ time: new Date(2026, 10, 10, 15, 0) });
  await page.goto("/salvas");
  await expect(button(page)).toBeVisible();
  await page.clock.pauseAt(new Date(2026, 10, 10, 16, 0));
  const answered = lineAnswered(page);
  await pick(page, "Português");
  await answered;
  await page.clock.runFor(299);
  await expect(busy(page)).toHaveText("Traduzindo para português…");
  await expect(translation(page)).toHaveCount(0);
  await page.clock.runFor(1);
  await expect(translation(page)).toHaveText("[pt-BR] Primeiro verso da música");
  await expect(busy(page)).toHaveCount(0);
});

test("a failure shows the text and Tentar de novo, and trying again translates", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0)]);
  await failOnce(page);
  const asked = lineRequests(page);
  await page.goto("/salvas");
  await pick(page, "Português");
  await expect(note(page)).toContainText(FAILED);
  await expect(retry(page)).toBeVisible();
  expect((await retry(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(busy(page)).toHaveCount(0);
  expect((await stored(page))[0]!.tr).toBeNull();
  const textId = await page.locator("[data-line] [data-line-text]").first().getAttribute("id");
  expect(textId).toBeTruthy();
  await expect(retry(page)).toHaveAttribute("aria-describedby", textId!);

  await retry(page).click();
  await expect(translation(page)).toHaveText("[pt-BR] Primeiro verso da música");
  await expect(note(page)).toHaveCount(0);
  expect(asked).toHaveLength(2);
  expect(asked[1]!.searchParams.get("lang")).toBe("pt-BR");
  await expect(button(page)).toBeFocused();
});

test("a dropped connection and too many requests read the same", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0), savedLine(a, 1)]);
  let n = 0;
  await page.route("**/translation/line*", (route) =>
    ++n === 1 ? route.abort("connectionreset") : route.fulfill({ status: 429, json: { error: { code: "rate_limited", message: "Muitas tentativas." } } }),
  );
  await page.goto("/salvas");
  const rows = page.locator("[data-line]");
  await pick(page, "Português", rows.nth(0));
  await expect(rows.nth(0).locator("[data-line-note]")).toContainText(FAILED);
  await expect(rows.nth(0).getByRole("button", { name: "Tentar de novo" })).toBeVisible();
  await pick(page, "Português", rows.nth(1));
  await expect(rows.nth(1).locator("[data-line-note]")).toContainText(FAILED);
  await expect(rows.nth(1).getByRole("button", { name: "Tentar de novo" })).toBeVisible();
});

test("Inglês on lyrics in English says so and corrects the record", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  const tr = { lang: "pt-BR", text: "Tradução guardada" };
  await seedSaved(page, [savedLine(a, 0, { lang: null, tr })]);
  await page.goto("/salvas");
  await pick(page, "Inglês");
  await expect(note(page)).toHaveText("Esta linha já está em inglês.");
  await expect(retry(page)).toHaveCount(0);
  await expect(translation(page)).toHaveCount(0);
  const [record] = await stored(page);
  expect(record!.lang).toBe("en");
  expect(record!.tr).toEqual(tr);
  await button(page).click();
  await expect(radio(page, "Inglês")).toHaveAttribute("aria-disabled", "true");
  await expect(radio(page, "Inglês")).toContainText("Idioma da letra");
});

test("a line that changed in the song says so", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0)]);
  await setLyrics(request, a, "Outra letra");
  await page.goto("/salvas");
  await pick(page, "Português");
  await expect(note(page)).toHaveText("Esta linha mudou na música e não pode ser traduzida.");
  await expect(retry(page)).toHaveCount(0);
  expect((await stored(page))[0]!.tr).toBeNull();
});

test("a note does not touch a stored translation", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  const tr = { lang: "pt-BR", text: "Tradução guardada" };
  await seedSaved(page, [savedLine(a, 0, { lang: null, tr })]);
  await failOnce(page);
  await page.goto("/salvas");
  await expect(translation(page)).toHaveText("Tradução guardada");
  await pick(page, "Inglês");
  await expect(note(page)).toContainText(FAILED);
  await expect(translation(page)).toHaveCount(0);
  expect((await stored(page))[0]!.tr).toEqual(tr);
  await page.reload();
  await expect(translation(page)).toHaveText("Tradução guardada");
  await expect(note(page)).toHaveCount(0);
});

test("a note and the translating text survive the page being drawn again", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0)]);
  let release = () => {};
  const held = new Promise<void>((done) => (release = done));
  let n = 0;
  await page.route("**/translation/line*", async (route) => {
    if (++n === 1) return route.fulfill({ status: 503, json: { error: { code: "translation_unavailable", message: "Tradução indisponível agora." } } });
    await held;
    await route.fallback();
  });
  const redraw = () => page.evaluate(() => window.dispatchEvent(new StorageEvent("storage", { key: "letra.saved.v1" })));
  await page.goto("/salvas");
  await pick(page, "Português");
  await expect(note(page)).toContainText(FAILED);
  const first = await page.locator("[data-line]").elementHandle();
  await redraw();
  await expect.poll(() => first!.evaluate((n) => n.isConnected)).toBe(false);
  await expect(note(page)).toContainText(FAILED);
  await expect(retry(page)).toBeVisible();

  await retry(page).click();
  await expect(busy(page)).toHaveText("Traduzindo para português…");
  const second = await page.locator("[data-line]").elementHandle();
  await redraw();
  await expect.poll(() => second!.evaluate((n) => n.isConnected)).toBe(false);
  await expect(busy(page)).toHaveText("Traduzindo para português…");
  release();
  await expect(translation(page)).toHaveText("[pt-BR] Primeiro verso da música");
  await expect(busy(page)).toHaveCount(0);
  await expect(page.locator("[data-line]")).toHaveCount(1);
});

test("a newer choice wins", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0, { lang: null })]);
  const release = await holdLine(page, (url) => url.searchParams.get("lang") === "pt-BR");
  await page.goto("/salvas");
  await pick(page, "Português");
  await expect(busy(page)).toHaveText("Traduzindo para português…");
  await pick(page, "Inglês");
  await expect(note(page)).toHaveText("Esta linha já está em inglês.");
  const answered = lineAnswered(page, "pt-BR");
  release();
  await answered;
  await frames(page);
  await expect(note(page)).toHaveText("Esta linha já está em inglês.");
  await expect(translation(page)).toHaveCount(0);
  expect((await stored(page))[0]!.tr).toBeNull();
});

test("a line removed while it translates leaves nothing behind", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0)]);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const release = await holdLine(page);
  await page.clock.install({ time: new Date(2026, 10, 10, 15, 0) });
  await page.goto("/salvas");
  await expect(button(page)).toBeVisible();
  await page.clock.pauseAt(new Date(2026, 10, 10, 16, 0));
  await pick(page, "Português");
  await expect(busy(page)).toBeVisible();
  await page.locator("[data-remove]").click();
  await page.clock.runFor(1000); // the row's fade
  await expect(page.locator("[data-line]")).toHaveCount(0);
  const answered = lineAnswered(page);
  release();
  await answered;
  await page.clock.runFor(1000);
  await page.evaluate(() => 0);
  expect(await stored(page)).toEqual([]);
  await expect(page.locator("[data-line]")).toHaveCount(0);
  await expect(status(page)).toHaveText("");
  expect(errors).toEqual([]);
});

test("the result is announced", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0, { lang: null }), savedLine(a, 1, { lang: null })]);
  await page.goto("/salvas");
  await expect(status(page)).toHaveCount(1);
  await expect(status(page)).toHaveAttribute("role", "status");
  await expect(status(page)).toHaveAttribute("aria-live", "polite");
  await expect(status(page)).toHaveText("");

  const rows = page.locator("[data-line]");
  await pick(page, "Português", rows.nth(0));
  await expect(status(page)).toHaveText("[pt-BR] Primeiro verso da música");
  await expect(status(page)).toHaveAttribute("lang", "pt-BR");

  await failOnce(page);
  await pick(page, "Inglês", rows.nth(1));
  await expect(status(page)).toHaveText(FAILED);
  await rows.nth(1).getByRole("button", { name: "Tentar de novo" }).click();
  await expect(status(page)).toHaveText("Esta linha já está em inglês.");
});

test("a translation the browser can not keep shows the toast", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0)]);
  await page.goto("/salvas");
  await expect(button(page)).toBeVisible();
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
  });
  await pick(page, "Português");
  await expect(toastEl(page)).toHaveText("Não foi possível salvar neste navegador.");
  await expect(busy(page)).toHaveCount(0);
  await expect(translation(page)).toHaveCount(0);
  await expect(note(page)).toHaveCount(0);
});

test("Ocultar tradução clears a note too", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0, { lang: null, tr: { lang: "pt-BR", text: "Tradução guardada" } })]);
  await failOnce(page);
  await page.goto("/salvas");
  await pick(page, "Inglês");
  await expect(note(page)).toContainText(FAILED);
  await button(page).click();
  await hide(page).click();
  await expect(note(page)).toHaveCount(0);
  await expect(translation(page)).toHaveCount(0);
  expect((await stored(page))[0]!.tr).toBeNull();
});

test("the whole path from the keyboard", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0)]);
  await page.goto("/salvas");
  await page.locator("[data-line-link]").focus();
  await page.keyboard.press("Tab");
  await expect(button(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(radio(page, "Português")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(button(page)).toBeFocused();
  await expect(translation(page)).toHaveText("[pt-BR] Primeiro verso da música");
  await expect(status(page)).toHaveText("[pt-BR] Primeiro verso da música");
  await expect(button(page)).toBeFocused();
});

test("on a phone the translation and the note are 14 px", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0, { tr: { lang: "pt-BR", text: "Tradução guardada" } }), savedLine(a, 1, { lang: null })]);
  await failOnce(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/salvas");
  const rows = page.locator("[data-line]");
  await pick(page, "Português", rows.nth(1));
  await expect(note(page)).toContainText(FAILED);
  const size = (n: Element) => getComputedStyle(n).fontSize;
  expect(await translation(page).evaluate(size)).toBe("14px");
  expect(await note(page).evaluate(size)).toBe("14px");
});

test("a click on another row while a menu is open only closes the menu", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0), savedLine(a, 3)]);
  await page.goto("/salvas");
  const rows = page.locator("[data-line]");
  await rows.nth(0).locator("[data-translate]").click();
  await expect(menu(page)).toBeVisible();
  // Near the text's start, away from the open menu, which covers the right of the rows below.
  await rows.nth(1).locator("[data-line-text]").click({ position: { x: 8, y: 8 } });
  await expect(menu(page)).toBeHidden();
  await frames(page);
  await expect(page).toHaveURL(/\/salvas$/);
  await rows.nth(1).locator("[data-line-text]").click({ position: { x: 8, y: 8 } });
  await expect(page).toHaveURL(new RegExp(`/t/${a.id}\\?t=`));
});

test("another row's translate button still opens its menu in one click", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  // Four rows, so the last row's button is clear of the first row's open menu.
  await seedSaved(page, [0, 1, 2, 3].map((i) => savedLine(a, i)));
  await page.goto("/salvas");
  const rows = page.locator("[data-line]");
  await rows.nth(0).locator("[data-translate]").click();
  await expect(rows.nth(0).locator('[role="menu"]')).toBeVisible();
  await rows.nth(3).locator("[data-translate]").click();
  await expect(rows.nth(0).locator('[role="menu"]')).toBeHidden();
  await expect(rows.nth(0).locator("[data-translate]")).toHaveAttribute("aria-expanded", "false");
  await expect(rows.nth(3).locator('[role="menu"]')).toBeVisible();
  await expect(rows.nth(3).locator("[data-translate]")).toHaveAttribute("aria-expanded", "true");
  await expect(page).toHaveURL(/\/salvas$/);
});

test("a long wait is announced", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0)]);
  const release = await holdLine(page);
  await page.clock.install({ time: new Date(2026, 10, 10, 15, 0) });
  await page.goto("/salvas");
  await expect(button(page)).toBeVisible();
  await page.clock.pauseAt(new Date(2026, 10, 10, 16, 0));
  await pick(page, "Português");
  await expect(busy(page)).toHaveText("Traduzindo para português…");
  await page.clock.runFor(999);
  await expect(status(page)).toHaveText("");
  await page.clock.runFor(1);
  await expect(status(page)).toHaveText("Traduzindo para português…");
  release();
  await expect(translation(page)).toHaveText("[pt-BR] Primeiro verso da música");
  await page.clock.runFor(100); // the announcement comes in the next frame
  await expect(status(page)).toHaveText("[pt-BR] Primeiro verso da música");
});

test("focus goes to the line's link when its translate button goes away", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0)]);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), ENABLED_KEY);
  let release = () => {};
  const held = new Promise<void>((done) => (release = done));
  await page.route("**/api/tracks/summary*", async (route) => {
    await held;
    const res = await route.fetch();
    const body = (await res.json()) as Record<string, unknown>;
    await route.fulfill({ response: res, json: { ...body, translationEnabled: false } });
  });
  await page.goto("/salvas");
  await button(page).focus();
  await expect(button(page)).toBeFocused();
  const answered = summaryAnswered(page);
  release();
  await answered;
  await expect(button(page)).toHaveCount(0);
  await expect(page.locator("[data-line] a[data-line-link]")).toBeFocused();
});

test("the translating text and the disabled row's note are readable", async ({ page, request }) => {
  const a = await uploadFixture(request, "song.mp3");
  await seedSaved(page, [savedLine(a, 0, { lang: "en" })]);
  const release = await holdLine(page);
  await page.goto("/salvas");
  await pick(page, "Português");
  await expect(busy(page)).toHaveText("Traduzindo para português…");
  const color = (n: Element) => getComputedStyle(n).color;
  expect(await busy(page).evaluate(color)).toBe("rgba(175, 175, 182, 0.85)");
  await button(page).click();
  const disabled = radio(page, "Inglês");
  await expect(disabled).toHaveAttribute("aria-disabled", "true");
  expect(await disabled.locator(".menu-note").evaluate(color)).toBe("rgba(175, 175, 182, 0.75)");
  expect(await disabled.evaluate(color)).toBe("rgba(175, 175, 182, 0.6)"); // the row's own name keeps its color
  release();
});
