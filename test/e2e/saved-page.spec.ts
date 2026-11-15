import type { Locator, Page } from "@playwright/test";
import type { SavedLine } from "../../web/shared/saved.ts";
import { expect, login, savedLine, seedSaved, test, upload } from "./helpers.ts";

test.use({ locale: "pt-BR" });

const DAY = 24 * 60 * 60 * 1000;
const songs = (page: Page) => page.locator("[data-song]");
const lineText = (page: Page) => page.locator("[data-line-text]");
const count = (page: Page) => page.locator("[data-saved-count]");
const empty = (page: Page) => page.locator("[data-saved-empty]");

const stored = (page: Page): Promise<SavedLine[]> =>
  page.evaluate(() => JSON.parse(localStorage.getItem("letra.saved.v1") ?? "[]") as SavedLine[]);

const type = (loc: Locator) =>
  loc.evaluate((n) => {
    const s = getComputedStyle(n);
    return `${s.fontSize}/${s.lineHeight} ${s.fontWeight}`;
  });

test("songs come by the latest save and lines by their place in the lyrics", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  const b = await upload(request, "Faixa B");
  const old = Date.now() - 10 * DAY;
  await seedSaved(page, [savedLine(a, 2, { at: old }), savedLine(a, 0, { at: old + 1000 }), savedLine(b, 1)]);
  await page.goto("/salvas");
  await expect(songs(page)).toHaveCount(2);
  expect(await songs(page).evaluateAll((n) => n.map((x) => x.getAttribute("data-id")))).toEqual([b.id, a.id]);
  expect(await songs(page).nth(1).locator("[data-line]").evaluateAll((n) => n.map((x) => x.getAttribute("data-index")))).toEqual(["0", "2"]);
  await expect(page.getByRole("heading", { level: 1, name: "Linhas salvas" })).toBeVisible();
});

test("the counts use singular and plural", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  const b = await upload(request, "Faixa B");
  const old = Date.now() - DAY;
  await seedSaved(page, [savedLine(a, 2, { at: old }), savedLine(a, 0, { at: old }), savedLine(b, 1)]);
  await page.goto("/salvas");
  await expect(count(page)).toHaveText("3 linhas em 2 músicas");
  await expect(page.locator(`[data-song][data-id="${a.id}"] [data-song-count]`)).toHaveText("2 linhas");
  await expect(page.locator(`[data-song][data-id="${b.id}"] [data-song-count]`)).toHaveText("1 linha");

  await page.evaluate((line) => localStorage.setItem("letra.saved.v1", JSON.stringify([line])), savedLine(b, 1));
  await page.reload();
  await expect(count(page)).toHaveText("1 linha em 1 música");
});

test("a line links to the song at its verse, and the header to the song", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  await seedSaved(page, [savedLine(a, 1), savedLine(a, 3, { t: null })]);
  await page.goto("/salvas");
  await expect(page.locator('[data-line][data-index="1"] [data-line-link]')).toHaveAttribute("href", `/t/${a.id}?t=2.5`);
  await expect(page.locator('[data-line][data-index="3"] [data-line-link]')).toHaveAttribute("href", `/t/${a.id}`);
  await expect(page.locator("[data-song-head]")).toHaveAttribute("href", `/t/${a.id}`);

  await page.locator('[data-line][data-index="1"] [data-line-link]').click();
  await expect(page).toHaveURL(new RegExp(`/t/${a.id}\\?t=2\\.5$`));
  await expect(page.locator('[data-verse][data-index="1"]')).toHaveAttribute("data-state", "active");
  expect(await page.evaluate(() => document.querySelector("audio")!.paused)).toBe(true);
});

test("dates read hoje, ontem, the day and month, and the year when it is another", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  const at = (y: number, m: number, d: number, h = 9) => new Date(y, m, d, h).getTime();
  await page.clock.install({ time: new Date(2026, 10, 10, 15, 0) });
  await seedSaved(page, [
    savedLine(a, 0, { at: at(2026, 10, 10) }),
    savedLine(a, 1, { at: at(2026, 10, 9, 23) }),
    savedLine(a, 2, { at: at(2026, 10, 2) }),
    savedLine(a, 3, { at: at(2025, 11, 3) }),
  ]);
  await page.goto("/salvas");
  const when = page.locator("[data-saved-when]");
  await expect(when).toHaveCount(4);
  await expect(when).toHaveText(["Salva hoje", "Salva ontem", "Salva em 2 de nov.", "Salva em 3 de dez. de 2025"]);
  for (let i = 0; i < 4; i++) {
    const iso = await when.nth(i).getAttribute("datetime");
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Number.isNaN(Date.parse(iso!))).toBe(false);
    expect(((await when.nth(i).getAttribute("title")) ?? "").length).toBeGreaterThan(8);
  }
});

