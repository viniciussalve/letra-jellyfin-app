import type { Locator, Page, Route } from "@playwright/test";
import { expect, login, noFullscreenApi, PASSWORD, randomIp, savedLine, seedSaved, test, upload, USERNAME, visit } from "./helpers.ts";

test.use({ locale: "pt-BR" });

const bar = (page: Page) => page.locator("header.nav-bar[data-nav]");
const wordmark = (page: Page) => bar(page).locator(".nav-wordmark");
const nav = (page: Page) => bar(page).getByRole("navigation", { name: "Principal" });
const tab = (page: Page, id: "home" | "saved") => nav(page).locator(`a.nav-tab[data-tab="${id}"]`);
const actions = (page: Page) => bar(page).locator(".nav-actions");
const signInDialog = (page: Page) => page.locator("dialog[data-sign-in-dialog]");

const box = async (loc: Locator) => {
  const b = await loc.boundingBox();
  if (!b) throw new Error("no box");
  return b;
};

/** The look of a tab: type, colour, and its underline's height and gap under the text (none when absent). */
const tabLook = (loc: Locator) =>
  loc.evaluate((n) => {
    const s = getComputedStyle(n);
    const after = getComputedStyle(n, "::after");
    const r = n.getBoundingClientRect();
    const textBottom = r.top + r.height / 2 + parseFloat(s.lineHeight) / 2;
    const line = after.content === "none" ? null : { height: after.height, gap: r.top + parseFloat(after.top) - textBottom };
    return { type: `${s.fontSize}/${s.lineHeight} ${s.fontWeight}`, color: s.color, line };
  });

test("the home has the bar with Início current", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-home-view]")).toBeVisible();
  await expect(bar(page)).toBeVisible();
  await expect(page.locator("header.home-header")).toHaveCount(0);

  // The wordmark is the page's h1: text, not a link, not focusable.
  await expect(wordmark(page)).toHaveText("letra");
  expect(await wordmark(page).evaluate((n) => [n.tagName, n.closest("a"), n.tabIndex])).toEqual(["H1", null, -1]);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  await expect(nav(page).getByRole("link")).toHaveText(["Início", "Linhas salvas"]);
  await expect(tab(page, "home")).toHaveAttribute("href", "/");
  await expect(tab(page, "home")).toHaveAttribute("aria-current", "page");
  await expect(tab(page, "saved")).toHaveAttribute("href", "/salvas");
  await expect(tab(page, "saved")).not.toHaveAttribute("aria-current", /.*/);

  expect(await tabLook(tab(page, "home"))).toEqual({ type: "15px/20px 600", color: "rgb(255, 255, 255)", line: { height: "2px", gap: 6 } });
  expect(await tabLook(tab(page, "saved"))).toEqual({ type: "15px/20px 600", color: "rgb(175, 175, 182)", line: null });

  await expect(actions(page).locator("[data-sign-in]")).toHaveText("Entrar");
});

test("forced colours keep the current tab's underline", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  for (const path of ["/", "/salvas"]) {
    await page.goto(path);
    await expect(bar(page)).toBeVisible();
    const current = nav(page).locator('a.nav-tab[aria-current="page"]');
    const line = await current.evaluate((n) => {
      const after = getComputedStyle(n, "::after");
      return { content: after.content, border: after.borderTopWidth, style: after.borderTopStyle };
    });
    expect(line, path).toEqual({ content: '""', border: "2px", style: "solid" });
  }
});

test("/salvas has the bar with Linhas salvas current and no house icon", async ({ page }) => {
  await page.goto("/salvas");
  await expect(page.locator("[data-saved-view]")).toBeVisible();
  await expect(bar(page)).toBeVisible();

  // The page has its own h1: the wordmark is plain text.
  expect(await wordmark(page).evaluate((n) => [n.tagName, n.tabIndex])).toEqual(["SPAN", -1]);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Linhas salvas");

  await expect(tab(page, "saved")).toHaveAttribute("aria-current", "page");
  await expect(tab(page, "home")).not.toHaveAttribute("aria-current", /.*/);
  expect((await tabLook(tab(page, "saved"))).line).toEqual({ height: "2px", gap: 6 });
  expect((await tabLook(tab(page, "home"))).line).toBeNull();

  await expect(page.locator("[data-home]")).toHaveCount(0);
  await expect(page.locator('[data-icon="house"]')).toHaveCount(0);
  await expect(page.locator(".saved-home")).toHaveCount(0);
});

