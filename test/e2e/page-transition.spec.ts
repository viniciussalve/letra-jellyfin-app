import type { Page } from "@playwright/test";
import { expect, savedLine, seedSaved, test, upload, visit } from "./helpers.ts";

test.use({ locale: "pt-BR" });

/** Records, at the moment each page is first shown, whether a view transition runs and what it can pair. */
const record = (page: Page) =>
  page.addInitScript(() => {
    addEventListener("pagereveal", (e) => {
      const named = [...document.querySelectorAll<HTMLElement>("*")].filter((n) => getComputedStyle(n).getPropertyValue("view-transition-name") === "cover");
      (window as unknown as { __reveal: unknown }).__reveal = {
        path: location.pathname,
        transition: (e as unknown as { viewTransition: unknown }).viewTransition !== null,
        cover: document.querySelector("[data-cover]") !== null,
        named: named.length,
        namedId: named[0]?.closest("[data-id]")?.getAttribute("data-id") ?? null,
      };
    });
  });
/** Answers the session check late, as a slow network does: the home must not wait for it. */
const slowSession = (page: Page) =>
  page.route("**/api/session", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.continue();
  });
/** The record of the page now shown; waits for it, as a transition keeps the old page up until it has been revealed. */
const reveal = async (page: Page, path: string) => {
  const read = () => page.evaluate(() => (window as unknown as { __reveal?: Record<string, unknown> }).__reveal ?? null);
  await expect.poll(async () => (await read())?.path).toBe(path);
  const { path: _, ...rest } = (await read())!;
  return rest;
};

test("home to player, back, and another song: the cover is carried", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  const b = await upload(request, "Faixa B");
  await visit(page, a);
  await visit(page, b);
  await record(page);
  await slowSession(page);

  // 1. home to player
  await page.goto("/");
  await page.locator(`a[data-id="${a.id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/t/${a.id}$`));
  await expect(page.locator("[data-play]")).toBeVisible();
  expect(await reveal(page, `/t/${a.id}`)).toEqual({ transition: true, cover: true, named: 1, namedId: null });

  // 2. player to home
  await page.locator('[data-nav] a[data-tab="home"]').click();
  await expect(page.locator("[data-home-view]")).toBeVisible();
  expect(await reveal(page, "/")).toMatchObject({ transition: true, named: 1, namedId: a.id });

  // 3. another song, then back
  await page.locator(`a[data-id="${b.id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/t/${b.id}$`));
  await expect(page.locator("[data-play]")).toBeVisible();
  expect(await reveal(page, `/t/${b.id}`)).toMatchObject({ transition: true, named: 1 });
  await page.goBack();
  await expect(page.locator("[data-home-view]")).toBeVisible();
  expect(await reveal(page, "/")).toMatchObject({ named: 1, namedId: b.id });
});

test("the page transition moves the cover and fades the rest in 120 ms", async ({ page, request }) => {
  const a = await upload(request, "Faixa Curva");
  await visit(page, a);
  // Once the new page's transition is ready, the timing of its pseudo-elements.
  await page.addInitScript(() => {
    addEventListener("pagereveal", async (e) => {
      const vt = (e as unknown as { viewTransition: { ready: Promise<void> } | null }).viewTransition;
      if (!vt) return;
      await vt.ready;
      const style = (pseudo: string) => getComputedStyle(document.documentElement, pseudo);
      (window as unknown as { __timing: unknown }).__timing = {
        oldRoot: style("::view-transition-old(root)").animationDuration,
        newRoot: style("::view-transition-new(root)").animationDuration,
        cover: { duration: style("::view-transition-group(cover)").animationDuration, easing: style("::view-transition-group(cover)").animationTimingFunction },
      };
    });
  });
  await page.goto("/");
  await expect(page.locator(`a[data-id="${a.id}"]`)).toBeVisible();
  await page.locator(`a[data-id="${a.id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/t/${a.id}$`));
  const read = () => page.evaluate(() => (window as unknown as { __timing?: unknown }).__timing ?? null);
  await expect.poll(read).not.toBeNull();
  expect(await read()).toEqual({
    oldRoot: "0.12s",
    newRoot: "0.12s",
    cover: { duration: "0.4s", easing: "cubic-bezier(0.2, 0, 0, 1)" },
  });
});

