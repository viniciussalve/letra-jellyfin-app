import { readFileSync } from "node:fs";
import type { APIRequestContext, Page } from "@playwright/test";
import jsQR from "jsqr";
import type { TrackDTO } from "../../shared/types.ts";
import { expect, noFullscreenApi, test, uploadFixture } from "./helpers.ts";
import { decodePngRgba, pngDimensions } from "./png.ts";

// Desktop Chromium has no navigator.share: "Mais…" is absent and Stories downloads the
// card. The Web Share tests below define a stand-in before the page loads.
test.use({ locale: "pt-BR" });

const COVERLESS = "Letra Fixtures - Sem Tags.mp3";
const INSTRUMENTAL = "Letra Fixtures - Instrumental Teste.mp3";

const dialog = (page: Page) => page.locator("dialog[data-share-dialog]");
const shareButton = (page: Page) => page.locator("button[data-share]");
const action = (page: Page, name: string) => dialog(page).locator(`[data-share-action="${name}"]`);
const toast = (page: Page) => page.locator("[data-toast]");

async function open(page: Page, request: APIRequestContext, name = "song.mp3", asName?: string): Promise<TrackDTO> {
  const track = await uploadFixture(request, name, asName);
  await page.goto(track.shareUrl);
  await expect(shareButton(page)).toBeVisible();
  return track;
}

async function openShare(page: Page): Promise<void> {
  await shareButton(page).click();
  await expect(dialog(page)).toBeVisible();
}

/** The PNG of [data-share-qr], decoded with jsQR. */
async function decodeQr(page: Page): Promise<string | null> {
  const png = await dialog(page).locator("[data-share-qr]").screenshot({ animations: "disabled" });
  const { data, width, height } = decodePngRgba(png);
  return jsQR.default(data, width, height)?.data ?? null;
}

type ShareCall = {
  inClick: boolean;
  copied: string | null;
  files: { name: string; type: string; size: number }[];
  title?: string;
  text?: string;
  url?: string;
};

/**
 * A Web Share stand-in (as on phones): canShare accepts files, share records each call,
 * whether it ran inside the click's dispatch (window.event), and what the clipboard had
 * been asked to hold by then. `window.__abort = true` makes the next call an AbortError.
 */
async function fakeWebShare(page: Page): Promise<void> {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    const w = window as unknown as { __shareCalls: unknown[]; __abort: boolean };
    w.__shareCalls = [];
    w.__abort = false;
    let copied: string | null = null;
    const write = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = (text: string) => {
      copied = text;
      return write(text);
    };
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: (data?: ShareData) => Array.isArray(data?.files) && data.files.length > 0,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        w.__shareCalls.push({
          inClick: window.event?.type === "click",
          copied,
          files: (data.files ?? []).map((f) => ({ name: f.name, type: f.type, size: f.size })),
          title: data.title,
          text: data.text,
          url: data.url,
        });
        if (w.__abort) {
          w.__abort = false;
          throw new DOMException("Share canceled", "AbortError");
        }
      },
    });
  });
}

const shareCalls = (page: Page) => page.evaluate(() => (window as unknown as { __shareCalls: ShareCall[] }).__shareCalls);

/**
 * Holds every canvas.toBlob call until the test releases it: `__releaseCard(i, ok)` lets
 * call i encode (ok) or hand back null (a failed card). `__cardsDone[i]` turns true once
 * call i has handed its result to the page.
 */
async function holdCards(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const pending: Array<(ok: boolean) => void> = [];
    const done: boolean[] = [];
    const w = window as unknown as { __cards: typeof pending; __cardsDone: boolean[]; __releaseCard(i: number, ok: boolean): void };
    w.__cards = pending;
    w.__cardsDone = done;
    w.__releaseCard = (i, ok) => pending[i]!(ok);
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      const i = pending.length;
      const hand = (blob: Blob | null) => {
        callback(blob);
        done[i] = true;
      };
      pending.push((ok) => (ok ? toBlob.call(this, hand, type, quality) : hand(null)));
    };
  });
}

const cardBuilds = (page: Page) => page.evaluate(() => (window as unknown as { __cards: unknown[] }).__cards.length);
const cardDone = (page: Page, i: number) =>
  page.evaluate((i) => (window as unknown as { __cardsDone: boolean[] }).__cardsDone[i] === true, i);
const releaseCard = (page: Page, i: number, ok: boolean) =>
  page.evaluate(([i, ok]) => (window as unknown as { __releaseCard(i: number, ok: boolean): void }).__releaseCard(i, ok), [i, ok] as const);

