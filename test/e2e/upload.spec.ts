import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Locator, Page, Route } from "@playwright/test";
import type { TrackDTO } from "../../shared/types.ts";
import { expect, login, PASSWORD, test, uploadFixture, USERNAME } from "./helpers.ts";

test.use({ locale: "pt-BR", permissions: ["clipboard-read", "clipboard-write"] });

const fixturePath = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
const fixture = (name: string) => readFileSync(fixturePath(name));

/** Bare audio under a name whose title the LRCLIB stub does not know: no lyrics anywhere. */
const NO_LYRICS = { name: "Letra Fixtures - Sem Letra.mp3", mimeType: "audio/mpeg", buffer: fixture("Letra Fixtures - Sem Tags.mp3") };

/** Signs the page's context in through the API (its own forwarded IP, so the login limit never trips). */
async function signIn(page: Page): Promise<void> {
  await login(page.request);
  await page.goto("/");
  await expect(dropPanel(page)).toBeVisible();
}

const dropPanel = (page: Page) => page.locator("[data-drop]");
const result = (page: Page) => page.locator("[data-result]");
const row = (page: Page, id: string) => page.locator(`[data-row][data-id="${id}"]`);
const toast = (page: Page) => page.locator("[data-toast]");

/** Picks a file in the drop panel and returns the track the server answered with. */
async function pick(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }): Promise<TrackDTO> {
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/tracks" && r.request().method() === "POST");
  await page.locator("[data-file-input]").setInputFiles(typeof file === "string" ? fixturePath(file) : file);
  const res = await response;
  expect(res.status()).toBe(201);
  const track = (await res.json()) as TrackDTO;
  await expect(result(page)).toHaveAttribute("data-id", track.id);
  return track;
}

/** Records every text the upload status takes and every progressbar value, in order. */
async function recordProgress(page: Page): Promise<() => Promise<{ statuses: string[]; values: string[] }>> {
  await page.evaluate(() => {
    const log = { statuses: [] as string[], values: [] as string[] };
    (window as unknown as { __progress: typeof log }).__progress = log;
    new MutationObserver(() => {
      const status = document.querySelector("[data-upload-status]")?.textContent ?? "";
      if (status && log.statuses.at(-1) !== status) log.statuses.push(status);
      const value = document.querySelector("[role=progressbar]")?.getAttribute("aria-valuenow");
      if (value && log.values.at(-1) !== value) log.values.push(value);
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  return () => page.evaluate(() => (window as unknown as { __progress: { statuses: string[]; values: string[] } }).__progress);
}

const background = (locator: Locator) => locator.evaluate((node) => getComputedStyle(node).backgroundColor);

test("wrong then right password", async ({ page }) => {
  // Browser logins carry no forwarded IP of their own; give this page one so reruns never hit the limit.
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}` });
  await page.goto("/");
  await page.locator("[data-sign-in]").click();
  const signIn = page.locator("dialog[data-sign-in-dialog]");
  await expect(signIn.getByRole("heading", { name: "Entrar no Jellyfin" })).toBeVisible();
  await expect(signIn).toHaveAccessibleName("Entrar no Jellyfin");
  await signIn.getByLabel("Usuário").fill(USERNAME);
  const password = signIn.getByLabel("Senha");
  await password.fill("errada");
  await signIn.getByRole("button", { name: "Entrar" }).click();
  await expect(signIn.getByRole("alert")).toHaveText("Usuário ou senha inválidos.");
  await expect(password).toBeFocused();

  await password.fill(PASSWORD);
  await password.press("Enter");
  await expect(dropPanel(page).getByRole("heading", { name: "Solte uma música aqui" })).toBeVisible();
  await expect(dropPanel(page)).toContainText("MP3, M4A, FLAC, OGG ou WAV, até 100 MB");

  // Signed in survives a reload; "Sair" signs out.
  await page.reload();
  await expect(dropPanel(page)).toBeVisible();
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
  await page.reload();
  await page.locator("[data-sign-in]").click();
  await expect(page.getByLabel("Usuário")).toBeVisible();
});

test("a second Enter while signing in signs in once and leaves one uploader", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}` });
  await page.goto("/");
  await page.locator("[data-sign-in]").click();
  const signIn = page.locator("dialog[data-sign-in-dialog]");
  await signIn.getByLabel("Usuário").fill(USERNAME);
  const password = signIn.getByLabel("Senha");
  await password.fill(PASSWORD);

  // Hold the session check that follows a right password, so the sign-in has not settled.
  const held: Route[] = [];
  let release = false;
  await page.route("**/api/session", (route) => {
    if (route.request().method() !== "GET" || release) return route.continue();
    held.push(route);
  });
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") posts.push(new URL(r.url()).pathname);
  });

  const check = page.waitForRequest((r) => new URL(r.url()).pathname === "/api/session" && r.method() === "GET");
  await password.press("Enter");
  await check;
  await expect(signIn.getByRole("button", { name: "Entrar" })).toBeDisabled();
  await password.press("Enter");
  release = true;
  for (const route of held.splice(0)) await route.continue();
  await expect(dropPanel(page)).toBeVisible();
  expect(posts.filter((p) => p === "/api/session")).toHaveLength(1);

  // One drop, one upload: no earlier owner view's window listeners are left behind.
  const bytes = fixture("song.mp3").toString("base64");
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/tracks" && r.request().method() === "POST");
  await page.evaluate((b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bin], "song.mp3", { type: "audio/mpeg" }));
    document.body.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, bytes);
  const track = (await (await response).json()) as TrackDTO;
  await expect(result(page)).toHaveAttribute("data-id", track.id);
  expect(posts.filter((p) => p === "/api/tracks")).toHaveLength(1);
});

