import { randomInt } from "node:crypto";
import type { Locator, Page, Route } from "@playwright/test";
import { expect, login, PASSWORD, test, upload, uploadFixture, USERNAME, visit } from "./helpers.ts";

test.use({ locale: "pt-BR" });

const tiles = (page: Page) => page.locator("a[data-recent]");
const ids = (page: Page) => tiles(page).evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-id")));
const empty = (page: Page) => page.locator("[data-recents-empty]");
const signInDialog = (page: Page) => page.locator("dialog[data-sign-in-dialog]");

test("a new listener sees the empty state and Entrar", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-home-view]")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ouvidas recentemente" })).toBeVisible();
  await expect(empty(page)).toHaveText("As músicas que você abrir por um link aparecem aqui.");
  await expect(page.locator("[data-clear-recents]")).toHaveCount(0);
  await expect(page.locator("[data-sign-in]")).toHaveText("Entrar");
  await expect(page.locator("[data-drop]")).toHaveCount(0);
});

test("opened songs appear newest first", async ({ page, request }) => {
  const a = await upload(request, "Primeira Faixa", "Ana");
  const b = await upload(request, "Segunda Faixa", "Beto");
  await visit(page, a);
  await visit(page, b);
  await page.goto("/");
  await expect(tiles(page)).toHaveCount(2);
  expect(await ids(page)).toEqual([b.id, a.id]);
  await expect(tiles(page).first()).toContainText("Segunda Faixa");
  await expect(tiles(page).first()).toContainText("Beto");
  await expect(tiles(page).nth(1)).toContainText("Primeira Faixa");
  await expect(page.getByRole("link", { name: "Primeira Faixa — Ana" })).toHaveAttribute("href", `/t/${a.id}`);
  await tiles(page).nth(1).click();
  await expect(page).toHaveURL(new RegExp(`/t/${a.id}$`));
});

test("the player's Início tab leads to the listener home", async ({ page, request }) => {
  const a = await upload(request, "Faixa de Ida");
  await visit(page, a);
  await page.locator('[data-nav] a[data-tab="home"]').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("[data-home-view]")).toBeVisible();
  await expect(tiles(page)).toHaveCount(1);
});

test("a deleted song drops off after the summary refresh", async ({ page, request }) => {
  const a = await upload(request, "Vai Sumir");
  const b = await upload(request, "Fica Aqui");
  await visit(page, a);
  await visit(page, b);
  await page.route("**/api/tracks/summary*", async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { tracks: Array<{ id: string }>; translationEnabled: boolean };
    await route.fulfill({ response: res, json: { ...body, tracks: body.tracks.filter((t) => t.id !== a.id) } });
  });
  await page.goto("/");
  await expect(tiles(page)).toHaveCount(1);
  expect(await ids(page)).toEqual([b.id]);
});

test("a renamed song shows its new title", async ({ page, request }) => {
  const a = await upload(request, "Nome Antigo");
  await visit(page, a);
  await page.route("**/api/tracks/summary*", async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { tracks: Array<{ id: string; title: string }>; translationEnabled: boolean };
    await route.fulfill({
      response: res,
      json: { ...body, tracks: body.tracks.map((t) => (t.id === a.id ? { ...t, title: "Nome Novo" } : t)) },
    });
  });
  await page.goto("/");
  await expect(tiles(page).first()).toContainText("Nome Novo");
  await expect(tiles(page).first()).not.toContainText("Nome Antigo");
});

test("a home restored from the back/forward cache loads again", async ({ page, request, context }) => {
  // Playwright's Chromium runs with the back/forward cache off, so the test sends the pageshow
  // event a restore fires, after another tab changed the history and the server renamed a song.
  const a = await upload(request, "Primeira Ida");
  const b = await upload(request, "Segunda Ida");
  await visit(page, a);
  await page.goto("/");
  await expect(tiles(page)).toHaveCount(1);
  const other = await context.newPage();
  await visit(other, b);
  await other.close();
  await page.route("**/api/tracks/summary*", async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { tracks: Array<{ id: string; title: string }>; translationEnabled: boolean };
    await route.fulfill({
      response: res,
      json: { ...body, tracks: body.tracks.map((t) => (t.id === a.id ? { ...t, title: "Primeira Renomeada" } : t)) },
    });
  });
  const pageshow = (persisted: boolean) =>
    page.evaluate((persisted) => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted })), persisted);

  await pageshow(false); // an ordinary load: renderHome already did the work
  await expect(tiles(page)).toHaveCount(1);
  await pageshow(true);
  await expect(tiles(page)).toHaveCount(2);
  expect(await ids(page)).toEqual([b.id, a.id]);
  await expect(tiles(page).nth(1)).toContainText("Primeira Renomeada"); // from the summaries
});