test("the bar sits in the same place on the home and on /salvas", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  await seedSaved(page, [savedLine(a, 1)]);
  for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    const place = async (path: string) => {
      await page.goto(path);
      await expect(actions(page).locator("[data-sign-in]")).toBeVisible();
      const parts = [wordmark(page), tab(page, "home"), tab(page, "saved")];
      return Promise.all(parts.map(async (p) => ({ x: (await box(p)).x, y: (await box(p)).y })));
    };
    expect(await place("/salvas"), `${size.width} px`).toEqual(await place("/"));
  }
});

test("the tabs are 44 px targets and the row does not scroll at 360 px", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  await seedSaved(page, [savedLine(a, 1)]);
  await page.setViewportSize({ width: 360, height: 740 });
  for (const path of ["/", "/salvas"]) {
    await page.goto(path);
    const action = actions(page).locator("[data-sign-in]");
    await expect(action).toBeVisible();
    for (const id of ["home", "saved"] as const) expect((await box(tab(page, id))).height, `${path} ${id}`).toBe(44);
    expect((await box(action)).height).toBeGreaterThanOrEqual(44);
    // One row: the wordmark, the tabs and the action share a centre line.
    const centre = async (loc: Locator) => {
      const b = await box(loc);
      return b.y + b.height / 2;
    };
    const line = await centre(tab(page, "home"));
    for (const part of [wordmark(page), tab(page, "saved"), action]) expect(Math.abs((await centre(part)) - line), path).toBeLessThanOrEqual(1);
    // Nothing of the bar runs past the screen, and the page does not scroll sideways.
    expect((await box(action)).x + (await box(action)).width).toBeLessThanOrEqual(360);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), path).toBe(true);
  }
});

test("one click from the home reaches /salvas, with or without saved lines", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator("[data-saved-section]")).toBeHidden();
  await tab(page, "saved").click();
  await expect(page).toHaveURL(/\/salvas$/);
  await expect(page.locator("[data-saved-empty]")).toBeVisible();

  const a = await upload(request, "Faixa A");
  await seedSaved(page, [savedLine(a, 1)]);
  await page.goto("/");
  await expect(page.locator("[data-saved-card]")).toHaveCount(1);
  await tab(page, "saved").click();
  await expect(page).toHaveURL(/\/salvas$/);
  await expect(page.locator("[data-line]")).toHaveCount(1);

  // And back, through the other tab.
  await tab(page, "home").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("[data-home-view]")).toBeVisible();
});

test("the home's saved-lines section has no link of its own to the page", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  await seedSaved(page, [savedLine(a, 0), savedLine(a, 1), savedLine(a, 2), savedLine(a, 3)]);
  await page.goto("/");
  const section = page.locator("[data-saved-section]");
  await expect(section.getByRole("heading", { level: 2, name: "Linhas salvas" })).toBeVisible();
  await expect(section.locator("[data-saved-card]")).toHaveCount(3);
  await expect(section.locator('a[href="/salvas"]')).toHaveCount(0);
  await expect(page.locator("[data-saved-all]")).toHaveCount(0);
  await expect(page.getByText(/Ver todas/)).toHaveCount(0);
  // The one way to the page is the tab.
  await expect(page.locator('a[href="/salvas"]')).toHaveCount(1);
  await expect(page.locator('a[href="/salvas"]')).toHaveAttribute("data-tab", "saved");
});