test("a stored translation shows under its line, in its language", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  await seedSaved(page, [savedLine(a, 0, { tr: { lang: "pt-BR", text: "First verse of the song" } })]);
  await page.goto("/salvas");
  const tr = page.locator("[data-line-translation]");
  await expect(tr).toHaveText("First verse of the song");
  await expect(tr).toHaveAttribute("lang", "pt-BR");
});

test("a song the server no longer has is marked and keeps its lines", async ({ page, request }) => {
  const a = await upload(request, "Vai Sumir");
  await seedSaved(page, [savedLine(a, 1)]);
  await page.route("**/api/tracks/summary*", async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { tracks: Array<{ id: string }>; translationEnabled: boolean };
    await route.fulfill({ response: res, json: { ...body, tracks: body.tracks.filter((t) => t.id !== a.id) } });
  });
  await page.goto("/salvas");
  const head = page.locator("[data-song-head]");
  await expect(head).toContainText("Música indisponível");
  await expect(page.locator("[data-song]")).toHaveClass(/is-gone/);
  expect(await head.evaluate((n) => n.tagName)).toBe("DIV");
  expect(await page.locator("[data-line-link]").evaluate((n) => n.tagName)).toBe("SPAN");
  await expect(lineText(page)).toHaveText("Segundo verso, um pouco mais longo para quebrar a linha em telas estreitas");
  await expect(page.locator("[data-line-time]")).toHaveCount(0);
  await expect(page.locator("[data-remove]")).toBeVisible();
  expect(await stored(page)).toHaveLength(1);
});

test("the empty page explains itself and links home", async ({ page }) => {
  await page.goto("/salvas");
  await expect(empty(page)).toBeVisible();
  await expect(empty(page).locator("p")).toHaveText("Nenhuma linha salva ainda. No player, toque no marcador ao lado de um verso para guardá-lo aqui.");
  const link = empty(page).getByRole("link", { name: "Ir para o início" });
  await expect(link).toHaveAttribute("href", "/");
  // Like the home's text links: --text-2 at rest (the empty block's own text carries that color).
  const color = (n: Locator) => n.evaluate((x) => getComputedStyle(x).color);
  expect(await color(link)).toBe(await color(empty(page).locator("p")));
  await expect(count(page)).toBeHidden();
  await expect(songs(page)).toHaveCount(0);
  await expect(page.locator('[data-tab="home"]')).toHaveAttribute("href", "/");
});

test("details are refreshed from the server and written back", async ({ page, request }) => {
  const a = await upload(request, "Título Novo", "Artista Novo");
  await seedSaved(page, [savedLine(a, 0, { title: "Título Antigo", artist: "Artista Antigo" })]);
  await page.goto("/salvas");
  await expect(page.locator("[data-song-head] h2")).toHaveText("Título Novo");
  await expect(page.locator("[data-song-head] p")).toHaveText("Artista Novo");
  await expect.poll(async () => (await stored(page))[0]?.title).toBe("Título Novo");
  expect((await stored(page))[0]!.artist).toBe("Artista Novo");
});

test("a failed refresh keeps what is stored, with no message", async ({ page, request }) => {
  const a = await upload(request, "Título Novo");
  await seedSaved(page, [savedLine(a, 0, { title: "Título Antigo" })]);
  await page.route("**/api/tracks/summary*", (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
  const answered = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/tracks/summary");
  await page.goto("/salvas");
  await answered;
  // After the page has had two frames to handle the failure, no toast shows.
  const shown = await page.evaluate(
    () => new Promise<number>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(document.querySelectorAll("[data-toast].is-shown").length)))),
  );
  expect(shown).toBe(0);
  await expect(page.locator("[data-song-head] h2")).toHaveText("Título Antigo");
  expect((await stored(page))[0]!.title).toBe("Título Antigo");
});

test("more than 50 songs are asked for in batches", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  const lines = Array.from({ length: 60 }, (_, i) => savedLine(a, 0, { trackId: `x${String(i).padStart(9, "0")}`, artist: "Artista" }));
  await seedSaved(page, lines);
  const asked: number[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname === "/api/tracks/summary") asked.push(url.searchParams.get("ids")!.split(",").length);
  });
  await page.goto("/salvas");
  await expect(page.locator("[data-song].is-gone")).toHaveCount(60);
  await expect(page.locator("[data-song-head] p").first()).toHaveText("Música indisponível");
  expect(asked.sort((x, y) => x - y)).toEqual([10, 50]);
});

