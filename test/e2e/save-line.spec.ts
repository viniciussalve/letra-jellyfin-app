import type { APIRequestContext, Locator, Page } from "@playwright/test";
import type { TrackDTO } from "../../shared/types.ts";
import type { SavedLine } from "../../web/shared/saved.ts";
import { expect, noFullscreenApi, randomIp, setLyrics, test, uploadFixture } from "./helpers.ts";

test.use({ locale: "pt-BR" });

const LINES = [
  "Primeiro verso da música",
  "Segundo verso, um pouco mais longo para quebrar a linha em telas estreitas",
  "Terceiro verso",
  "Último verso",
];
const COPY = {
  hint: "Linha salva. Elas ficam em Linhas salvas.",
  full: "Você chegou ao limite de 1000 linhas salvas. Remova algumas para salvar novas.",
  blocked: "Não foi possível salvar neste navegador.",
};

const verse = (page: Page, i: number) => page.locator(`[data-verse][data-index="${i}"]`);
const saveIcon = (page: Page, i: number) => verse(page, i).locator(".verse-save");
const pill = (page: Page) => page.locator("[data-save-line]");
const status = (page: Page) => page.locator("[data-save-status]");
const toast = (page: Page) => page.locator("[data-toast]");

/** The saved lines as stored (`letra.saved.v1`), parsed. */
const stored = (page: Page): Promise<SavedLine[]> =>
  page.evaluate(() => JSON.parse(localStorage.getItem("letra.saved.v1") ?? "[]") as SavedLine[]);

const audioState = (page: Page) =>
  page.evaluate(() => {
    const a = document.querySelector("audio")!;
    return { t: a.currentTime, paused: a.paused };
  });

/** Two animation frames: the status region is filled in the frame after a toggle. */
const nextFrames = (page: Page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

async function open(page: Page, request: APIRequestContext): Promise<TrackDTO> {
  const track = await uploadFixture(request, "song.mp3");
  await page.goto(track.shareUrl);
  await expect(verse(page, 0)).toBeVisible();
  return track;
}

test("clicking the icon saves the verse and does not seek", async ({ page, request }) => {
  const track = await open(page, request);
  await saveIcon(page, 1).click();
  await expect(verse(page, 1)).toHaveAttribute("data-saved", "");
  expect(await audioState(page)).toEqual({ t: 0, paused: true });
  const list = await stored(page);
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({
    trackId: track.id,
    title: track.title,
    artist: track.artist,
    hasCover: track.hasCover,
    index: 1,
    t: 2500,
    text: LINES[1],
    lang: track.lyricsLang,
    tr: null,
  });
  expect(typeof list[0]!.at).toBe("number");
});

test("clicking it again removes the save", async ({ page, request }) => {
  await open(page, request);
  await saveIcon(page, 1).click();
  await expect(verse(page, 1)).toHaveAttribute("data-saved", "");
  await saveIcon(page, 1).click();
  await expect(verse(page, 1)).not.toHaveAttribute("data-saved");
  expect(await stored(page)).toEqual([]);
});

test("Enter on a verse seeks and does not save", async ({ page, request }) => {
  await open(page, request);
  await verse(page, 0).focus();
  await page.keyboard.press("ArrowDown");
  await expect(verse(page, 1)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await audioState(page)).t).toBeGreaterThanOrEqual(2.5);
  expect(await stored(page)).toEqual([]);
  await expect(verse(page, 1)).not.toHaveAttribute("data-saved");
});

test("S saves the focused verse, else the playing one", async ({ page, request }) => {
  await open(page, request);
  await verse(page, 0).focus();
  await page.keyboard.press("ArrowDown");
  await expect(verse(page, 1)).toBeFocused();
  await page.keyboard.press("s");
  await expect(verse(page, 1)).toHaveAttribute("data-saved", "");
  expect((await stored(page)).map((l) => l.index)).toEqual([1]);

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.evaluate(() => {
    document.querySelector("audio")!.currentTime = 4.6;
  });
  await expect(verse(page, 2)).toHaveAttribute("data-state", "active");
  await page.keyboard.press("s");
  await expect(verse(page, 2)).toHaveAttribute("data-saved", "");
  expect((await stored(page)).map((l) => l.index).sort()).toEqual([1, 2]);
});