test("/salvas shows Entrar to a listener and Sair to the owner; signing in there stays on /salvas", async ({ page }) => {
  // Until the session check answers, the action's place is held and nothing shows in it.
  const held: Route[] = [];
  await page.route("**/api/session", (route) => {
    if (route.request().method() === "GET" && held.length === 0) held.push(route);
    else void route.continue();
  });
  await page.goto("/salvas");
  await expect(page.locator("[data-saved-view]")).toBeVisible();
  await expect.poll(() => held.length).toBe(1);
  const before = await box(actions(page));
  expect(before.width).toBeGreaterThan(0);
  expect(before.height).toBeGreaterThanOrEqual(44);
  await expect(actions(page).getByRole("button")).toHaveCount(0);
  const tabsBefore = await box(nav(page));
  await held[0]!.continue();
  await expect(actions(page).getByRole("button", { name: "Entrar" })).toBeVisible();
  expect(await box(actions(page))).toEqual(before);
  expect(await box(nav(page))).toEqual(tabsBefore);

  // Signing in stays here and turns the action into "Sair".
  await actions(page).getByRole("button", { name: "Entrar" }).click();
  await signInDialog(page).getByLabel("Usuário").fill(USERNAME);
  await signInDialog(page).getByLabel("Senha").fill(PASSWORD);
  await signInDialog(page).getByRole("button", { name: "Entrar" }).click();
  await expect(signInDialog(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/salvas$/);
  await expect(page.locator("[data-saved-view]")).toBeVisible();
  const leave = actions(page).getByRole("button", { name: "Sair" });
  await expect(leave).toBeVisible();
  await expect(leave).toBeFocused();
  await expect(actions(page).getByRole("button", { name: "Entrar" })).toHaveCount(0);

  // Signing out stays here too.
  await leave.click();
  await expect(actions(page).getByRole("button", { name: "Entrar" })).toBeVisible();
  await expect(page).toHaveURL(/\/salvas$/);
  await expect(page.locator("[data-saved-view]")).toBeVisible();
  expect((await page.request.get("/api/session").then((r) => r.json())).owner).toBe(false);
});

test("/salvas shows Sair to an owner who arrives signed in", async ({ page }) => {
  await login(page.request);
  await page.goto("/salvas");
  await expect(actions(page).getByRole("button", { name: "Sair" })).toBeVisible();
  await expect(actions(page).getByRole("button", { name: "Entrar" })).toHaveCount(0);
});

test("keyboard: the tabs come before the actions", async ({ page }) => {
  for (const path of ["/", "/salvas"]) {
    await page.goto(path);
    await expect(actions(page).locator("[data-sign-in]")).toBeVisible();
    const order: (string | null)[] = [];
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("Tab");
      order.push(await page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        return a?.dataset.tab ?? (a?.hasAttribute("data-sign-in") ? "sign-in" : (a?.tagName ?? null));
      }));
    }
    expect(order, path).toEqual(["home", "saved", "sign-in"]);
  }
});

test("the owner view has the bar with Início current and Sair at the right", async ({ page }) => {
  await login(page.request);
  await page.goto("/");
  await expect(page.locator("[data-drop]")).toBeVisible();
  await expect(bar(page)).toBeVisible();
  expect(await wordmark(page).evaluate((n) => n.tagName)).toBe("H1");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.locator(".brand, .owner-actions")).toHaveCount(0);
  await expect(nav(page).getByRole("link")).toHaveText(["Início", "Linhas salvas"]);
  await expect(tab(page, "home")).toHaveAttribute("aria-current", "page");
  await expect(tab(page, "saved")).not.toHaveAttribute("aria-current", /.*/);
  const leave = actions(page).getByRole("button", { name: "Sair" });
  await expect(leave).toBeVisible();
  const [l, t] = [await box(leave), await box(tab(page, "saved"))];
  expect(l.x).toBeGreaterThan(t.x + t.width);
});