test("line text is drawn as text", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  const text = "<b>negrito</b> & <img src=x onerror=alert(1)>";
  await seedSaved(page, [savedLine(a, 0, { text })]);
  await page.goto("/salvas");
  await expect(lineText(page)).toHaveText(text);
  await expect(page.locator(".saved-line b, .saved-line img")).toHaveCount(0);
});

test("a save in another tab appears", async ({ page, context, request }) => {
  const a = await upload(request, "Faixa A");
  await page.goto("/salvas");
  await expect(empty(page)).toBeVisible();
  const other = await context.newPage();
  await other.goto(a.shareUrl);
  await other.locator('[data-verse][data-index="1"] .verse-save').click();
  await expect(page.locator("[data-line]")).toHaveCount(1);
  await expect(lineText(page)).toHaveText("Segundo verso, um pouco mais longo para quebrar a linha em telas estreitas");
  await expect(empty(page)).toBeHidden();
});

test("one column of at most 680 px, with the spec's type", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  await seedSaved(page, [savedLine(a, 1, { tr: { lang: "pt-BR", text: "Second verse" } })]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/salvas");
  await expect(lineText(page)).toBeVisible();
  const box = (await page.locator(".saved-col").boundingBox())!;
  expect(box.width).toBe(680);
  expect(box.x).toBe(380);
  expect(await type(page.locator(".saved-head h1"))).toBe("24px/28px 700");
  expect(await type(lineText(page))).toBe("20px/26px 600");
  expect(await type(page.locator("[data-line-translation]"))).toBe("15px/20px 500");
  expect(await type(page.locator("[data-saved-when]"))).toBe("13px/18px 500");
  expect(await type(page.locator("[data-line-time]"))).toBe("13px/18px 500");

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await type(page.locator(".saved-head h1"))).toMatch(/^22px\/26px/);
  expect(await type(lineText(page))).toMatch(/^18px\/24px/);
});

test("under the pointer a row gets a background and a play glyph", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  await seedSaved(page, [savedLine(a, 0), savedLine(a, 1)]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/salvas");
  const row = page.locator("[data-line]").first();
  const second = page.locator("[data-line]").nth(1);
  const glyph = row.locator("[data-line-time] .icon");
  const list = page.locator(".saved-lines");
  await expect(row).toBeVisible();
  expect(await glyph.evaluate((n) => getComputedStyle(n).opacity)).toBe("0");
  expect(await list.evaluate((n) => getComputedStyle(n).borderTopColor)).not.toBe("rgba(0, 0, 0, 0)");
  await row.hover();
  await expect.poll(() => glyph.evaluate((n) => getComputedStyle(n).opacity)).toBe("1");
  await expect.poll(() => row.evaluate((n) => getComputedStyle(n).backgroundColor)).toBe("rgba(255, 255, 255, 0.08)");
  // The hovered row loses its hairline, and so does the next row's.
  expect(await list.evaluate((n) => getComputedStyle(n).borderTopColor)).toBe("rgba(0, 0, 0, 0)");
  expect(await second.evaluate((n) => getComputedStyle(n).boxShadow)).toBe("none");
});

test("the remove button is a 44 px target named by the spec and described by its line", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  await seedSaved(page, [savedLine(a, 1)]);
  await page.goto("/salvas");
  const button = page.getByRole("button", { name: "Remover linha salva" });
  await expect(button).toBeVisible();
  const box = (await button.boundingBox())!;
  expect([box.width, box.height]).toEqual([44, 44]);
  const id = await button.getAttribute("aria-describedby");
  expect(id).toBeTruthy();
  expect(await page.evaluate((i) => document.getElementById(i!)?.hasAttribute("data-line-text"), id)).toBe(true);
});