/** Moves the song to `t` seconds and holds it there, so the playing verse stays put. */
const seekPaused = (page: Page, t: number) =>
  page.evaluate((to) => {
    const a = document.querySelector("audio")!;
    a.pause();
    a.currentTime = to;
  }, t);

test("after a click on a verse, S saves the playing verse, not the clicked one", async ({ page, request }) => {
  await open(page, request);
  await verse(page, 0).click();
  await expect(verse(page, 0)).toBeFocused();
  await seekPaused(page, 4.6);
  await expect(verse(page, 2)).toHaveAttribute("data-state", "active");
  await page.keyboard.press("s");
  await expect(verse(page, 2)).toHaveAttribute("data-saved", "");
  expect((await stored(page)).map((l) => l.index)).toEqual([2]);
  await expect(verse(page, 0)).not.toHaveAttribute("data-saved");
});

test("after saving with the icon, S saves the playing verse and keeps the first save", async ({ page, request }) => {
  await open(page, request);
  await saveIcon(page, 1).click();
  await expect(verse(page, 1)).toHaveAttribute("data-saved", "");
  await seekPaused(page, 4.6);
  await expect(verse(page, 2)).toHaveAttribute("data-state", "active");
  await page.keyboard.press("s");
  await expect(verse(page, 2)).toHaveAttribute("data-saved", "");
  await expect(verse(page, 1)).toHaveAttribute("data-saved", "");
  expect((await stored(page)).map((l) => l.index).sort()).toEqual([1, 2]);
});

test("reached by Shift+Tab from the controls, the button after the lyrics names the playing verse and keeps it", async ({ page, request }) => {
  await open(page, request);
  await seekPaused(page, 2.6);
  await expect(verse(page, 1)).toHaveAttribute("data-state", "active");
  await page.locator("[data-play]").focus();
  for (let i = 0; i < 5 && !(await pill(page).evaluate((e) => e === document.activeElement)); i++) await page.keyboard.press("Shift+Tab");
  await expect(pill(page)).toBeFocused();
  await expect(pill(page)).toHaveAccessibleName(`Salvar linha: ${LINES[1]}`);

  // The song moves on: the name does not move under the listener.
  await page.evaluate(() => {
    document.querySelector("audio")!.currentTime = 4.6;
  });
  await expect(verse(page, 2)).toHaveAttribute("data-state", "active");
  await nextFrames(page);
  await expect(pill(page)).toHaveAccessibleName(`Salvar linha: ${LINES[1]}`);
  await page.keyboard.press("Enter");
  await expect(verse(page, 1)).toHaveAttribute("data-saved", "");
  expect((await stored(page)).map((l) => l.index)).toEqual([1]);
});