test("the owner's home draws the bar before the session check answers", async ({ page }) => {
  await login(page.request);
  await page.addInitScript(() => localStorage.setItem("letra.owner.v1", "1")); // this browser last showed the owner view
  // The session check is held until the bar has been read.
  const held: Route[] = [];
  await page.route("**/api/session", (route) => {
    if (route.request().method() === "GET" && held.length === 0) held.push(route);
    else void route.continue();
  });
  await page.goto("/");
  await expect.poll(() => held.length).toBe(1);
  await expect(bar(page)).toBeVisible();
  await expect(bar(page)).toHaveCount(1);
  await expect(tab(page, "home")).toHaveAttribute("aria-current", "page");
  await expect(actions(page).getByRole("button")).toHaveCount(0); // the action's place is held, nothing shows in it
  await expect(page.locator("[data-home-view]")).toHaveCount(0); // the listener home is never drawn first
  const tabsBefore = await Promise.all([box(nav(page)), box(tab(page, "home")), box(tab(page, "saved"))]);
  await held[0]!.continue();
  await expect(page.locator("[data-drop]")).toBeVisible();
  await expect(bar(page)).toHaveCount(1);
  await expect(actions(page).getByRole("button", { name: "Sair" })).toBeVisible();
  expect(await Promise.all([box(nav(page)), box(tab(page, "home")), box(tab(page, "saved"))])).toEqual(tabsBefore);
});

test("/salvas → Início as the owner: the new page has the tabs when it is revealed", async ({ page }) => {
  await login(page.request);
  await page.addInitScript(() => {
    addEventListener("pagereveal", (e) => {
      const names = [...document.querySelectorAll("*")].map((n) => getComputedStyle(n).viewTransitionName).filter((v) => v && v !== "none");
      (window as unknown as { __reveal: unknown }).__reveal = { path: location.pathname, transition: (e as unknown as { viewTransition: unknown }).viewTransition !== null, names };
    });
  });
  // A slow session check: the home must not wait for it to show its bar.
  await page.route("**/api/session", async (route) => {
    if (route.request().method() === "GET") await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  await page.goto("/salvas");
  await expect(actions(page).getByRole("button", { name: "Sair" })).toBeVisible(); // sets the owner hint
  await tab(page, "home").click();
  await expect(page).toHaveURL(/\/$/);
  const read = () => page.evaluate(() => (window as unknown as { __reveal?: { path: string } }).__reveal ?? null);
  await expect.poll(async () => (await read())?.path).toBe("/");
  expect(await read()).toEqual({ path: "/", transition: true, names: ["root", "nav"] });
  await expect(page.locator("[data-drop]")).toBeVisible();
});

test("the owner view has no Linhas salvas pill", async ({ page }) => {
  await login(page.request);
  await page.goto("/");
  await expect(page.locator("[data-drop]")).toBeVisible();
  await expect(page.locator("[data-saved-link]")).toHaveCount(0);
  await expect(page.locator('a[href="/salvas"]')).toHaveCount(1);
  await expect(page.locator('a[href="/salvas"]')).toHaveAttribute("data-tab", "saved");
});

test("the bar sits in the same place on the owner view as on the home", async ({ page }) => {
  for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    const place = async () => {
      await expect(bar(page)).toBeVisible();
      const parts = [wordmark(page), tab(page, "home"), tab(page, "saved")];
      return Promise.all(parts.map(async (p) => ({ x: (await box(p)).x, y: (await box(p)).y })));
    };
    await page.context().clearCookies();
    await page.goto("/");
    await expect(page.locator("[data-home-view]")).toBeVisible();
    const home = await place();
    await login(page.request);
    await page.goto("/");
    await expect(page.locator("[data-drop]")).toBeVisible();
    expect(await place(), `${size.width} px`).toEqual(home);
  }
});

// --- the player and its not-found page ---------------------------------------------------

const place = async (page: Page) => {
  const parts = [wordmark(page), tab(page, "home"), tab(page, "saved")];
  return Promise.all(parts.map(async (p) => ({ x: (await box(p)).x, y: (await box(p)).y })));
};

test("the player has the bar with neither tab current, and its actions at the right", async ({ page, request }) => {
  const a = await upload(request, "Faixa Barra");
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit(page, a);
  await expect(bar(page)).toBeVisible();
  await expect(page.locator("header.top-bar")).toHaveCount(0);
  // The song's title is the page's one h1: the wordmark is plain text.
  expect(await wordmark(page).evaluate((n) => [n.tagName, n.tabIndex])).toEqual(["SPAN", -1]);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Faixa Barra");

  await expect(nav(page).getByRole("link")).toHaveText(["Início", "Linhas salvas"]);
  for (const id of ["home", "saved"] as const) {
    await expect(tab(page, id)).not.toHaveAttribute("aria-current", /.*/);
    expect((await tabLook(tab(page, id))).line).toBeNull();
  }

  // Translation (with its language pill), share and full screen, in that order, after the tabs.
  await page.locator("[data-translate]").click();
  await expect(page.locator("[data-language]")).toBeVisible();
  const order = await actions(page).evaluate((n) =>
    [...n.querySelectorAll<HTMLElement>("[data-translate], [data-language], [data-share], [data-fullscreen]")].map((b) =>
      Object.keys(b.dataset).find((k) => ["translate", "language", "share", "fullscreen"].includes(k)),
    ),
  );
  expect(order).toEqual(["translate", "language", "share", "fullscreen"]);
  const [first, saved] = [await box(page.locator("[data-translate]")), await box(tab(page, "saved"))];
  expect(first.x).toBeGreaterThan(saved.x + saved.width);
  const last = await box(page.locator("[data-fullscreen]"));
  expect(last.x + last.width).toBeCloseTo(1440 - 120 - 24, 0); // the bar's own frame, as on the home
});

test("the player has no house icon; Início leads home and Linhas salvas leads to /salvas", async ({ page, request }) => {
  const a = await upload(request, "Faixa Casa");
  await visit(page, a);
  await expect(page.locator("[data-home]")).toHaveCount(0);
  await expect(page.locator('[data-icon="house"]')).toHaveCount(0);
  await tab(page, "home").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("[data-home-view]")).toBeVisible();

  await visit(page, a);
  await tab(page, "saved").click();
  await expect(page).toHaveURL(/\/salvas$/);
  await expect(page.locator("[data-saved-view]")).toBeVisible();
});