test("no horizontal scroll at 360 px", async ({ page, request }) => {
  const a = await upload(request, "Uma Faixa Com Um Título Realmente Muito Longo Para Quebrar", "Um Artista Com Um Nome Igualmente Longo");
  await seedSaved(page, [
    savedLine(a, 1, { tr: { lang: "pt-BR", text: "Uma tradução bem longa para forçar a quebra de linha na tela estreita" } }),
    savedLine(a, 0, { text: "Palavra".repeat(12) }),
  ]);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/salvas");
  await expect(page.locator("[data-line]")).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("signed in, the path still shows the saved page", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  await login(page.request);
  await seedSaved(page, [savedLine(a, 0)]);
  await page.goto("/salvas");
  await expect(page.locator("[data-saved-view]")).toBeVisible();
  await expect(lineText(page)).toBeVisible();
  await expect(page.locator("[data-drop]")).toHaveCount(0);
  await expect(page.locator("[data-home-view]")).toHaveCount(0);
});

test("focus on a song header survives a redraw", async ({ page, context, request }) => {
  const a = await upload(request, "Faixa A");
  await seedSaved(page, [savedLine(a, 0)]);
  await page.goto("/salvas");
  const head = page.locator("[data-song-head]");
  await head.focus();
  await expect(head).toBeFocused();
  const other = await context.newPage();
  await other.goto(a.shareUrl);
  await other.locator('[data-verse][data-index="1"] .verse-save').click();
  await expect(page.locator("[data-line]")).toHaveCount(2);
  await expect(page.locator(`[data-song][data-id="${a.id}"] [data-song-head]`)).toBeFocused();
});

test("an id with a space still describes the remove button by its line alone", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  await seedSaved(page, [savedLine(a, 0, { trackId: "ab cd" })]);
  await page.goto("/salvas");
  const ids = ((await page.locator("[data-remove]").getAttribute("aria-describedby")) ?? "").split(/\s+/).filter(Boolean);
  expect(ids).toHaveLength(1);
  expect(await page.evaluate((i) => document.getElementById(i)?.hasAttribute("data-line-text"), ids[0]!)).toBe(true);
});

test("a line saved while the summaries are in flight survives the refresh", async ({ page, request }) => {
  const a = await upload(request, "Título Novo");
  await seedSaved(page, [savedLine(a, 0, { title: "Título Antigo" })]);
  let release: () => void = () => {};
  const held = new Promise<void>((r) => (release = r));
  let reached: () => void = () => {};
  const asked = new Promise<void>((r) => (reached = r));
  await page.route("**/api/tracks/summary*", async (route) => {
    reached();
    await held;
    await route.continue();
  });
  await page.goto("/salvas");
  await asked;
  // Written from this very tab, which raises no storage event: only the merge sees it.
  await page.evaluate((line) => {
    const list = JSON.parse(localStorage.getItem("letra.saved.v1") ?? "[]");
    localStorage.setItem("letra.saved.v1", JSON.stringify([...list, line]));
  }, savedLine(a, 1, { title: "Título Antigo" }));
  release();
  // The server's title in the header says the summaries were applied.
  await expect(page.locator("[data-song-head] h2")).toHaveText("Título Novo");
  await expect(page.locator("[data-line]")).toHaveCount(2);
  const list = await stored(page);
  expect(list).toHaveLength(2);
  expect(list.map((l) => l.title)).toEqual(["Título Novo", "Título Novo"]);
});

const toastEl = (page: Page) => page.locator("[data-toast]");
const removeOf = (page: Page, index: number) => page.locator(`[data-line][data-index="${index}"] [data-remove]`);
const linkOf = (page: Page, index: number) => page.locator(`[data-line][data-index="${index}"] [data-line-link]`);

test("removing asks nothing: the row goes, the counts change, the store forgets it", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  const b = await upload(request, "Faixa B");
  await seedSaved(page, [savedLine(a, 0), savedLine(a, 2), savedLine(b, 1)]);
  await page.goto("/salvas");
  await expect(count(page)).toHaveText("3 linhas em 2 músicas");
  let dialogs = 0;
  page.on("dialog", () => dialogs++);
  await removeOf(page, 2).click();
  await expect(page.locator(`[data-song][data-id="${a.id}"] [data-line]`)).toHaveCount(1);
  await expect(count(page)).toHaveText("2 linhas em 2 músicas");
  await expect(page.locator(`[data-song][data-id="${a.id}"] [data-song-count]`)).toHaveText("1 linha");
  await expect(toastEl(page)).toHaveText("Linha removidaDesfazer");
  await expect(toastEl(page)).toHaveClass(/is-shown/);
  expect((await stored(page)).map((l) => `${l.trackId}:${l.index}`).sort()).toEqual([`${a.id}:0`, `${b.id}:1`].sort());
  expect(await page.locator("[data-modal], dialog[open]").count()).toBe(0);
  expect(dialogs).toBe(0);

  // A song with no line left goes too.
  await page.locator(`[data-song][data-id="${b.id}"] [data-remove]`).click();
  await expect(songs(page)).toHaveCount(1);
  await expect(count(page)).toHaveText("1 linha em 1 música");
});