test("S does nothing in the cover view, under the share dialog or with the language menu open", async ({ page, request }) => {
  await noFullscreenApi(page);
  // Translation is limited per IP: this page gets its own.
  await page.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
  await open(page, request);

  await page.locator("[data-fullscreen]").click();
  await expect(page.locator("#app")).toHaveAttribute("data-lyrics", "off");
  await page.keyboard.press("s");
  await nextFrames(page);
  expect(await stored(page)).toEqual([]);
  await page.locator("[data-fullscreen]").click();
  await expect(page.locator("#app")).toHaveAttribute("data-lyrics", "on");

  await page.locator("[data-share]").click();
  await expect(page.locator("dialog[data-share-dialog]")).toBeVisible();
  await page.keyboard.press("s");
  await nextFrames(page);
  expect(await stored(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[data-share-dialog]")).toBeHidden();

  await page.locator("[data-translate]").click();
  await expect(verse(page, 0).locator(".verse-translation")).toBeVisible();
  await page.locator("[data-language]").click();
  await expect(page.getByRole("menu", { name: "Idiomas" })).toBeVisible();
  await page.keyboard.press("s");
  await nextFrames(page);
  expect(await stored(page)).toEqual([]);

  // Once the menu is closed, the same key saves.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "Idiomas" })).toBeHidden();
  await page.keyboard.press("s");
  await expect.poll(async () => (await stored(page)).length).toBe(1);
});

test("the button after the lyrics is the next Tab stop, names the line and toggles it", async ({ page, request }) => {
  await open(page, request);
  await verse(page, 0).focus();
  await page.keyboard.press("ArrowDown");
  await expect(verse(page, 1)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(pill(page)).toBeFocused();
  await expect(pill(page)).toHaveAccessibleName(`Salvar linha: ${LINES[1]}`);
  await expect(pill(page)).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Enter");
  await expect(pill(page)).toHaveAttribute("aria-pressed", "true");
  await expect(pill(page)).toHaveAccessibleName(/^Remover linha salva: /);
  await expect(verse(page, 1)).toHaveAttribute("data-saved", "");
});

test("every save and removal is announced", async ({ page, request }) => {
  await open(page, request);
  await expect(status(page)).toHaveAttribute("role", "status");
  await expect(status(page)).toHaveAttribute("aria-live", "polite");
  await expect(status(page)).toHaveText("");
  await saveIcon(page, 1).click();
  await expect(status(page)).toHaveText("Linha salva");
  await saveIcon(page, 1).click();
  await expect(status(page)).toHaveText("Linha removida");

  await page.evaluate(() => {
    const w = window as unknown as { __fills: number };
    w.__fills = 0;
    const region = document.querySelector("[data-save-status]")!;
    new MutationObserver((records) => {
      for (const r of records) if (r.addedNodes.length > 0 && region.textContent) w.__fills++;
    }).observe(region, { childList: true, characterData: true, subtree: true });
  });
  const fills = () => page.evaluate(() => (window as unknown as { __fills: number }).__fills);
  await saveIcon(page, 0).click();
  await expect.poll(fills).toBe(1);
  await expect(status(page)).toHaveText("Linha salva");
  await saveIcon(page, 2).click();
  await expect.poll(fills).toBe(2);
  await expect(status(page)).toHaveText("Linha salva");
});

test("the first-save toast shows once per browser", async ({ page, request }) => {
  await open(page, request);
  await saveIcon(page, 1).click();
  await expect(toast(page)).toHaveClass(/is-shown/);
  await expect(toast(page)).toHaveText(COPY.hint);
  expect(await page.evaluate(() => localStorage.getItem("letra.saved.hint.v1"))).not.toBeNull();

  await page.reload();
  await expect(verse(page, 1)).toHaveAttribute("data-saved", "");
  await saveIcon(page, 2).click();
  await expect(verse(page, 2)).toHaveAttribute("data-saved", "");
  await expect(status(page)).toHaveText("Linha salva");
  await expect(toast(page)).not.toHaveClass(/is-shown/);
});

test("on a phone the first-save toast takes the width it needs", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, request);
  await saveIcon(page, 1).click();
  await expect(toast(page)).toHaveClass(/is-shown/);
  const box = (await toast(page).boundingBox())!;
  expect(box.width).toBeGreaterThan(300);
  expect(box.width).toBeLessThanOrEqual(358);
  expect(Math.abs(box.x + box.width / 2 - 195)).toBeLessThanOrEqual(1);
});

test("at the limit, the message shows and nothing is saved", async ({ page, request }) => {
  const others: SavedLine[] = Array.from({ length: 1000 }, (_, i) => ({
    trackId: "outra-musica",
    title: "Outra",
    artist: "Alguém",
    hasCover: false,
    index: i,
    t: null,
    text: `Linha ${i}`,
    lang: null,
    tr: null,
    at: 1_700_000_000_000 + i,
  }));
  await page.addInitScript((list) => localStorage.setItem("letra.saved.v1", JSON.stringify(list)), others);
  await open(page, request);
  await saveIcon(page, 1).click();
  await expect(toast(page)).toHaveClass(/is-shown/);
  await expect(toast(page)).toHaveText(COPY.full);
  await expect(verse(page, 1)).not.toHaveAttribute("data-saved");
  expect(await stored(page)).toHaveLength(1000);
});

test("when the browser refuses the write, the message shows and nothing looks saved", async ({ page, request }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("refused", "QuotaExceededError");
    };
  });
  await open(page, request);
  await saveIcon(page, 1).click();
  await expect(toast(page)).toHaveClass(/is-shown/);
  await expect(toast(page)).toHaveText(COPY.blocked);
  await nextFrames(page);
  await expect(verse(page, 1)).not.toHaveAttribute("data-saved");
  await expect(status(page)).toHaveText("");
});