test("Limpar histórico empties the list", async ({ page, request }) => {
  const a = await upload(request, "Para Limpar");
  await visit(page, a);
  await page.goto("/");
  await expect(tiles(page)).toHaveCount(1);
  await page.locator("[data-clear-recents]").click();
  await expect(page.locator("[data-toast]")).toHaveText("Histórico apagado");
  await expect(empty(page)).toBeVisible();
  await expect(tiles(page)).toHaveCount(0);
  await expect(page.locator("[data-clear-recents]")).toHaveCount(0);
  await page.reload();
  await expect(empty(page)).toBeVisible();
});

test("summary failure keeps the stored list", async ({ page, request }) => {
  const a = await upload(request, "Guardada Local");
  await visit(page, a);
  await page.route("**/api/tracks/summary**", (r) => r.abort());
  await page.goto("/");
  await expect(tiles(page)).toHaveCount(1);
  await expect(tiles(page).first()).toContainText("Guardada Local");
  await expect(page.locator("[data-toast]")).not.toHaveClass(/is-shown/);
});

test("a tile with a cover shows it, one without shows the music note", async ({ page, request }) => {
  const withCover = await upload(request, "Com Capa");
  expect(withCover.hasCover).toBe(true);
  const plain = await uploadFixture(request, "Letra Fixtures - Sem Tags.mp3");
  expect(plain.hasCover).toBe(false);
  await visit(page, withCover);
  await visit(page, plain);
  await page.goto("/");
  await expect(tiles(page)).toHaveCount(2);
  const coverTile = page.locator(`a[data-recent][data-id="${withCover.id}"]`);
  const plainTile = page.locator(`a[data-recent][data-id="${plain.id}"]`);
  await expect(coverTile.locator("img")).toHaveAttribute("src", `/media/${withCover.id}/cover.jpg`);
  await expect(coverTile.locator("img")).toHaveAttribute("loading", "lazy");
  await expect(plainTile.locator("img")).toHaveCount(0);
  await expect(plainTile.locator(".icon")).toHaveCount(1);
});

test("blocked storage: the player plays and the home is empty", async ({ page, request }) => {
  const a = await upload(request, "Sem Armazenamento");
  const errors: Error[] = [];
  page.on("pageerror", (e) => errors.push(e));
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
  });
  await visit(page, a);
  await page.locator("[data-play]").click();
  await expect(page.locator("[data-play]")).toHaveAttribute("aria-label", "Pausar");
  await page.goto("/");
  await expect(empty(page)).toBeVisible();
  expect(errors).toEqual([]);
});