test("Desfazer puts the line back where it was, with its date", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  const at = Date.now() - 3 * DAY;
  await seedSaved(page, [savedLine(a, 0), savedLine(a, 1, { at }), savedLine(a, 3)]);
  await page.goto("/salvas");
  await removeOf(page, 1).click();
  await expect(page.locator("[data-line]")).toHaveCount(2);
  await page.locator("[data-toast-action]").click();
  expect(await page.locator("[data-line]").evaluateAll((n) => n.map((x) => x.getAttribute("data-index")))).toEqual(["0", "1", "3"]);
  expect((await stored(page)).find((l) => l.index === 1)!.at).toBe(at);
  await expect(linkOf(page, 1)).toBeFocused();
  await expect(toastEl(page)).not.toHaveClass(/is-shown/);
});

test("focus goes to the next row, then to the previous, then to the title", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  await seedSaved(page, [savedLine(a, 0), savedLine(a, 1), savedLine(a, 2)]);
  await page.goto("/salvas");
  await removeOf(page, 1).click();
  await expect(linkOf(page, 2)).toBeFocused();
  await removeOf(page, 2).click();
  await expect(linkOf(page, 0)).toBeFocused();
  await removeOf(page, 0).click();
  await expect(page.locator("h1")).toBeFocused();
});

test("the undo stays 5 seconds, and under the pointer or focus it waits, then starts again whole", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  await page.clock.install();
  await seedSaved(page, [savedLine(a, 0), savedLine(a, 1), savedLine(a, 2)]);
  await page.goto("/salvas");
  await removeOf(page, 0).click();
  await expect(toastEl(page)).toHaveClass(/is-shown/);
  await page.clock.runFor(4900);
  await expect(toastEl(page)).toHaveClass(/is-shown/);
  await page.clock.runFor(200);
  await expect(toastEl(page)).not.toHaveClass(/is-shown/);

  // Under the pointer late in the 5 s: once the pointer leaves, the whole 5 s run again.
  await removeOf(page, 1).click();
  await expect(toastEl(page)).toHaveClass(/is-shown/);
  await page.clock.runFor(4000);
  await toastEl(page).hover();
  await page.clock.runFor(8000);
  await expect(toastEl(page)).toHaveClass(/is-shown/);
  await page.mouse.move(2, 2);
  await page.clock.runFor(4900);
  await expect(toastEl(page)).toHaveClass(/is-shown/);
  await page.clock.runFor(200);
  await expect(toastEl(page)).not.toHaveClass(/is-shown/);

  // With focus inside late in the 5 s: the same once focus leaves.
  await removeOf(page, 2).click();
  await expect(toastEl(page)).toHaveClass(/is-shown/);
  await page.clock.runFor(4000);
  await page.locator("[data-toast-action]").focus();
  await page.clock.runFor(8000);
  await expect(toastEl(page)).toHaveClass(/is-shown/);
  await page.locator("h1").focus();
  await page.clock.runFor(4900);
  await expect(toastEl(page)).toHaveClass(/is-shown/);
  await page.clock.runFor(200);
  await expect(toastEl(page)).not.toHaveClass(/is-shown/);
});

test("only the last removal can be undone", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  await seedSaved(page, [savedLine(a, 0), savedLine(a, 1), savedLine(a, 2)]);
  await page.goto("/salvas");
  await removeOf(page, 0).click();
  await expect(page.locator("[data-line]")).toHaveCount(2);
  await removeOf(page, 1).click();
  await expect(page.locator("[data-line]")).toHaveCount(1);
  await page.locator("[data-toast-action]").click();
  await expect(page.locator("[data-line]")).toHaveCount(2);
  expect((await stored(page)).map((l) => l.index).sort()).toEqual([1, 2]);
});

test("removing the last line shows the empty page", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  await seedSaved(page, [savedLine(a, 0)]);
  await page.goto("/salvas");
  await removeOf(page, 0).click();
  await expect(empty(page)).toBeVisible();
  await expect(songs(page)).toHaveCount(0);
  await expect(count(page)).toBeHidden();
  await expect(page.locator("h1")).toBeFocused();
});

test("reduced motion: the row is gone at once", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seedSaved(page, [savedLine(a, 0), savedLine(a, 1)]);
  await page.goto("/salvas");
  await expect(page.locator("[data-line]")).toHaveCount(2);
  const gone = await page.evaluate(async () => {
    document.querySelector<HTMLElement>('[data-line][data-index="0"] [data-remove]')!.click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return document.querySelector('[data-line][data-index="0"]') === null;
  });
  expect(gone).toBe(true);
});