test("the translation on screen is stored with the line", async ({ page, request }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
  await open(page, request);
  await page.locator("[data-translate]").click();
  const line = verse(page, 1).locator(".verse-translation");
  await expect(line).toHaveText(`[pt-BR] ${LINES[1]}`);
  await saveIcon(page, 1).click();
  await expect(verse(page, 1)).toHaveAttribute("data-saved", "");
  const [record] = await stored(page);
  expect(record!.tr).toEqual({ lang: "pt-BR", text: `[pt-BR] ${LINES[1]}` });
});

test("two tabs stay in step", async ({ page, request }) => {
  const track = await open(page, request);
  const other = await page.context().newPage();
  await other.goto(track.shareUrl);
  await expect(verse(other, 1)).toBeVisible();

  await saveIcon(page, 1).click();
  await expect(verse(page, 1)).toHaveAttribute("data-saved", "");
  await expect(verse(other, 1)).toHaveAttribute("data-saved", "");
  await saveIcon(page, 1).click();
  await expect(verse(page, 1)).not.toHaveAttribute("data-saved");
  await expect(verse(other, 1)).not.toHaveAttribute("data-saved");
});

test("a line edited after it was saved no longer shows as saved", async ({ page, request }) => {
  const track = await open(page, request);
  await saveIcon(page, 1).click();
  await expect(verse(page, 1)).toHaveAttribute("data-saved", "");

  await setLyrics(request, track, `[00:00.50]${LINES[0]}\n[00:02.50]Outro texto\n[00:04.50]${LINES[2]}\n[00:06.50]${LINES[3]}`);
  await page.reload();
  await expect(verse(page, 1).locator(".verse-text")).toHaveText("Outro texto");
  await expect(verse(page, 1)).not.toHaveAttribute("data-saved");
  const before = await stored(page);
  expect(before).toHaveLength(1);
  expect(before[0]!.text).toBe(LINES[1]);

  await saveIcon(page, 1).click();
  await expect(verse(page, 1)).toHaveAttribute("data-saved", "");
  const after = await stored(page);
  expect(after).toHaveLength(1);
  expect(after[0]!.text).toBe("Outro texto");
});

test("unsynced lyrics: each line has its own save button, and they are one Tab stop", async ({ page, request }) => {
  const uploaded = await uploadFixture(request, "song.mp3");
  const track = await setLyrics(request, uploaded, "Linha um\nLinha dois\n\nLinha três");
  await page.goto(track.shareUrl);
  const buttons = page.locator("button.verse-save");
  await expect(buttons).toHaveCount(3);
  await expect(page.locator('button.verse-save[tabindex="0"]')).toHaveCount(1);

  await page.locator('button.verse-save[tabindex="0"]').focus();
  await expect(buttons.nth(0)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(buttons.nth(1)).toBeFocused();
  await expect(buttons.nth(1)).toHaveAccessibleName("Salvar linha: Linha dois");
  await page.keyboard.press("Enter");
  await expect(buttons.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(buttons.nth(1)).toHaveAccessibleName("Remover linha salva: Linha dois");

  const list = await stored(page);
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ t: null, text: "Linha dois", index: track.lyrics!.lines.findIndex((l) => l.text === "Linha dois") });
  await expect(page.locator("[data-save-line]")).toHaveCount(0);
});

