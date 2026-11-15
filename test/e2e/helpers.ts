import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test as base, type APIRequestContext, type Page } from "@playwright/test";
import type { TrackDTO } from "../../shared/types.ts";
import type { SavedLine } from "../../web/shared/saved.ts";

export const PASSWORD = "e2e-pass";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url));

/** A made-up client address for X-Forwarded-For, which the E2E server trusts from loopback. */
export const randomIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

/**
 * Playwright's `test`, with each test's browser context sending its own X-Forwarded-For. The
 * server's per-client limits would otherwise add up across tests, as every page comes from loopback.
 */
export const test = base.extend({
  context: async ({ context }, use) => {
    await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
    await use(context);
  },
});

export { expect };

/**
 * Signs the request context in as the owner (the session cookie stays in its jar).
 * Each call sends its own X-Forwarded-For, which the E2E server trusts from
 * loopback, so many logins never trip the 5/min limit.
 */
export async function login(request: APIRequestContext): Promise<void> {
  const res = await request.post("/api/session", { data: { password: PASSWORD }, headers: { "x-forwarded-for": randomIp() } });
  if (!res.ok()) throw new Error(`login failed: ${res.status()} ${await res.text()}`);
}

/**
 * Logs in and uploads a file from test/fixtures. `asName` sends the same bytes under
 * another file name: untagged audio takes its title from it, which picks the LRCLIB
 * stub's answer ("… - Sem Tags.mp3" synced, "… - Instrumental Teste.mp3"
 * instrumental, any other title none).
 */
export async function uploadFixture(request: APIRequestContext, name: string, asName: string = name): Promise<TrackDTO> {
  await login(request);
  const res = await request.post("/api/tracks", {
    multipart: { file: { name: asName, mimeType: "audio/mpeg", buffer: fixture(name) } },
  });
  if (res.status() !== 201) throw new Error(`upload failed: ${res.status()} ${await res.text()}`);
  return (await res.json()) as TrackDTO;
}

/** Init script: the page behaves as on a browser without the Fullscreen API (iPhone Safari). */
export const noFullscreenApi = (page: Page) =>
  page.addInitScript(() => Object.defineProperty(Document.prototype, "fullscreenEnabled", { get: () => false }));

/** Init script: every full-screen request is refused, as when the browser denies it. */
export const refuseFullscreen = (page: Page) =>
  page.addInitScript(() => {
    Element.prototype.requestFullscreen = () => Promise.reject(new TypeError("denied"));
  });

/** Uploads song.mp3 under a title of our own (the owner session lives in `request`, not in the page). */
export async function upload(request: APIRequestContext, title: string, artist = "Artista Teste"): Promise<TrackDTO> {
  const track = await uploadFixture(request, "song.mp3");
  const res = await request.patch(`/api/tracks/${track.id}`, { data: { title, artist } });
  expect(res.ok()).toBe(true);
  return (await res.json()) as TrackDTO;
}

/** Opens a track's share page, which records it among the listener's recents. */
export async function visit(page: Page, track: TrackDTO): Promise<void> {
  await page.goto(track.shareUrl);
  await expect(page.locator("[data-play]")).toBeVisible();
}

/** Replaces a track's lyrics as the owner would (LRC lines for synced, plain lines for unsynced). */
export async function setLyrics(request: APIRequestContext, track: TrackDTO, text: string): Promise<TrackDTO> {
  const res = await request.put(`/api/tracks/${track.id}/lyrics`, { data: { text } });
  expect(res.ok()).toBe(true);
  return (await res.json()) as TrackDTO;
}

/** A saved line for a verse of the track, with the text and time the lyrics hold. */
export function savedLine(track: TrackDTO, index: number, over: Partial<SavedLine> = {}): SavedLine {
  const line = track.lyrics?.lines[index];
  if (!line) throw new Error(`track ${track.id} has no line ${index}`);
  return {
    trackId: track.id,
    title: track.title,
    artist: track.artist,
    hasCover: track.hasCover,
    index,
    t: line.t,
    text: line.text,
    lang: track.lyricsLang,
    tr: null,
    at: Date.now(),
    ...over,
  };
}

/**
 * Init script that stores the lines before the page's own scripts run. It writes once per tab
 * (a sessionStorage flag), so a reload keeps whatever the page changed since.
 */
export async function seedSaved(page: Page, lines: SavedLine[]): Promise<void> {
  await page.addInitScript((list) => {
    try {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("letra.saved.v1", JSON.stringify(list));
    } catch {
      // storage blocked
    }
  }, lines);
}