test("upload shows progress then result with link", async ({ page }) => {
  await signIn(page);
  const progress = await recordProgress(page);
  const track = await pick(page, "song.mp3");

  const { statuses, values } = await progress();
  expect(statuses[0]).toMatch(/^Enviando… \d+%$/);
  expect(statuses).toContain("Procurando a letra…");
  expect(values).toContain("100");

  const panel = result(page);
  await expect(panel.getByRole("heading", { name: "Linha de Teste" })).toBeVisible();
  await expect(panel.getByText("Letra Fixtures", { exact: true })).toBeVisible();
  await expect(panel.locator("[data-lyrics-badge]")).toHaveText("Letra sincronizada");
  const cover = panel.locator("[data-cover] img");
  await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(panel.getByRole("textbox", { name: "Link" })).toHaveValue(track.shareUrl);
  await expect(panel.getByRole("link", { name: "Abrir" })).toHaveAttribute("href", track.shareUrl);

  // The drop panel is ready for the next file.
  await expect(dropPanel(page).getByRole("button", { name: "Escolher arquivo" })).toBeVisible();

  await panel.getByRole("button", { name: "Copiar link" }).click();
  await expect(panel.getByRole("button", { name: "Link copiado" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(track.shareUrl);
  await expect(panel.getByRole("button", { name: "Copiar link" })).toBeVisible({ timeout: 4000 });
});

test("Enviadas lists the new row first with highlight", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Músicas" })).toBeVisible();
  const track = await pick(page, "song.mp3");

  const first = page.locator("[data-row]").first();
  await expect(first).toHaveAttribute("data-id", track.id);
  await expect(first).toHaveAttribute("data-new", "");
  await expect(first.locator("[data-row-title]")).toHaveText("Linha de Teste");
  await expect(first.locator("[data-row-artist]")).toHaveText("Letra Fixtures");
  await expect(first.locator("[data-row-duration]")).toHaveText("0:08");
  await expect.poll(() => background(first)).toBe("rgba(255, 255, 255, 0.08)");

  // The highlight lasts until reload.
  await page.reload();
  await expect(row(page, track.id)).toBeVisible();
  await expect(row(page, track.id)).not.toHaveAttribute("data-new");
  await expect.poll(() => background(row(page, track.id))).toBe("rgba(0, 0, 0, 0)");
});

test("missing lyrics actions and paste", async ({ page }) => {
  await signIn(page);
  await pick(page, NO_LYRICS);
  const panel = result(page);
  await expect(panel.getByText("Não achamos a letra.")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Enviar .lrc" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Buscar de novo" })).toBeVisible();

  const paste = panel.getByRole("button", { name: "Colar letra" });
  await paste.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox").fill(fixture("sample.lrc").toString("utf8"));
  await dialog.getByRole("button", { name: "Salvar letra" }).click();
  await expect(toast(page)).toHaveText("Letra salva");
  await expect(dialog).toBeHidden();
  await expect(panel.locator("[data-lyrics-badge]")).toHaveText("Letra sincronizada");
  await expect(panel.getByText("Não achamos a letra.")).toBeHidden();
});

test("search again with nothing new, then send an .lrc file", async ({ page }) => {
  await signIn(page);
  await pick(page, NO_LYRICS);
  const panel = result(page);

  await panel.getByRole("button", { name: "Buscar de novo" }).click();
  await expect(toast(page)).toHaveText("Nenhuma letra nova encontrada");
  await expect(panel.getByText("Não achamos a letra.")).toBeVisible();

  const chooser = page.waitForEvent("filechooser");
  await panel.getByRole("button", { name: "Enviar .lrc" }).click();
  await (await chooser).setFiles(fixturePath("sample.lrc"));
  await expect(toast(page)).toHaveText("Letra salva");
  await expect(panel.locator("[data-lyrics-badge]")).toHaveText("Letra sincronizada");
});