test("unsynced lyrics: S acts on the tapped verse", async ({ page, request }) => {
  const uploaded = await uploadFixture(request, "song.mp3");
  const track = await setLyrics(request, uploaded, "Linha um\nLinha dois\n\nLinha três");
  await page.goto(track.shareUrl);
  await page.getByText("Linha três", { exact: true }).click();
  await page.keyboard.press("s");
  await expect.poll(async () => (await stored(page)).length).toBe(1);
  expect((await stored(page))[0]!.text).toBe("Linha três");
});

const opacityOf = (l: Locator) => l.evaluate((e) => Number(getComputedStyle(e).opacity));
const seek = (page: Page, t: number) =>
  page.evaluate((to) => {
    document.querySelector("audio")!.currentTime = to;
  }, t);

test("the icon shows under the pointer, on keyboard focus and on a saved verse", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, request);
  const icon = saveIcon(page, 1);
  await expect.poll(() => opacityOf(icon)).toBe(0);
  await verse(page, 1).hover();
  await expect.poll(() => opacityOf(icon)).toBe(1);
  await page.mouse.move(2, 2);
  await expect.poll(() => opacityOf(icon)).toBe(0);

  await page.keyboard.press("Tab");
  await verse(page, 1).focus();
  await expect(verse(page, 1)).toBeFocused();
  await expect.poll(() => opacityOf(icon)).toBe(1);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect.poll(() => opacityOf(icon)).toBe(0);

  await verse(page, 1).hover();
  await icon.click();
  await expect(verse(page, 1)).toHaveAttribute("data-saved", "");
  await page.mouse.move(2, 2);
  await expect.poll(() => opacityOf(icon)).toBe(1);
});

test("without hover the icon shows on the playing verse, and a tap where a hidden one sits seeks", async ({ browser, request, baseURL }) => {
  const track = await uploadFixture(request, "song.mp3");
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": randomIp() }, baseURL, hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  try {
    const p = await context.newPage();
    await p.goto(track.shareUrl);
    await expect(verse(p, 0)).toBeVisible();
    expect(await p.evaluate(() => matchMedia("(hover: hover)").matches)).toBe(false);
    await seek(p, 4.6);
    await expect(verse(p, 2)).toHaveAttribute("data-state", "active");
    await expect.poll(() => opacityOf(saveIcon(p, 2))).toBe(1);
    for (const i of [0, 1, 3]) expect(await opacityOf(saveIcon(p, i))).toBe(0);

    const box = (await saveIcon(p, 0).boundingBox())!;
    await p.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await p.evaluate(() => document.querySelector("audio")!.pause());
    await expect(verse(p, 0)).toHaveAttribute("data-state", "active");
    expect(await stored(p)).toEqual([]);
    await expect.poll(() => opacityOf(saveIcon(p, 0))).toBe(1);

    await saveIcon(p, 0).tap();
    await expect(verse(p, 0)).toHaveAttribute("data-saved", "");
    expect((await stored(p)).map((l) => l.index)).toEqual([0]);
  } finally {
    await context.close();
  }
});