test("owner signs in from the dialog and gets the upload view", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}` });
  await page.goto("/");
  let navigations = 0;
  page.on("framenavigated", () => navigations++);
  await page.locator("[data-sign-in]").click();
  const dialog = signInDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Usuário")).toBeFocused();

  await dialog.getByLabel("Usuário").fill(USERNAME);
  await dialog.getByLabel("Senha").fill("errada");
  await dialog.getByRole("button", { name: "Entrar" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Usuário ou senha inválidos.");
  await expect(dialog.getByLabel("Senha")).toBeFocused();

  await dialog.getByLabel("Senha").fill(PASSWORD);
  await dialog.getByLabel("Senha").press("Enter");
  await expect(page.locator(".upload [data-drop]")).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("[data-home-view]")).toHaveCount(0);
  expect(navigations).toBe(0);
});

test("Esc closes the sign-in dialog and focus returns to Entrar", async ({ page }) => {
  await page.goto("/");
  await page.locator("[data-sign-in]").click();
  await expect(signInDialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(signInDialog(page)).toHaveCount(0);
  await expect(page.locator("[data-sign-in]")).toBeFocused();
});

test("a click in the sign-in dialog's padding keeps it open; the backdrop closes it", async ({ page }) => {
  await page.goto("/");
  await page.locator("[data-sign-in]").click();
  const dialog = signInDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Senha").fill("digitada");
  // The left padding, level with the title: inside the dialog, outside every control.
  await dialog.click({ position: { x: 12, y: 48 } });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Senha")).toHaveValue("digitada");
  await page.mouse.click(4, 4);
  await expect(dialog).toHaveCount(0);
});

test("phone side padding is 24 px", async ({ page, request }) => {
  const a = await upload(request, "Faixa Estreita");
  await visit(page, a);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(tiles(page)).toHaveCount(1);
  const box = await tiles(page).first().boundingBox();
  expect(box?.x).toBe(24);
});

test("home type follows the spec's sizes", async ({ page, request }) => {
  const a = await upload(request, "Faixa do Tipo", "Artista do Tipo");
  await visit(page, a);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(tiles(page)).toHaveCount(1);
  const type = (locator: Locator) =>
    locator.evaluate((n) => {
      const s = getComputedStyle(n);
      return `${s.fontSize}/${s.lineHeight} ${s.fontWeight}`;
    });
  const heading = page.getByRole("heading", { name: "Ouvidas recentemente" });
  expect(await type(heading)).toBe("24px/28px 700");
  expect(await type(tiles(page).first().locator(".home-title"))).toBe("14px/20px 600");
  expect(await type(tiles(page).first().locator(".home-artist"))).toBe("14px/20px 500");
  await expect(tiles(page).first().locator(".home-artist")).toHaveCSS("color", "rgb(175, 175, 182)"); // --text-2
  expect(await type(page.locator("[data-sign-in]"))).toBe("14px/22px 500");
  expect(await type(page.locator("[data-clear-recents]"))).toBe("14px/22px 500");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await type(heading)).toBe("22px/26px 700");
});

test("no horizontal scroll at 360 px", async ({ page, request }) => {
  const a = await upload(request, "Um Título Muito Longo Que Precisa Cortar Com Reticências Na Linha", "Artista Também Com Nome Bem Comprido Aqui");
  await visit(page, a);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/");
  await expect(tiles(page)).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

// --- the owner hint: the listener home draws at once unless this browser is the owner's ---

const OWNER_HINT = "letra.owner.v1";
const hint = (page: Page) => page.evaluate((key) => localStorage.getItem(key), OWNER_HINT);

test("a listener with no hint sees the home before the session check answers", async ({ page }) => {
  const held: Route[] = [];
  await page.route("**/api/session", (route) => {
    held.push(route);
  });
  await page.goto("/");
  await expect(page.locator("[data-home-view]")).toBeVisible();
  expect(held.length).toBe(1); // still unanswered
  for (const route of held.splice(0)) await route.continue();
  await expect(page.locator("[data-home-view]")).toBeVisible();
  expect(await hint(page)).toBeNull();
});

test("a signed-in owner who reloads never sees the listener home first; Sair clears the hint", async ({ page }) => {
  await login(page.request);
  await page.goto("/"); // no hint yet: the home first, then the session check says owner
  await expect(page.locator("[data-drop]")).toBeVisible();
  await expect(page.locator("[data-home-view]")).toHaveCount(0);
  expect(await hint(page)).not.toBeNull();

  await page.addInitScript(() => {
    const w = window as unknown as { __homeSeen: boolean };
    w.__homeSeen = false;
    new MutationObserver(() => {
      if (document.querySelector("[data-home-view]")) w.__homeSeen = true;
    }).observe(document, { subtree: true, childList: true });
  });
  await page.route("**/api/session", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.continue();
  });
  await page.reload();
  await expect(page.locator("[data-drop]")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __homeSeen: boolean }).__homeSeen)).toBe(false);

  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page.locator("[data-home-view]")).toBeVisible();
  expect(await hint(page)).toBeNull();
});

test("a session that ended clears the hint", async ({ page, context }) => {
  await login(page.request);
  await page.goto("/");
  await expect(page.locator("[data-drop]")).toBeVisible();
  expect(await hint(page)).not.toBeNull();
  await context.clearCookies();
  await page.reload(); // the hint waits for the session check, which now says signed out
  await expect(page.locator("[data-home-view]")).toBeVisible();
  expect(await hint(page)).toBeNull();
});
