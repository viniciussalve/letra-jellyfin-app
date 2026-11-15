import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LineTranslationDTO, SummaryResponse, TrackDTO, TranslationDTO } from "../../shared/types.ts";
import {
  loadFixture,
  loginAs,
  multipartBody,
  parsePlayerData,
  startAppServer,
  type AppServerHandle,
} from "./helpers.ts";
import { startMockJellyfin, startMockLrclib, type MockJellyfinServer, type MockLrclibServer } from "./mock-jellyfin.ts";

describe("Tier 3: Cross-Feature Combinations", () => {
  let jf: MockJellyfinServer;
  let lrclib: MockLrclibServer;
  let app: AppServerHandle;
  let libraryDir: string;
  let songBytes: Buffer;
  let noTagsBytes: Buffer;
  let coverBytes: Buffer;

  beforeAll(async () => {
    libraryDir = mkdtempSync(join(tmpdir(), "letra-t3-lib-"));
    songBytes = loadFixture("song.mp3");
    noTagsBytes = loadFixture("Letra Fixtures - Sem Tags.mp3");
    coverBytes = loadFixture("cover.png");
    jf = await startMockJellyfin({ libraryDir });
    lrclib = await startMockLrclib([
      {
        id: 201,
        trackName: "Sem Tags",
        artistName: "Letra Fixtures",
        albumName: null,
        duration: 8,
        instrumental: false,
        plainLyrics: "Verso LRCLIB A\nVerso LRCLIB B",
        syncedLyrics: "[00:01.00]Verso LRCLIB A\n[00:03.00]Verso LRCLIB B",
      },
    ]);
    app = await startAppServer({
      jellyfinUrl: jf.url,
      jellyfinApiKey: jf.apiKey,
      jellyfinLibraryDir: libraryDir,
      lrclibUrl: lrclib.url,
      translator: "fake",
    });
  });

  afterAll(async () => {
    await app?.stop();
    await lrclib?.close();
    await jf?.close();
    rmSync(libraryDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    jf.reset();
    jf.addItem({
      id: "jfcombo001",
      name: "Combo Song",
      artists: ["Combo Artist"],
      album: "Combo Album",
      runTimeTicks: 80_000_000,
      audioBytes: songBytes,
      audioMime: "audio/mpeg",
      coverBytes,
      coverMime: "image/png",
      lyricsPayload: {
        Lyrics: [
          { Text: "Primeira linha do combo", Start: 10_000_000 },
          { Text: "Segunda linha do combo", Start: 20_000_000 },
        ],
      },
    });
  });

  it("1. Auth + browse + stream (200 & 206) + translate + cache hit", async () => {
    const { cookie } = await loginAs(app.baseUrl, "jelly", "jelly-pass");
    const listRes = await fetch(`${app.baseUrl}/api/tracks`, { headers: { cookie: cookie! } });
    expect(listRes.status).toBe(200);
    const tracks = (await listRes.json()) as TrackDTO[];
    expect(tracks.some((t) => t.id === "jfcombo001")).toBe(true);

    const fullAudio = await fetch(`${app.baseUrl}/media/jfcombo001/audio`);
    expect(fullAudio.status).toBe(200);

    const rangeAudio = await fetch(`${app.baseUrl}/media/jfcombo001/audio`, {
      headers: { Range: "bytes=0-255" },
    });
    expect(rangeAudio.status).toBe(206);

    const t1 = (await (
      await fetch(`${app.baseUrl}/api/tracks/jfcombo001/translation?lang=pt-BR`)
    ).json()) as TranslationDTO;
    const t2 = (await (
      await fetch(`${app.baseUrl}/api/tracks/jfcombo001/translation?lang=pt-BR`)
    ).json()) as TranslationDTO;
    expect(t1.lines).toHaveLength(2);
    expect(t2).toEqual(t1);
  });

  it("2. Auth + upload + Library/Refresh + LRCLIB resolution + share OG page", async () => {
    const { cookie } = await loginAs(app.baseUrl, "jelly", "jelly-pass");
    const { body, contentType } = multipartBody(
      {},
      [{ field: "file", filename: "Letra Fixtures - Sem Tags.mp3", contentType: "audio/mpeg", data: noTagsBytes }],
    );
    const uploadRes = await fetch(`${app.baseUrl}/api/tracks`, {
      method: "POST",
      headers: { cookie: cookie!, "content-type": contentType },
      body,
    });
    expect(uploadRes.status).toBe(201);
    expect(jf.getRefreshCount()).toBeGreaterThanOrEqual(1);

    const created = (await uploadRes.json()) as TrackDTO;
    expect(created.lyrics?.lines[0].text).toBe("Verso LRCLIB A");

    const pageRes = await fetch(`${app.baseUrl}/t/${created.id}`);
    expect(pageRes.status).toBe(200);
    const html = await pageRes.text();
    expect(html).toContain('<meta property="og:title"');
    const data = parsePlayerData(html);
    expect(data?.track.id).toBe(created.id);
  });

  it("3. Manual lyrics update + translation cache invalidation + single-line translate", async () => {
    const firstTrans = (await (
      await fetch(`${app.baseUrl}/api/tracks/jfcombo001/translation?lang=pt-BR`)
    ).json()) as TranslationDTO;
    expect(firstTrans.lines).toHaveLength(2);

    const { cookie } = await loginAs(app.baseUrl, "jelly", "jelly-pass");
    const putRes = await fetch(`${app.baseUrl}/api/tracks/jfcombo001/lyrics`, {
      method: "PUT",
      headers: { cookie: cookie!, "content-type": "application/json" },
      body: JSON.stringify({
        text: "[00:01.00]Nova linha um\n[00:02.00]Nova linha dois\n[00:03.00]Nova linha tres",
      }),
    });
    expect(putRes.status).toBe(200);

    const secondTrans = (await (
      await fetch(`${app.baseUrl}/api/tracks/jfcombo001/translation?lang=pt-BR`)
    ).json()) as TranslationDTO;
    expect(secondTrans.lines).toHaveLength(3);
    expect(secondTrans.lines).not.toEqual(firstTrans.lines);

    const lineRes = await fetch(
      `${app.baseUrl}/api/tracks/jfcombo001/translation/line?index=1&lang=pt-BR&text=${encodeURIComponent("Nova linha dois")}`,
    );
    expect(lineRes.status).toBe(200);
    const lineBody = (await lineRes.json()) as LineTranslationDTO;
    expect(lineBody.text).toBeTruthy();
  });

  it("4. Public summary + /t/:id + media proxy without exposing Jellyfin token", async () => {
    const sumRes = await fetch(`${app.baseUrl}/api/tracks/summary?ids=jfcombo001`);
    expect(sumRes.status).toBe(200);
    const summary = (await sumRes.json()) as SummaryResponse;
    expect(summary.tracks).toHaveLength(1);

    const pageRes = await fetch(`${app.baseUrl}/t/jfcombo001`);
    const html = await pageRes.text();
    expect(html).not.toContain(jf.apiKey);

    const coverRes = await fetch(`${app.baseUrl}/media/jfcombo001/cover.jpg`);
    expect(coverRes.status).toBe(200);
    expect(Buffer.from(await coverRes.arrayBuffer())).toEqual(coverBytes);
  });

  it("5. Session isolation + logout revokes owner access immediately", async () => {
    const { cookie } = await loginAs(app.baseUrl, "jelly", "jelly-pass");
    const okRes = await fetch(`${app.baseUrl}/api/tracks`, { headers: { cookie: cookie! } });
    expect(okRes.status).toBe(200);

    const logoutRes = await fetch(`${app.baseUrl}/api/session`, {
      method: "DELETE",
      headers: { cookie: cookie! },
    });
    expect(logoutRes.status).toBe(204);

    // Unauthenticated client cannot access owner routes
    const unauthRes = await fetch(`${app.baseUrl}/api/tracks`);
    expect(unauthRes.status).toBe(401);
  });

  it("6. LRCLIB search miss preserves existing manual lyrics on track", async () => {
    const { cookie } = await loginAs(app.baseUrl, "jelly", "jelly-pass");
    jf.addItem({
      id: "jfcombo-keep",
      name: "Unmatched Song Title",
      artists: ["Unknown"],
      album: null,
      runTimeTicks: 50_000_000,
      audioBytes: songBytes,
      lyricsPayload: {
        Lyrics: [{ Text: "Preserved manual line", Start: 10_000_000 }],
      },
    });

    const res = await fetch(`${app.baseUrl}/api/tracks/jfcombo-keep/lyrics/search`, {
      method: "POST",
      headers: { cookie: cookie! },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as TrackDTO;
    expect(body.lyrics?.lines[0].text).toBe("Preserved manual line");
  });
});