for (const size of [
  { width: 1440, height: 900 },
  { width: 360, height: 640 },
]) {
  test(`the icon is a 44 px target inside the verse, clear of the text (${size.width}x${size.height})`, async ({ page, request }) => {
    await page.setViewportSize(size);
    await open(page, request);
    await seek(page, 2.6);
    await expect(verse(page, 1)).toHaveAttribute("data-state", "active");
    // The playing verse is not scaled: its icon is 44 by 44 on screen.
    await expect.poll(async () => (await saveIcon(page, 1).boundingBox())!.width).toBeCloseTo(44, 1);
    for (const i of [0, 1]) {
      const icon = (await saveIcon(page, i).boundingBox())!;
      const text = (await verse(page, i).locator(".verse-text").boundingBox())!;
      const box = (await verse(page, i).boundingBox())!;
      if (i === 1) expect(icon.height).toBeCloseTo(44, 1);
      expect(icon.x).toBeGreaterThanOrEqual(text.x + text.width - 0.5);
      expect(icon.x + icon.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
    }
  });
}

test("on a dimmed saved verse the icon still has a 44 px target", async ({ browser, request, baseURL }) => {
  const track = await uploadFixture(request, "song.mp3");
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": randomIp() }, baseURL, hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  try {
    const p = await context.newPage();
    await p.goto(track.shareUrl);
    await expect(verse(p, 0)).toBeVisible();
    // A font that arrives late wraps the verses again under the reading.
    await p.evaluate(() => document.fonts.ready);
    // The saved verse comes after the playing one, so it rests inside the lyrics' box however the
    // verses wrap: a verse before the playing one can sit partly above the box's top edge.
    await seek(p, 4.6);
    await expect(verse(p, 2)).toHaveAttribute("data-state", "active");
    await saveIcon(p, 2).tap();
    await expect(verse(p, 2)).toHaveAttribute("data-saved", "");
    await seek(p, 0.6);
    await expect(verse(p, 0)).toHaveAttribute("data-state", "active");
    // Wait for the dim scale to settle: the glyph shrinks with its verse.
    await expect.poll(async () => (await verse(p, 2).boundingBox())!.width / (await verse(p, 2).evaluate((e) => (e as HTMLElement).offsetWidth))).toBeCloseTo(0.9, 2);
    // And for the lyrics to stop scrolling, so the icon is read at rest.
    await expect
      .poll(async () => {
        const before = (await saveIcon(p, 2).boundingBox())!.y;
        await nextFrames(p);
        return Math.abs((await saveIcon(p, 2).boundingBox())!.y - before);
      })
      .toBeLessThan(0.05);
    const read = await saveIcon(p, 2).evaluate((icon) => {
      const r = icon.getBoundingClientRect();
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      const box = document.querySelector(".lyrics-scroll")!.getBoundingClientRect();
      return {
        inside: cy - 22 >= box.top && cy + 22 <= box.bottom,
        hits: [[0, 0], [-21, 0], [21, 0], [0, -21], [0, 21]].map(([dx, dy]) => {
          const hit = document.elementFromPoint(cx + dx!, cy + dy!);
          return hit !== null && icon.contains(hit);
        }),
      };
    });
    expect(read.inside).toBe(true);
    expect(read.hits).toEqual([true, true, true, true, true]);
  } finally {
    await context.close();
  }
});

test("a saved verse has the filled icon and the soft background", async ({ page, request }) => {
  await open(page, request);
  await saveIcon(page, 1).click();
  const v = verse(page, 1);
  await expect(v).toHaveAttribute("data-saved", "");
  await expect.poll(() => opacityOf(v.locator(".save-filled"))).toBe(1);
  expect(await opacityOf(v.locator(".save-outline"))).toBe(0);
  await expect
    .poll(() => v.evaluate((e) => getComputedStyle(e, "::before").opacity))
    .toBe("1");
  const before = await v.evaluate((e) => {
    const s = getComputedStyle(e, "::before");
    return { bg: s.backgroundColor, radius: s.borderTopLeftRadius };
  });
  expect(before).toEqual({ bg: "rgba(255, 255, 255, 0.08)", radius: "14px" });
});

const popAnimations = (l: Locator) =>
  l.evaluate((e) =>
    e.getAnimations().map((a) => ({
      name: (a as CSSAnimation).animationName ?? null,
      duration: Number(a.effect?.getComputedTiming().duration),
    })),
  );