test("the bar sits in the same place on the player as on the home", async ({ page, request }) => {
  const a = await upload(request, "Faixa Lugar");
  for (const size of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 560, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await page.goto("/");
    await expect(actions(page).locator("[data-sign-in]")).toBeVisible();
    const tabs = async () => Promise.all((["home", "saved"] as const).map(async (id) => ({ x: (await box(tab(page, id))).x, y: (await box(tab(page, id))).y })));
    const withWordmark = size.width >= 480; // the player shows its wordmark from 480 px
    const home = withWordmark ? await place(page) : await tabs();
    await visit(page, a);
    if (withWordmark) expect(await place(page), `${size.width} px`).toEqual(home);
    // On a phone the player's own side padding sets the left edge and its wordmark is hidden; the tops match.
    else expect((await tabs()).map((t) => t.y), "390 px").toEqual(home.map((t) => t.y));
  }
});

test("the not-found page has the bar", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(actions(page).locator("[data-sign-in]")).toBeVisible();
  const home = await place(page);
  const res = await page.goto("/t/naoexiste1");
  expect(res?.status()).toBe(404);
  await expect(bar(page)).toBeVisible();
  expect(await wordmark(page).evaluate((n) => n.tagName)).toBe("SPAN");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Esse link não existe ou a música foi apagada.");
  await expect(nav(page).getByRole("link")).toHaveText(["Início", "Linhas salvas"]);
  for (const id of ["home", "saved"] as const) await expect(tab(page, id)).not.toHaveAttribute("aria-current", /.*/);
  await expect(page.locator("[data-home], .not-found-bar")).toHaveCount(0);
  expect(await place(page)).toEqual(home);
});