test("player → Início: the summaries answer does not cut the transition short", async ({ page, request }) => {
  const a = await upload(request, "Faixa Inteira");
  await visit(page, a);
  // The summaries land inside the 400 ms move, as on a real network.
  await page.route("**/api/tracks/summary*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.continue();
  });
  // How long the home's transition ran, from its reveal to its end.
  await page.addInitScript(() => {
    addEventListener("pagereveal", (e) => {
      const vt = (e as unknown as { viewTransition: { finished: Promise<void> } | null }).viewTransition;
      if (!vt || location.pathname !== "/") return;
      const t0 = performance.now();
      void vt.finished.then(() => {
        (window as unknown as { __ran: number }).__ran = performance.now() - t0;
      });
    });
  });
  await page.locator('[data-nav] a[data-tab="home"]').click();
  await expect(page.locator("[data-home-view]")).toBeVisible();
  const read = () => page.evaluate(() => (window as unknown as { __ran?: number }).__ran ?? null);
  await expect.poll(read).not.toBeNull();
  expect(await read()).toBeGreaterThanOrEqual(350);
});

test("without the Navigation API, back from another song never names the first song's tile", async ({ page, request }) => {
  // Safari before it had the Navigation API: only document.referrer says where we came from, and
  // a back/forward traversal keeps the referrer of the entry's first load (here, song A).
  await page.addInitScript(() => Object.defineProperty(window, "navigation", { value: undefined }));
  const a = await upload(request, "Sem Navegação A");
  const b = await upload(request, "Sem Navegação B");
  await visit(page, a);
  await visit(page, b);
  await record(page);

  await page.goto(a.shareUrl);
  await expect(page.locator("[data-play]")).toBeVisible();
  await page.locator('[data-nav] a[data-tab="home"]').click();
  await expect(page.locator("[data-home-view]")).toBeVisible();
  expect(await reveal(page, "/")).toMatchObject({ named: 1, namedId: a.id }); // the referrer of a plain navigation is right
  await page.locator(`a[data-id="${b.id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/t/${b.id}$`));
  await expect(page.locator("[data-play]")).toBeVisible();
  await page.goBack();
  await expect(page.locator("[data-home-view]")).toBeVisible();
  expect((await reveal(page, "/")).namedId).not.toBe(a.id);
  const namedNow = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-recent]")].filter((t) => t.querySelector<HTMLElement>(".home-cover")?.style.viewTransitionName === "cover").map((t) => t.dataset.id),
  );
  expect(namedNow.filter((id) => id !== b.id)).toEqual([]); // B or none, never A
});

test("reduced motion: plain navigation", async ({ page, request }) => {
  const a = await upload(request, "Faixa Quieta");
  await visit(page, a);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await record(page);
  await page.goto("/");
  await page.locator(`a[data-id="${a.id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/t/${a.id}$`));
  await expect(page.locator("[data-play]")).toBeVisible();
  expect((await reveal(page, `/t/${a.id}`)).transition).toBe(false);
});

test("opening a saved card of another song names that song's tile, never the one we came from", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  const b = await upload(request, "Faixa B");
  await seedSaved(page, [savedLine(b, 1)]);
  await visit(page, b);
  await visit(page, a);
  // The tiles named when the home is swapped out, kept for the next page to read.
  await page.addInitScript(() => {
    addEventListener("pageswap", () => {
      const named = [...document.querySelectorAll<HTMLElement>("[data-recent]")]
        .filter((t) => getComputedStyle(t.querySelector(".home-cover")!).getPropertyValue("view-transition-name") === "cover")
        .map((t) => t.dataset.id);
      sessionStorage.setItem("swap", JSON.stringify({ path: location.pathname, named }));
    });
  });

  await page.locator('[data-nav] a[data-tab="home"]').click();
  await expect(page.locator("[data-home-view]")).toBeVisible();
  await expect(page.locator(`a[data-id="${a.id}"] .home-cover`)).toHaveCSS("view-transition-name", "cover");
  await page.locator("a[data-saved-card]").click();
  await expect(page).toHaveURL(new RegExp(`/t/${b.id}\\?t=2\\.5$`));
  await expect(page.locator("[data-play]")).toBeVisible();
  const swap = JSON.parse((await page.evaluate(() => sessionStorage.getItem("swap"))) ?? "null") as { path: string; named: string[] };
  expect(swap.path).toBe("/");
  expect(swap.named).toEqual([b.id]);
});