test("opens from the share button and closes with Esc, returning focus", async ({ page, request }) => {
  await open(page, request);
  await shareButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toBeVisible();
  expect(await dialog(page).evaluate((d) => d.matches(":modal"))).toBe(true);
  await expect(page.locator("[data-share-close]")).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(shareButton(page)).toBeFocused();

  // The close button ("Fechar") and a click on the backdrop close it too.
  await shareButton(page).click();
  await expect(page.locator("[data-share-close]")).toHaveAccessibleName("Fechar");
  await page.locator("[data-share-close]").click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(shareButton(page)).toBeFocused();
  await shareButton(page).click();
  await page.mouse.click(4, 4);
  await expect(dialog(page)).toHaveCount(0);
});

test("the close button is a bare x-circle in a 44 px target", async ({ page, request }) => {
  await open(page, request);
  await openShare(page);
  const close = page.locator("[data-share-close]");
  // Layout sizes: the dialog's open animation scales its box for a moment.
  const look = await close.evaluate((node: HTMLElement) => {
    const svg = node.querySelector("svg")!;
    const s = getComputedStyle(node);
    return { size: [node.offsetWidth, node.offsetHeight], bg: s.backgroundColor, color: s.color, glyph: getComputedStyle(svg).width, path: svg.innerHTML };
  });
  expect(look.size).toEqual([44, 44]);
  expect(look.bg).toBe("rgba(0, 0, 0, 0)"); // no disc
  expect(look.color).toBe("rgb(175, 175, 182)"); // --text-2
  expect(look.glyph).toBe("28px");
  expect(look.path).toContain("M128,24A104,104"); // Phosphor x-circle (fill)
  await close.hover();
  await expect(close).toHaveCSS("color", "rgb(255, 255, 255)");
  // Keyboard focus still draws the ring.
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await expect(close).toHaveCSS("outline-style", "solid");
});

test("header shows title and artist; the dialog's accessible name is the title", async ({ page, request }) => {
  const track = await open(page, request);
  await openShare(page);
  await expect(dialog(page)).toHaveAccessibleName(track.title);
  await expect(dialog(page).getByRole("heading", { name: track.title })).toBeVisible();
  await expect(dialog(page).getByText(track.artist, { exact: true })).toBeVisible();
  await expect(dialog(page).getByRole("img", { name: "QR code do link da música" })).toBeVisible();
  // The actions in order, named by their labels; no "Mais…" without Web Share.
  await expect(dialog(page).locator("[data-share-action]")).toHaveText(["WhatsApp", "Stories", "X", "Copiar link"]);
  await expect(action(page, "more")).toHaveCount(0);
  for (const name of ["whatsapp", "stories", "x", "copy"]) {
    const b = (await action(page, name).boundingBox())!;
    expect(b.width).toBeGreaterThanOrEqual(56);
    expect(b.height).toBeGreaterThanOrEqual(56);
  }
});

test("WhatsApp and X links are exact", async ({ page, request }) => {
  const uploaded = await uploadFixture(request, "song.mp3");
  // Accents, quotes and & in the title must survive the encoding.
  const res = await request.patch(`/api/tracks/${uploaded.id}`, { data: { title: `Ação & "Reação"?` } });
  expect(res.ok()).toBe(true);
  const track = (await res.json()) as TrackDTO;
  await page.goto(track.shareUrl);
  await openShare(page);

  const text = `${track.title} — ${track.artist}`;
  const wa = action(page, "whatsapp");
  await expect(wa).toHaveAttribute("href", "https://wa.me/?text=" + encodeURIComponent(text + "\n" + track.shareUrl));
  const x = action(page, "x");
  await expect(x).toHaveAttribute(
    "href",
    "https://x.com/intent/tweet?text=" + encodeURIComponent(text) + "&url=" + encodeURIComponent(track.shareUrl),
  );
  for (const link of [wa, x]) {
    expect(await link.evaluate((a) => a.tagName)).toBe("A");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener");
  }
});

test("copy link shows the toast", async ({ page, request, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const track = await open(page, request);
  await openShare(page);
  await action(page, "copy").click();
  await expect(toast(page)).toHaveText("Link copiado");
  await expect(toast(page)).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(track.shareUrl);
  // The dialog stays open; the toast lives in it meanwhile (the rest of the page is inert under a modal).
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).locator("[data-toast]")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator("body > [data-toast]")).toHaveCount(1);
});

for (const [label, fixture] of [
  ["a covered track", "song.mp3"],
  ["a coverless upload", COVERLESS],
] as const) {
  test(`the QR decodes to the share URL (${label})`, async ({ page, request }) => {
    const track = await open(page, request, fixture);
    await openShare(page);
    const qr = dialog(page).locator("[data-share-qr]");
    if (track.hasCover) {
      const cover = qr.locator(`img[src="/media/${track.id}/cover.jpg"]`);
      await expect(cover).toBeVisible();
      await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    } else {
      await expect(qr.locator("img")).toHaveCount(0);
      await expect(qr.locator("[data-share-qr-tile]")).toBeVisible();
    }
    expect(await decodeQr(page)).toBe(track.shareUrl);
  });
}