test("the player no longer shows the line as saved", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  await seedSaved(page, [savedLine(a, 1), savedLine(a, 2)]);
  await page.goto(a.shareUrl);
  await expect(page.locator('[data-verse][data-index="1"]')).toHaveAttribute("data-saved", "");
  await page.goto("/salvas");
  await removeOf(page, 1).click();
  await expect(page.locator("[data-line]")).toHaveCount(1);
  await page.goto(a.shareUrl);
  await expect(page.locator('[data-verse][data-index="2"]')).toHaveAttribute("data-saved", "");
  await expect(page.locator('[data-verse][data-index="1"]')).not.toHaveAttribute("data-saved", "");
});

test("after a removal from the keyboard, Desfazer waits to be reached by Tab, on a page of a dozen rows", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  const b = await upload(request, "Faixa B");
  const c = await upload(request, "Faixa C");
  await page.clock.install();
  await seedSaved(page, [a, b, c].flatMap((t) => [0, 1, 2, 3].map((i) => savedLine(t, i))));
  await page.goto("/salvas");
  await expect(page.locator("[data-line]")).toHaveCount(12);
  const first = page.locator("[data-line]").first();
  const removed = { track: await first.getAttribute("data-track"), index: await first.getAttribute("data-index") };
  await first.locator("[data-remove]").focus();
  await page.keyboard.press("Enter");
  await expect(toastEl(page)).toHaveClass(/is-shown/);
  await page.clock.runFor(30_000);
  await expect(toastEl(page)).toHaveClass(/is-shown/);
  await expect(page.locator("[data-line]")).toHaveCount(11);

  const action = page.locator("[data-toast-action]");
  expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  for (let i = 0; i < 40 && !(await action.evaluate((e) => e === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(action).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-line]")).toHaveCount(12);
  await expect(page.locator(`[data-line][data-track="${removed.track}"][data-index="${removed.index}"] [data-line-link]`)).toBeFocused();
  await expect(toastEl(page)).not.toHaveClass(/is-shown/);
});

test("after focus has been in the keyboard removal's toast and left, it goes 5 seconds later", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  await page.clock.install();
  await seedSaved(page, [savedLine(a, 0), savedLine(a, 1)]);
  await page.goto("/salvas");
  await removeOf(page, 0).focus();
  await page.keyboard.press("Enter");
  await expect(toastEl(page)).toHaveClass(/is-shown/);
  await page.locator("[data-toast-action]").focus();
  await page.clock.runFor(10_000);
  await page.locator("h1").focus();
  await page.clock.runFor(4900);
  await expect(toastEl(page)).toHaveClass(/is-shown/);
  await page.clock.runFor(200);
  await expect(toastEl(page)).not.toHaveClass(/is-shown/);
});

test("Ctrl+Z while the undo toast shows brings the line back", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  await page.clock.install();
  await seedSaved(page, [savedLine(a, 0), savedLine(a, 1)]);
  await page.goto("/salvas");
  await removeOf(page, 0).click();
  await expect(page.locator("[data-line]")).toHaveCount(1);
  await expect(toastEl(page)).toHaveClass(/is-shown/);
  await page.keyboard.press("Control+z");
  await expect(page.locator("[data-line]")).toHaveCount(2);
  expect((await stored(page)).map((l) => l.index).sort()).toEqual([0, 1]);
  await expect(toastEl(page)).not.toHaveClass(/is-shown/);
  await expect(linkOf(page, 0)).toBeFocused();

  // Once the toast is gone, Ctrl+Z does nothing.
  await removeOf(page, 0).click();
  await page.clock.runFor(5100);
  await expect(toastEl(page)).not.toHaveClass(/is-shown/);
  await expect(page.locator("[data-line]")).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await page.clock.runFor(100);
  await expect(page.locator("[data-line]")).toHaveCount(1);
  expect(await stored(page)).toHaveLength(1);
});

test("on a phone the undo toast keeps Linha removida on one line", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  await seedSaved(page, [savedLine(a, 0), savedLine(a, 1)]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/salvas");
  await removeOf(page, 0).click();
  await expect(toastEl(page)).toHaveClass(/is-shown/);
  const lines = await toastEl(page).evaluate((t) => {
    const range = document.createRange();
    range.selectNodeContents(t.firstChild!);
    return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
  });
  expect(lines).toBe(1);
});