test("an empty lyrics paste shows the server's message in the dialog", async ({ page }) => {
  await signIn(page);
  await pick(page, NO_LYRICS);
  await result(page).getByRole("button", { name: "Colar letra" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("   ");
  await dialog.getByRole("button", { name: "Salvar letra" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Cole a letra ou envie um arquivo .lrc.");
  await expect(dialog).toBeVisible();
});

test("edit title and artist", async ({ page }) => {
  await signIn(page);
  await pick(page, "song.mp3");
  const panel = result(page);
  await panel.getByRole("button", { name: "Editar" }).click();
  const title = panel.getByRole("textbox", { name: "Título" });
  const artist = panel.getByRole("textbox", { name: "Artista" });
  await expect(title).toHaveValue("Linha de Teste");
  await expect(title).toBeFocused();
  await expect(artist).toHaveValue("Letra Fixtures");

  // Cancel leaves the values alone.
  await title.fill("Descartado");
  await panel.getByRole("button", { name: "Cancelar" }).click();
  await expect(panel.getByRole("heading", { name: "Linha de Teste" })).toBeVisible();
});

test("missing tags open the title and artist fields", async ({ page }) => {
  await signIn(page);
  await pick(page, { ...NO_LYRICS, name: "Sem Nome.mp3" });
  const panel = result(page);
  await expect(panel.getByRole("textbox", { name: "Título" })).toHaveValue("Sem Nome");
  await expect(panel.getByRole("textbox", { name: "Artista" })).toHaveValue("Artista desconhecido");
});

test("a new upload's edit form starts from its own track", async ({ page }) => {
  await signIn(page);
  const first = await pick(page, { ...NO_LYRICS, name: "Sem Nome A.mp3" });
  const panel = result(page);
  const title = panel.getByRole("textbox", { name: "Título" });
  await expect(title).toHaveValue("Sem Nome A");
  await title.fill("Digitado e não salvo");

  const second = await pick(page, { ...NO_LYRICS, name: "Sem Nome B.mp3" });
  await expect(title).toHaveValue("Sem Nome B");
  await expect(panel.getByRole("textbox", { name: "Artista" })).toHaveValue("Artista desconhecido");

  const tracks = (await (await page.request.get("/api/tracks")).json()) as TrackDTO[];
  expect(tracks.find((t) => t.id === second.id)?.title).toBe("Sem Nome B");
  expect(tracks.find((t) => t.id === first.id)?.title).toBe("Sem Nome A");
});

test("delete asks and removes", async ({ page }) => {
  const track = await uploadFixture(page.request, "song.mp3");
  await page.goto("/");
  const item = row(page, track.id);
  await item.getByRole("button", { name: "Mais opções" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem")).toHaveText(["Copiar link", "Abrir", "Editar letra", "Apagar letra"]);
  await page.getByRole("menuitem", { name: "Apagar letra" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Apagar “Linha de Teste”? O link para de funcionar.");
  await dialog.getByRole("button", { name: "Apagar" }).click();
  await expect(toast(page)).toHaveText("Letra apagada");

  await page.goto(track.shareUrl);
  await expect(page.locator('[data-lyrics-state="none"]')).toContainText("A letra desta música não foi encontrada.");
});

test("menu and dialog close on Escape and give focus back", async ({ page }) => {
  const track = await uploadFixture(page.request, "song.mp3");
  await page.goto("/");
  const more = row(page, track.id).getByRole("button", { name: "Mais opções" });
  await more.click();
  await expect(page.getByRole("menuitem", { name: "Copiar link" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Abrir" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute("aria-expanded", "false");

  await more.press("Enter");
  await page.getByRole("menuitem", { name: "Apagar letra" }).press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancelar" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(more).toBeFocused();
  await expect(row(page, track.id)).toBeVisible();

  await more.click();
  await page.getByRole("menuitem", { name: "Editar letra" }).click();
  await expect(dialog.getByRole("textbox")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(more).toBeFocused();
});

test("row menu copies the link", async ({ page }) => {
  const track = await uploadFixture(page.request, "song.mp3");
  await page.goto("/");
  await row(page, track.id).getByRole("button", { name: "Mais opções" }).click();
  await page.getByRole("menuitem", { name: "Copiar link" }).click();
  await expect(toast(page)).toHaveText("Link copiado");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(track.shareUrl);
});

test("a file that is not audio is refused before upload", async ({ page }) => {
  await signIn(page);
  let posted = false;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/tracks" && r.method() === "POST") posted = true;
  });
  // The panel is reached with the keyboard: Tab from "Sair" lands on its button, and Enter
  // opens the picker. (The picker is observed through the input's click: Playwright's
  // filechooser event can miss a chooser opened by an immediate key press.)
  await page.getByRole("button", { name: "Sair" }).focus();
  await page.keyboard.press("Tab");
  await expect(dropPanel(page).getByRole("button", { name: "Escolher arquivo" })).toBeFocused();
  const input = page.locator("[data-file-input]");
  await input.evaluate((node) =>
    node.addEventListener("click", (e) => {
      e.preventDefault(); // no native picker in the test
      node.setAttribute("data-opened", "");
    }),
  );
  await page.keyboard.press("Enter");
  await expect(input).toHaveAttribute("data-opened", "");
  await input.setInputFiles({ name: "notas.txt", mimeType: "text/plain", buffer: Buffer.from("oi") });
  await expect(dropPanel(page).getByRole("alert")).toHaveText(
    "Esse arquivo não é um áudio que dá para tocar. Envie MP3, M4A, FLAC, OGG ou WAV.",
  );
  expect(posted).toBe(false);
});

test("drag over highlights the panel", async ({ page }) => {
  await signIn(page);
  const panel = dropPanel(page);
  const drag = (type: string, target: "window" | "body") =>
    page.evaluate(
      ([type, target]) => {
        const dt = new DataTransfer();
        dt.items.add(new File(["x"], "a.mp3", { type: "audio/mpeg" }));
        const event = new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true });
        (target === "window" ? window : document.body).dispatchEvent(event);
      },
      [type, target] as const,
    );

  await drag("dragenter", "window");
  await expect(panel).toHaveAttribute("data-dragging", "");
  await expect.poll(() => panel.evaluate((n) => getComputedStyle(n).borderTopColor)).toBe("rgb(255, 255, 255)");
  await drag("dragleave", "window");
  await expect(panel).not.toHaveAttribute("data-dragging");

  // A drop anywhere on the page uploads, not only on the panel.
  const bytes = fixture("song.mp3").toString("base64");
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/tracks" && r.request().method() === "POST");
  await page.evaluate((b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bin], "song.mp3", { type: "audio/mpeg" }));
    document.body.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt, bubbles: true, cancelable: true }));
    document.body.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, bytes);
  const track = (await (await response).json()) as TrackDTO;
  await expect(result(page)).toHaveAttribute("data-id", track.id);
  await expect(panel).not.toHaveAttribute("data-dragging");
});

test("no horizontal scroll at 360 px with a result and a list", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await signIn(page);
  await pick(page, NO_LYRICS);
  await expect(page.locator("[data-row]").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

test("owner view: drop panel on --surface with a dashed border", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  const panel = dropPanel(page);
  expect(await background(panel)).toBe("rgb(20, 20, 22)");
  const border = await panel.evaluate((node) => {
    const s = getComputedStyle(node);
    return { style: s.borderTopStyle, width: s.borderTopWidth, radius: s.borderTopLeftRadius };
  });
  expect(border).toEqual({ style: "dashed", width: "1px", radius: "16px" });
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(0, 0, 0)");
});

test("owner view: 56 px rows with a 40 px cover", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  const track = await pick(page, "song.mp3");
  const first = row(page, track.id);
  await expect(first).toBeVisible();
  expect((await first.boundingBox())?.height).toBe(56);
  const cover = first.locator("[data-cover]");
  const box = await cover.boundingBox();
  expect([box?.width, box?.height]).toEqual([40, 40]);
  expect(await cover.evaluate((node) => getComputedStyle(node).borderTopLeftRadius)).toBe("2px");
  expect(await first.locator("[data-row-duration]").evaluate((n) => getComputedStyle(n).fontVariantNumeric)).toContain("tabular-nums");

  // Larger text (a text-only zoom) makes the row taller instead of spilling out of it.
  await page.addStyleTag({ content: ".row-title, .row-artist { font-size: 28px !important; line-height: 36px !important; }" });
  await expect.poll(async () => (await first.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(72);
});

test("owner view: the Linhas salvas tab leads to the saved lines", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await signIn(page);
  const link = page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Linhas salvas" });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "/salvas");
  expect((await link.boundingBox())!.height).toBe(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

  await link.click();
  await expect(page).toHaveURL(/\/salvas$/);
  await expect(page.locator("[data-saved-view]")).toBeVisible();
});