for (const [label, fixture, asName] of [
  ["a track with lyrics", "song.mp3", undefined],
  ["an instrumental upload", COVERLESS, INSTRUMENTAL],
] as const) {
  test(`Stories downloads a 1080×1920 PNG on desktop (${label})`, async ({ page, request }) => {
    const track = await open(page, request, fixture, asName);
    await openShare(page);
    const stories = action(page, "stories");
    await expect(stories).toBeEnabled();
    await expect(stories).not.toHaveAttribute("aria-busy", "true");
    const [download] = await Promise.all([page.waitForEvent("download"), stories.click()]);
    expect(download.suggestedFilename()).toBe(`letra-${track.id}.png`);
    const meta = pngDimensions(readFileSync(await download.path()));
    expect(meta).toEqual({ width: 1080, height: 1920, format: "png" });
    await expect(toast(page)).toHaveText("Imagem salva. Poste nos Stories pelo celular.");
    await expect(dialog(page)).toBeVisible();
  });
}

test("Stories is busy until the card is ready", async ({ page, request }) => {
  await holdCards(page);
  await open(page, request);
  await openShare(page);
  const stories = action(page, "stories");
  await expect.poll(() => cardBuilds(page)).toBe(1);
  await expect(stories).toHaveAttribute("aria-busy", "true");
  await expect(stories).toBeDisabled();
  await releaseCard(page, 0, true);
  await expect(stories).toBeEnabled();
  await expect(stories).not.toHaveAttribute("aria-busy", "true");
});

test("a failed card keeps Stories enabled; a click explains and retries", async ({ page, request }) => {
  await holdCards(page);
  const track = await open(page, request);
  await openShare(page);
  const stories = action(page, "stories");
  await expect.poll(() => cardBuilds(page)).toBe(1);
  await releaseCard(page, 0, false);
  await expect(stories).toBeEnabled();
  await expect(stories).not.toHaveAttribute("aria-busy", "true");

  await stories.click();
  await expect(toast(page)).toHaveText("Não deu para gerar a imagem. Tente de novo.");
  await expect(dialog(page)).toBeVisible();
  await expect.poll(() => cardBuilds(page)).toBe(2); // the retry
  await expect(stories).toHaveAttribute("aria-busy", "true");
  await releaseCard(page, 1, true);
  await expect(stories).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent("download"), stories.click()]);
  expect(download.suggestedFilename()).toBe(`letra-${track.id}.png`);
});

test("the card's canvas is released once toBlob settles, on failure and on success", async ({ page, request }) => {
  await holdCards(page);
  // Runs after holdCards' script: records each canvas asked for a blob.
  await page.addInitScript(() => {
    const seen: HTMLCanvasElement[] = [];
    (window as unknown as { __canvases: HTMLCanvasElement[] }).__canvases = seen;
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      seen.push(this);
      return toBlob.apply(this, args);
    };
  });
  const size = (i: number) =>
    page.evaluate((i) => {
      const c = (window as unknown as { __canvases: HTMLCanvasElement[] }).__canvases[i]!;
      return [c.width, c.height];
    }, i);
  await open(page, request);
  await openShare(page);
  const stories = action(page, "stories");
  await expect.poll(() => cardBuilds(page)).toBe(1);
  expect(await size(0)).toEqual([1080, 1920]); // still held: toBlob has not answered
  await releaseCard(page, 0, false);
  await expect.poll(() => size(0)).toEqual([0, 0]);

  await stories.click(); // the retry
  await expect.poll(() => cardBuilds(page)).toBe(2);
  expect(await size(1)).toEqual([1080, 1920]);
  await releaseCard(page, 1, true);
  await expect(stories).not.toHaveAttribute("aria-busy", "true");
  await expect.poll(() => size(1)).toEqual([0, 0]);
  // The released canvas did not cost the card its pixels.
  const [download] = await Promise.all([page.waitForEvent("download"), stories.click()]);
  const png = pngDimensions(readFileSync(await download.path()));
  expect([png.width, png.height]).toEqual([1080, 1920]);
});

test("every open builds a new card, and a build from a closed dialog is ignored", async ({ page, request }) => {
  await holdCards(page);
  const track = await open(page, request);
  for (const builds of [1, 2]) {
    await openShare(page);
    await expect.poll(() => cardBuilds(page)).toBe(builds);
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
  }
  await openShare(page);
  await expect.poll(() => cardBuilds(page)).toBe(3);
  const stories = action(page, "stories");

  // The closed dialogs' builds land now, one failed and one done: this open is still drawing its own.
  await releaseCard(page, 0, false);
  await releaseCard(page, 1, true);
  await expect.poll(() => cardDone(page, 1)).toBe(true);
  expect(await stories.getAttribute("aria-busy")).toBe("true");

  await releaseCard(page, 2, true);
  await expect(stories).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent("download"), stories.click()]);
  expect(download.suggestedFilename()).toBe(`letra-${track.id}.png`);
  await expect(toast(page)).toHaveText("Imagem salva. Poste nos Stories pelo celular.");
});