test("a refused write keeps the row and says so", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  await seedSaved(page, [savedLine(a, 0)]);
  await page.goto("/salvas");
  await expect(page.locator("[data-line]")).toHaveCount(1);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
  });
  await removeOf(page, 0).click();
  await expect(toastEl(page)).toHaveText("Não foi possível salvar neste navegador.");
  await expect(page.locator("[data-line]")).toHaveCount(1);
});

test("the whole row opens the song: a click on its time goes to the verse", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  await seedSaved(page, [savedLine(a, 1)]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/salvas");
  const time = (await page.locator("[data-line-time]").boundingBox())!;
  await page.mouse.click(time.x + time.width / 2, time.y + time.height / 2);
  await expect(page).toHaveURL(new RegExp(`/t/${a.id}\\?t=2\\.5$`));
  await expect(page.locator('[data-verse][data-index="1"]')).toHaveAttribute("data-state", "active");
});

test("on a phone the line's link is a full-height target, and the remove button stays its own", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  await seedSaved(page, [savedLine(a, 0), savedLine(a, 2)]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/salvas");
  const row = page.locator('[data-line][data-index="0"]');
  const hits = await row.evaluate((r) => {
    const text = r.querySelector("[data-line-text]")!.getBoundingClientRect();
    const link = r.querySelector("a[data-line-link]");
    const x = text.x + text.width / 2;
    const y = text.y + text.height / 2;
    return [-20, 20].map((dy) => document.elementFromPoint(x, y + dy)?.closest("a[data-line-link]") === link);
  });
  expect(hits).toEqual([true, true]);

  const url = page.url();
  await row.locator("[data-remove]").click();
  await expect(page.locator("[data-line]")).toHaveCount(1);
  expect(page.url()).toBe(url);
  await expect(page.locator("[data-saved-view]")).toBeVisible();
});

test("the play glyph is 11 px, and 10 px on a phone", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  await seedSaved(page, [savedLine(a, 1)]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/salvas");
  const svg = page.locator("[data-line-time] svg");
  const size = async () => {
    const b = (await svg.boundingBox())!;
    return [b.width, b.height];
  };
  expect(await size()).toEqual([11, 11]);
  expect(await page.locator("[data-remove] svg").evaluate((n) => [n.getBoundingClientRect().width, n.getBoundingClientRect().height])).toEqual([20, 20]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(size).toEqual([10, 10]);
});

test("the line carries its song's language", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  await seedSaved(page, [savedLine(a, 0, { lang: "en" }), savedLine(a, 1, { lang: "" }), savedLine(a, 2, { lang: null })]);
  await page.goto("/salvas");
  await expect(page.locator("[data-line-text]")).toHaveCount(3);
  await expect(page.locator('[data-line][data-index="0"] [data-line-text]')).toHaveAttribute("lang", "en");
  for (const i of [1, 2]) expect(await page.locator(`[data-line][data-index="${i}"] [data-line-text]`).getAttribute("lang")).toBeNull();
});

/** Init script: counts the writes of the saved lines (after any seed, which runs first). */
const countWrites = (page: Page) =>
  page.addInitScript(() => {
    const w = window as unknown as { __writes: number };
    w.__writes = 0;
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === "letra.saved.v1") w.__writes++;
      return set.call(this, key, value);
    };
  });

/** Holds the summary answers until the returned function is called. */
async function holdSummaries(page: Page): Promise<{ asked: Promise<void>; release: () => void }> {
  let release: () => void = () => {};
  const held = new Promise<void>((r) => (release = r));
  let reached: () => void = () => {};
  const asked = new Promise<void>((r) => (reached = r));
  await page.route("**/api/tracks/summary*", async (route) => {
    reached();
    await held;
    await route.continue();
  });
  return { asked, release };
}

test("a refresh that changes nothing writes nothing", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  await seedSaved(page, [savedLine(a, 0), savedLine(a, 1)]);
  await countWrites(page);
  const { asked, release } = await holdSummaries(page);
  await page.goto("/salvas");
  await asked;
  await expect(page.locator("[data-line]")).toHaveCount(2);
  // The refresh draws the rows again: a mark on the old row says when it has landed.
  await page.locator("[data-line]").first().evaluate((n) => n.setAttribute("data-old", ""));
  release();
  await expect(page.locator("[data-line][data-old]")).toHaveCount(0);
  await expect(page.locator("[data-line]")).toHaveCount(2);
  expect(await page.evaluate(() => (window as unknown as { __writes: number }).__writes)).toBe(0);
});