test("saving pops with the spring; removing does not", async ({ page, request }) => {
  // Each pop that starts on verse 1's filled icon, with its duration, recorded in the page as it
  // starts: a slow runner could otherwise read it after its 350 ms are over.
  await page.addInitScript(() => {
    const w = window as unknown as { __pops: { name: string; duration: number }[] };
    w.__pops = [];
    window.addEventListener(
      "animationstart",
      (e) => {
        const target = e.target instanceof Element ? e.target : null;
        if (!target?.matches('[data-verse][data-index="1"] .save-filled')) return;
        w.__pops.push({ name: e.animationName, duration: Number.parseFloat(getComputedStyle(target).animationDuration) * 1000 });
      },
      true,
    );
  });
  const pops = () => page.evaluate(() => (window as unknown as { __pops: { name: string; duration: number }[] }).__pops.filter((p) => p.name === "save-pop"));
  await open(page, request);
  const filled = verse(page, 1).locator(".save-filled");
  await saveIcon(page, 1).click();
  await expect.poll(pops).toEqual([{ name: "save-pop", duration: 350 }]);
  await expect.poll(async () => (await popAnimations(filled)).filter((a) => a.name === "save-pop").length).toBe(0);

  await saveIcon(page, 1).click();
  await expect(verse(page, 1)).not.toHaveAttribute("data-saved");
  expect((await popAnimations(filled)).filter((a) => a.name === "save-pop")).toEqual([]);
  await nextFrames(page);
  expect(await pops()).toHaveLength(1);
  expect(await filled.evaluate((e) => getComputedStyle(e).transitionDuration)).toBe("0.15s");
});

test("a mark that arrives from the store does not pop or fade in", async ({ page, request }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __motion: { type: string; pseudo: string; el: Element }[] };
    w.__motion = [];
    for (const type of ["transitionrun", "animationstart"]) {
      window.addEventListener(
        type,
        (e) => {
          const ev = e as TransitionEvent;
          if (e.target instanceof Element) w.__motion.push({ type, pseudo: ev.pseudoElement, el: e.target });
        },
        true,
      );
    }
  });
  await open(page, request);
  await saveIcon(page, 1).click();
  await expect(verse(page, 1)).toHaveAttribute("data-saved", "");
  await page.reload();
  await expect(verse(page, 1)).toHaveAttribute("data-saved", "");
  await nextFrames(page);
  const own = await page.evaluate(() => {
    const w = window as unknown as { __motion: { type: string; pseudo: string; el: Element }[] };
    const v = document.querySelector('[data-verse][data-index="1"]')!;
    return w.__motion.filter((m) => (m.pseudo === "::before" && m.el === v) || (m.el.closest(".verse-save") !== null && v.contains(m.el))).length;
  });
  expect(own).toBe(0);
  await expect(page.locator(".is-popping")).toHaveCount(0);
});

test("saving again during a pop plays the second pop whole", async ({ page, request }) => {
  await open(page, request);
  await verse(page, 1).hover();
  // The second pop must end by finishing, not by being cut off by the first one's cancel.
  const outcome = await page.evaluate(async () => {
    const icon = document.querySelector<HTMLElement>('[data-verse][data-index="1"] .verse-save')!;
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    icon.click(); // save: the first pop starts
    // A few frames: the first pop is running and its start has been dispatched.
    await frame();
    await frame();
    await frame();
    icon.click(); // remove
    icon.click(); // save again while the first pop still runs
    const pops = icon.querySelector(".save-filled")!.getAnimations().filter((a) => (a as CSSAnimation).animationName === "save-pop");
    if (pops.length !== 1) return `${pops.length} animations`;
    return pops[0]!.finished.then(
      () => "finished",
      () => "canceled",
    );
  });
  expect(outcome).toBe("finished");
});

test("a saved verse that is not playing still dims and blurs", async ({ page, request }) => {
  await open(page, request);
  await saveIcon(page, 0).click();
  await expect(verse(page, 0)).toHaveAttribute("data-saved", "");
  await seek(page, 4.6);
  await expect(verse(page, 2)).toHaveAttribute("data-state", "active");
  await expect.poll(() => opacityOf(verse(page, 0))).toBeLessThan(1);
  expect(await verse(page, 0).getAttribute("data-blur")).not.toBe("0");
  expect(await verse(page, 0).getAttribute("data-blur")).not.toBeNull();
});