test("with Web Share, Stories shares the card inside the tap and Mais… shares the link", async ({ page, request }) => {
  await fakeWebShare(page);
  const track = await open(page, request);
  await openShare(page);
  // The header button only opened the dialog.
  expect(await shareCalls(page)).toEqual([]);
  await expect(dialog(page).locator("[data-share-action]")).toHaveText(["WhatsApp", "Stories", "X", "Copiar link", "Mais…"]);

  const stories = action(page, "stories");
  await expect(stories).toBeEnabled();
  // A dismissed share sheet shows nothing.
  await page.evaluate(() => ((window as unknown as { __abort: boolean }).__abort = true));
  await stories.click();
  await expect.poll(async () => (await shareCalls(page)).length).toBe(1);
  await expect(toast(page)).not.toHaveClass(/is-shown/);

  await stories.click();
  await expect(toast(page)).toHaveText("Link copiado. Adicione o adesivo de link no Instagram.");
  const card = (await shareCalls(page))[1]!;
  expect(card).toMatchObject({ inClick: true, copied: track.shareUrl });
  expect(card.files).toHaveLength(1);
  expect(card.files[0]).toMatchObject({ name: `letra-${track.id}.png`, type: "image/png" });
  expect(card.files[0]!.size).toBeGreaterThan(0);

  await action(page, "more").click();
  await expect.poll(async () => (await shareCalls(page)).length).toBe(3);
  expect((await shareCalls(page))[2]).toMatchObject({
    inClick: true,
    files: [],
    title: track.title,
    text: `${track.title} — ${track.artist}`,
    url: track.shareUrl,
  });
  await expect(dialog(page)).toBeVisible();
});

test("the old header share sheet is gone", async ({ page, request }) => {
  await fakeWebShare(page);
  await open(page, request);
  await expect(page.locator("[data-share]")).toHaveCount(1);
  await expect(shareButton(page)).toHaveAccessibleName("Compartilhar");
  await shareButton(page).click();
  await expect(dialog(page)).toBeVisible();
  expect(await shareCalls(page)).toEqual([]);
});

test("player shortcuts stay off while the dialog is open", async ({ page, request }) => {
  await noFullscreenApi(page); // a wrongly-firing F then flips the state at once
  await open(page, request);
  await openShare(page);
  await page.keyboard.press("f");
  await expect(page.locator(".player")).toHaveAttribute("data-lyrics", "on");
  await expect(page.locator("[data-fullscreen]")).toHaveAttribute("aria-pressed", "false");
  await action(page, "whatsapp").focus();
  await page.keyboard.press(" ");
  expect(await page.evaluate(() => document.querySelector("audio")!.paused)).toBe(true);
});

test("phone renders the dialog as a bottom sheet", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, request);
  await openShare(page);
  await expect
    .poll(async () => {
      const b = (await dialog(page).boundingBox())!;
      return { bottom: Math.round(b.y + b.height), width: Math.round(b.width) };
    })
    .toEqual({ bottom: 844, width: 390 });
  await expect(dialog(page)).toHaveCSS("border-top-left-radius", "24px");
  await expect(dialog(page)).toHaveCSS("border-bottom-left-radius", "0px");
});

test("five actions fit in one row at 360 px, with a 200-character title", async ({ page, request }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await fakeWebShare(page);
  const uploaded = await uploadFixture(request, "song.mp3");
  const res = await request.patch(`/api/tracks/${uploaded.id}`, { data: { title: "T".repeat(200) } });
  expect(res.ok()).toBe(true);
  await page.goto(uploaded.shareUrl);
  await openShare(page);

  const boxes = await dialog(page).locator("[data-share-action]").evaluateAll((nodes) =>
    nodes.map((n) => {
      const r = n.getBoundingClientRect();
      return { top: Math.round(r.top), left: r.left, right: r.right, width: r.width, height: r.height };
    }),
  );
  expect(boxes).toHaveLength(5);
  for (const b of boxes) {
    expect(b.top).toBe(boxes[0]!.top);
    expect(b.left).toBeGreaterThanOrEqual(0);
    expect(b.right).toBeLessThanOrEqual(360);
    expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
  }
  await expect(dialog(page).locator("h2")).toHaveCSS("text-overflow", "ellipsis");
  expect(await dialog(page).evaluate((d) => d.scrollWidth <= d.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});