test("a song saved while the summaries are in flight is not marked unavailable", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  const b = await upload(request, "Faixa B");
  await seedSaved(page, [savedLine(a, 0)]);
  const { asked, release } = await holdSummaries(page);
  await page.goto("/salvas");
  await asked;
  // Written from this very tab, which raises no storage event: only the merge sees it.
  await page.evaluate((line) => {
    const list = JSON.parse(localStorage.getItem("letra.saved.v1") ?? "[]");
    localStorage.setItem("letra.saved.v1", JSON.stringify([...list, line]));
  }, savedLine(b, 1));
  await page.locator("[data-line]").first().evaluate((n) => n.setAttribute("data-old", ""));
  release();
  await expect(page.locator("[data-line][data-old]")).toHaveCount(0);
  await expect(page.locator(`[data-song][data-id="${b.id}"]`)).toHaveCount(1);
  await expect(page.locator(`[data-song][data-id="${b.id}"]`)).not.toHaveClass(/is-gone/);
  await expect(page.locator(`[data-song][data-id="${b.id}"] [data-line-link]`)).toHaveJSProperty("tagName", "A");
});

test("a record with an id the server would refuse does not stop the other songs' refresh", async ({ page, request }) => {
  const a = await upload(request, "Título Novo");
  await seedSaved(page, [savedLine(a, 0, { title: "Título antigo" }), savedLine(a, 1, { trackId: "não é um id", title: "Outra" })]);
  const asked: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname === "/api/tracks/summary") asked.push(url.searchParams.get("ids")!);
  });
  await page.goto("/salvas");
  await expect(page.locator(`[data-song][data-id="${a.id}"] h2`)).toHaveText("Título Novo");
  await expect(page.locator('[data-song][data-id="não é um id"]')).toHaveClass(/is-gone/);
  expect(asked).toEqual([a.id]);
});

test("focus on a row that goes away moves to the title", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  await seedSaved(page, [savedLine(a, 0), savedLine(a, 1)]);
  await page.goto("/salvas");
  await expect(page.locator("[data-line]")).toHaveCount(2);
  await linkOf(page, 1).focus();
  await expect(linkOf(page, 1)).toBeFocused();
  await page.evaluate(() => {
    const list = JSON.parse(localStorage.getItem("letra.saved.v1") ?? "[]") as { index: number }[];
    localStorage.setItem("letra.saved.v1", JSON.stringify(list.filter((l) => l.index !== 1)));
    window.dispatchEvent(new StorageEvent("storage", { key: "letra.saved.v1" }));
  });
  await expect(page.locator("[data-line]")).toHaveCount(1);
  await expect(page.locator("h1")).toBeFocused();
});

test("the page reads the store again when it comes back from the back/forward cache", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  await seedSaved(page, [savedLine(a, 0)]);
  await page.goto("/salvas");
  await expect(page.locator("[data-line]")).toHaveCount(1);
  await page.evaluate((line) => {
    const list = JSON.parse(localStorage.getItem("letra.saved.v1") ?? "[]");
    localStorage.setItem("letra.saved.v1", JSON.stringify([...list, line]));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  }, savedLine(a, 1));
  await expect(page.locator("[data-line]")).toHaveCount(2);
});

test("Desfazer does nothing once its toast is leaving", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  await page.clock.install();
  await seedSaved(page, [savedLine(a, 0), savedLine(a, 1)]);
  await page.goto("/salvas");
  await removeOf(page, 0).click();
  await expect(page.locator("[data-line]")).toHaveCount(1);
  await page.clock.runFor(5000);
  await expect(toastEl(page)).not.toHaveClass(/is-shown/);
  await page.evaluate(() => document.querySelector<HTMLElement>("[data-toast-action]")!.click());
  await page.clock.runFor(100);
  await expect(page.locator("[data-line]")).toHaveCount(1);
  expect((await stored(page)).map((l) => l.index)).toEqual([1]);
});

test("removing a line another tab already removed shows no error", async ({ page, request }) => {
  const a = await upload(request, "Faixa A");
  await seedSaved(page, [savedLine(a, 0), savedLine(a, 1)]);
  await page.goto("/salvas");
  await expect(page.locator("[data-line]")).toHaveCount(2);
  await page.evaluate(() => {
    const list = JSON.parse(localStorage.getItem("letra.saved.v1") ?? "[]") as { index: number }[];
    localStorage.setItem("letra.saved.v1", JSON.stringify(list.filter((l) => l.index !== 0)));
  });
  await removeOf(page, 0).click();
  await expect(page.locator("[data-line]")).toHaveCount(1);
  await expect(count(page)).toHaveText("1 linha em 1 música");
  await expect(toastEl(page)).not.toHaveClass(/is-shown/);
});