test("the save pill shows only with keyboard focus, and the back pill gives way", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, request);
  const back = page.locator("[data-back-to-current]");
  await page.locator(".lyrics-scroll").hover();
  await page.mouse.wheel(0, 300);
  await expect(back).toBeVisible();
  await expect.poll(() => opacityOf(back)).toBe(1);

  await verse(page, 1).focus();
  await page.keyboard.press("Tab");
  await expect(pill(page)).toBeFocused();
  await expect(pill(page)).toBeVisible();
  const box = (await pill(page).boundingBox())!;
  const lyrics = (await page.locator(".lyrics").boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(lyrics.x);
  expect(box.x + box.width).toBeLessThanOrEqual(lyrics.x + lyrics.width);
  expect(box.y).toBeGreaterThanOrEqual(lyrics.y);
  expect(box.y + box.height).toBeLessThanOrEqual(lyrics.y + lyrics.height);
  expect(box.height).toBeCloseTo(44, 0);
  expect(await opacityOf(pill(page))).toBe(1);
  await expect(pill(page)).toContainText("Salvar linha");
  await expect.poll(() => opacityOf(back)).toBe(0);

  // The back pill is invisible but sits on top: a click on the save pill must reach the save pill.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(pill(page)).toHaveAttribute("aria-pressed", "true");
  await expect(pill(page)).toContainText("Remover linha salva");
  await expect(pill(page)).toHaveAccessibleName(/^Remover linha salva: /);

  await page.keyboard.press("Shift+Tab");
  await expect(verse(page, 1)).toBeFocused();
  await expect.poll(() => pill(page).evaluate((e) => getComputedStyle(e).clipPath)).toBe("inset(50%)");
  expect((await pill(page).boundingBox())!.width).toBeLessThanOrEqual(1);
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("saving runs no pop", async ({ page, request }) => {
    await open(page, request);
    await saveIcon(page, 1).click();
    await expect(verse(page, 1)).toHaveAttribute("data-saved", "");
    const durations = await verse(page, 1)
      .locator(".save-filled")
      .evaluate((e) => e.getAnimations().map((a) => Number(a.effect?.getComputedTiming().duration)));
    for (const d of durations) expect(d).toBeLessThanOrEqual(1);
  });
});

test("no horizontal scroll at 360 px with a saved verse", async ({ page, request }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await open(page, request);
  await saveIcon(page, 1).click();
  await expect(verse(page, 1)).toHaveAttribute("data-saved", "");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  // The page and the scroller clip their overflow, so look at the scroller itself.
  const scroller = await page.locator(".lyrics-scroll").evaluate((e) => [e.scrollWidth, e.clientWidth]);
  expect(scroller[0]).toBe(scroller[1]);
});

test("without hover, the picked verse of unsynced lyrics shows its icon", async ({ browser, request, baseURL }) => {
  const uploaded = await uploadFixture(request, "song.mp3");
  const track = await setLyrics(request, uploaded, "Linha um\nLinha dois\n\nLinha três");
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": randomIp() }, baseURL, hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  try {
    const p = await context.newPage();
    await p.goto(track.shareUrl);
    const icons = p.locator("button.verse-save");
    await expect(icons).toHaveCount(3);
    await expect.poll(() => opacityOf(icons.nth(0))).toBe(1);
    expect(await opacityOf(icons.nth(2))).toBe(0);
    await p.getByText("Linha três", { exact: true }).tap();
    await expect.poll(() => opacityOf(icons.nth(2))).toBe(1);
    await expect.poll(() => opacityOf(icons.nth(0))).toBe(0);
  } finally {
    await context.close();
  }
});

test("the marks follow the store when the page comes back from the back/forward cache", async ({ page, request }) => {
  const track = await uploadFixture(request, "song.mp3");
  await page.goto(track.shareUrl);
  await expect(verse(page, 0)).not.toHaveAttribute("data-saved", "");
  await page.evaluate((t) => {
    const line = { trackId: t.id, title: t.title, artist: t.artist, hasCover: t.hasCover, index: 0, t: 500, text: "Primeiro verso da música", lang: t.lyricsLang, tr: null, at: Date.now() };
    localStorage.setItem("letra.saved.v1", JSON.stringify([line]));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  }, track);
  await expect(verse(page, 0)).toHaveAttribute("data-saved", "");
});