test("the cover view hides the bar and brings it back", async ({ page, request }) => {
  await noFullscreenApi(page);
  const a = await upload(request, "Faixa Capa");
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit(page, a);
  const fullscreen = page.locator("[data-fullscreen]");
  const before = await box(fullscreen);
  await fullscreen.click();
  await expect(page.locator(".player")).toHaveAttribute("data-lyrics", "off");
  await expect(wordmark(page)).toBeHidden();
  // Inert, so out of the accessibility tree: found by its class.
  const tabs = bar(page).locator("nav.nav-tabs");
  await expect(tabs).toBeHidden();
  await expect(tabs).toHaveAttribute("inert", "");
  await expect(page.locator(".translate-group")).toBeHidden();
  // Full screen is the way back: it stays where it was.
  await expect(fullscreen).toBeVisible();
  expect(await box(fullscreen)).toEqual(before);

  await fullscreen.click();
  await expect(page.locator(".player")).toHaveAttribute("data-lyrics", "on");
  await expect(wordmark(page)).toBeVisible();
  await expect(nav(page)).toBeVisible();
  await expect(tabs).not.toHaveAttribute("inert", /.*/);
});

test("keyboard on the player: skip link, Início, Linhas salvas, then the actions", async ({ page, request }) => {
  const a = await upload(request, "Faixa Teclado");
  for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await visit(page, a);
    // The skip link is not a Tab stop (it is for screen readers and switches, player.spec), so the
    // first presses go to the tabs, then to the actions, before anything of the page.
    await expect(page.locator("[data-skip-lyrics]")).toHaveAttribute("tabindex", "-1");
    const order: (string | null)[] = [];
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab");
      order.push(await page.evaluate(() => {
        const n = document.activeElement as HTMLElement | null;
        return n?.dataset.tab ?? ["translate", "share", "fullscreen"].find((k) => n?.hasAttribute(`data-${k}`)) ?? n?.tagName ?? null;
      }));
    }
    expect(order, `${size.width} px`).toEqual(["home", "saved", "translate", "share", "fullscreen"]);
  }
});

test("at 360 px with a long language name the tabs stay on the row", async ({ page, request }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() }); // translation is limited per client
  const a = await upload(request, "Faixa Estreita");
  await page.setViewportSize({ width: 360, height: 740 });
  await visit(page, a);
  await page.locator("[data-translate]").click();
  const pill = page.locator("[data-language]");
  await expect(pill).toBeVisible();
  await pill.evaluate((n) => {
    n.textContent = "Português (Brasil)";
  });
  await expect(pill).toHaveText("Português (Brasil)");
  // The row lays out again in the next frames.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  const [home, saved] = [await box(tab(page, "home")), await box(tab(page, "saved"))];
  expect(saved.y).toBe(home.y);
  // These values assume no safe-area inset (the player's 20 px side padding, the bar's 16 px top).
  expect(home).toMatchObject({ x: 20, y: 16 }); // the tabs start the row (no wordmark on the player's phone bar)
  await expect(wordmark(page)).toBeHidden();
  expect(home.x).toBeGreaterThanOrEqual(0);
  expect(saved.x + saved.width).toBeLessThanOrEqual(360);
  await expect(tab(page, "home")).toBeVisible();
  await expect(tab(page, "saved")).toBeVisible();
  // The actions wrap under the tabs, never off the screen, and keep their 44 px targets.
  for (const selector of ["[data-translate]", "[data-language]", "[data-share]", "[data-fullscreen]"]) {
    const b = await box(page.locator(selector));
    expect(b.y, selector).toBeGreaterThanOrEqual(home.y + home.height);
    expect(b.x + b.width, selector).toBeLessThanOrEqual(360);
  }
  for (const selector of ["[data-translate]", "[data-share]", "[data-fullscreen]"]) expect((await box(page.locator(selector))).height).toBe(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

test("on a phone the player hides the wordmark", async ({ page, request }) => {
  const a = await upload(request, "Faixa Marca");
  await page.setViewportSize({ width: 390, height: 844 });
  await visit(page, a);
  await expect(wordmark(page)).toBeHidden();
  expect(await wordmark(page).evaluate((n) => getComputedStyle(n).display)).toBe("none"); // out of the accessibility tree too
  expect(await page.locator("header[data-nav]").ariaSnapshot()).not.toMatch(/\bletra\b/);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(wordmark(page)).toBeVisible();
  // The other screens keep it on phones.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(wordmark(page)).toBeVisible();
});

test("on a phone the player's tabs do not move when the translation is turned on", async ({ page, request }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() }); // translation is limited per client
  const a = await upload(request, "Faixa Firme");
  const tabs = () => Promise.all((["home", "saved"] as const).map(async (id) => ({ x: (await box(tab(page, id))).x, y: (await box(tab(page, id))).y })));
  for (const size of [{ width: 390, height: 844 }, { width: 360, height: 740 }]) {
    await page.setViewportSize(size);
    await visit(page, a);
    const before = await tabs();
    // These values assume no safe-area inset (the player's 20 px side padding, the bar's 16 px top).
    expect(before[0], `${size.width} px`).toEqual({ x: 20, y: 16 }); // first on the row
    await expect(page.locator("[data-translate]")).toHaveAttribute("aria-pressed", "false");
    await page.locator("[data-translate]").click();
    await expect(page.locator("[data-language]")).toBeVisible();
    expect(await tabs(), `${size.width} px`).toEqual(before);
    // The actions went under the tabs; neither tab became current.
    expect((await box(page.locator("[data-fullscreen]"))).y).toBeGreaterThanOrEqual(before[0]!.y + 44);
    await page.mouse.move(size.width / 2, size.height - 40); // off the bar: no hover look
    for (const id of ["home", "saved"] as const) {
      await expect(tab(page, id)).not.toHaveAttribute("aria-current", /.*/);
      expect(await tabLook(tab(page, id)), `${size.width} px ${id}`).toEqual({ type: "15px/20px 600", color: "rgb(175, 175, 182)", line: null });
    }
    await page.evaluate(() => localStorage.clear()); // the translation choice is remembered: start the next size with it off
  }
});

test('the first-save toast says "Linha salva. Elas ficam em Linhas salvas."', async ({ page, request }) => {
  const a = await upload(request, "Faixa Salva");
  await visit(page, a);
  await page.locator('[data-verse][data-index="1"] .verse-save').click();
  await expect(page.locator("[data-toast]")).toHaveText("Linha salva. Elas ficam em Linhas salvas.");
});

test("home → player: the bar does not move during the page transition", async ({ page, request }) => {
  const a = await upload(request, "Faixa Parada");
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit(page, a);
  // On the new page, once its transition is ready: the tabs' group and how it animates.
  await page.addInitScript(() => {
    addEventListener("pagereveal", async (e) => {
      const vt = (e as unknown as { viewTransition: { ready: Promise<void> } | null }).viewTransition;
      if (!vt) return;
      await vt.ready;
      const group = document.getAnimations().filter((x) => (x.effect as KeyframeEffect | null)?.pseudoElement === "::view-transition-group(nav)");
      const frames = group.flatMap((x) => (x.effect as KeyframeEffect).getKeyframes()).map((k) => ({ transform: k.transform, width: k.width, height: k.height }));
      (window as unknown as { __nav: unknown }).__nav = { groups: group.length, frames, end: getComputedStyle(document.documentElement, "::view-transition-group(nav)").transform };
    });
  });
  await page.goto("/");
  await expect(page.locator(`a[data-id="${a.id}"]`)).toBeVisible();
  // The tabs have their own name, once, on both pages.
  const named = () => page.evaluate(() => [...document.querySelectorAll("*")].filter((n) => getComputedStyle(n).viewTransitionName === "nav").map((n) => n.tagName));
  expect(await named()).toEqual(["NAV"]);
  const before = await box(wordmark(page));
  const tabsBefore = await box(nav(page));

  await page.locator(`a[data-id="${a.id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/t/${a.id}$`));
  const read = () => page.evaluate(() => (window as unknown as { __nav?: { groups: number; frames: { transform: unknown }[] } }).__nav ?? null);
  await expect.poll(read).not.toBeNull();
  // The group's start and end are the same box: no move, no resize.
  const nav_ = (await read())!;
  expect(nav_.groups).toBeGreaterThan(0);
  const transforms = new Set(nav_.frames.map((f) => JSON.stringify(f)));
  expect(transforms.size).toBe(1);
  expect(await named()).toEqual(["NAV"]);
  expect(await box(wordmark(page))).toEqual(before);
  expect(await box(nav(page))).toEqual(tabsBefore);
});
