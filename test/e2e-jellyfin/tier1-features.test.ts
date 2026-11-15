import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LineTranslationDTO, SummaryResponse, TrackDTO, TranslationDTO } from "../../shared/types.ts";
import {
  loadFixture,
  loadSampleLrc,
  loginAs,
  multipartBody,
  nextClientIp,
  parsePlayerData,
  startAppServer,
  type AppServerHandle,
} from "./helpers.ts";
import { startMockJellyfin, startMockLrclib, type MockJellyfinServer, type MockLrclibServer } from "./mock-jellyfin.ts";

describe("Tier 1: Feature Coverage (F1–F6)", () => {
  let jf: MockJellyfinServer;
  let lrclib: MockLrclibServer;
  let app: AppServerHandle;
  let libraryDir: string;
  let songBytes: Buffer;
  let coverBytes: Buffer;

  beforeAll(async () => {
    libraryDir = mkdtempSync(join(tmpdir(), "letra-t1-lib-"));
    songBytes = loadFixture("song.mp3");
    coverBytes = loadFixture("cover.png");
    jf = await startMockJellyfin({ libraryDir });
    lrclib = await startMockLrclib([
      {
        id: 101,
        trackName: "Sem Tags",
        artistName: "Letra Fixtures",
        albumName: null,
        duration: 8,
        instrumental: false,
        plainLyrics: "Verso do LRCLIB um\nVerso do LRCLIB dois",
        syncedLyrics: "[00:00.50]Verso do LRCLIB um\n[00:03.00]Verso do LRCLIB dois",
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
      id: "jftrack001",
      name: "Cancao Teste",
      artists: ["Artista Teste"],
      album: "Album Teste",
      runTimeTicks: 80_000_000,
      container: "mp3",
      audioBytes: songBytes,
      audioMime: "audio/mpeg",
      coverBytes,
      coverMime: "image/png",
      lyricsPayload: {
        Lyrics: [
          { Text: "Primeiro verso da musica", Start: 5_000_000 },
          { Text: "Segundo verso da musica", Start: 25_000_000 },
          { Text: "Terceiro verso da musica", Start: 45_000_000 },
        ],
      },
    });
    jf.addItem({
      id: "jftrack002",
      name: "Sem Letra",
      artists: ["Outro Artista"],
      album: null,
      runTimeTicks: 60_000_000,
      container: "mp3",
      audioBytes: songBytes,
      audioMime: "audio/mpeg",
      lyricsPayload: null,
    });
  });

  describe("F1: Health, SSR Pages & Static Asset Serving", () => {
    it("GET /healthz returns 200 ok when Jellyfin is reachable", async () => {
      const res = await fetch(`${app.baseUrl}/healthz`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
    });

    it("GET / serves upload/library SSR HTML with title and noindex meta", async () => {
      const res = await fetch(`${app.baseUrl}/`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      const html = await res.text();
      expect(html).toContain("<title>letra</title>");
      expect(html).toContain('name="robots" content="noindex, nofollow"');
    });

    it("GET /salvas and /salvas/ serve saved lines SSR HTML", async () => {
      for (const path of ["/salvas", "/salvas/"]) {
        const res = await fetch(`${app.baseUrl}${path}`);
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain("<title>Linhas salvas — letra</title>");
      }
    });

    it("GET /assets/* serves built Vite static assets with immutable cache headers", async () => {
      const homeHtml = await (await fetch(`${app.baseUrl}/`)).text();
      const assetMatch = /\/assets\/[^"'\s>]+/.exec(homeHtml);
      expect(assetMatch).not.toBeNull();
      const assetRes = await fetch(`${app.baseUrl}${assetMatch![0]}`);
      expect(assetRes.status).toBe(200);
      expect(assetRes.headers.get("cache-control")).toContain("immutable");
    });

    it("GET /t/:id returns 200 SSR HTML for an existing Jellyfin audio track", async () => {
      const res = await fetch(`${app.baseUrl}/t/jftrack001`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Cancao Teste");
      expect(html).toContain("Artista Teste");
    });
  });

  describe("F2: Dependency-Pruned Runtime (No SQLite / Sharp / Music-Metadata)", () => {
    it("GET /api/tracks/summary returns summaries backed by Jellyfin without SQLite", async () => {
      const res = await fetch(`${app.baseUrl}/api/tracks/summary?ids=jftrack001,jftrack002`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as SummaryResponse;
      expect(body.tracks.map((t) => t.id)).toEqual(["jftrack001", "jftrack002"]);
      expect(body.translationEnabled).toBe(true);
    });

    it("GET /media/:id/cover.jpg proxies Jellyfin cover bytes without sharp", async () => {
      const res = await fetch(`${app.baseUrl}/media/jftrack001/cover.jpg`);
      expect(res.status).toBe(200);
      const bytes = Buffer.from(await res.arrayBuffer());
      expect(bytes).toEqual(coverBytes);
    });

    it("GET /media/:id/og.jpg returns a valid image response without sharp", async () => {
      const res = await fetch(`${app.baseUrl}/media/jftrack001/og.jpg`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/^image\//);
      const bytes = Buffer.from(await res.arrayBuffer());
      expect(bytes.length).toBeGreaterThan(0);
    });

    it("GET /api/tracks/:id/translation works with JSON/in-memory cache without SQLite", async () => {
      const res = await fetch(`${app.baseUrl}/api/tracks/jftrack001/translation?lang=en`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as TranslationDTO;
      expect(body.lang).toBe("en");
      expect(body.lines).toHaveLength(3);
    });

    it("GET /api/session exposes maxUploadBytes without native dependencies", async () => {
      const res = await fetch(`${app.baseUrl}/api/session`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { maxUploadBytes: number };
      expect(body.maxUploadBytes).toBeGreaterThan(0);
    });
  });

  describe("F3: Jellyfin REST Client Integration", () => {
    it("POST /api/session authenticates via Jellyfin /Users/AuthenticateByName and sets HttpOnly cookie", async () => {
      const { response, cookie } = await loginAs(app.baseUrl, "jelly", "jelly-pass");
      expect(response.status).toBe(200);
      expect(cookie).toBeTruthy();
      expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    });

    it("GET /api/tracks lists audio items from Jellyfin /Items", async () => {
      const { cookie } = await loginAs(app.baseUrl, "jelly", "jelly-pass");
      const res = await fetch(`${app.baseUrl}/api/tracks`, {
        headers: { cookie: cookie! },
      });
      expect(res.status).toBe(200);
      const tracks = (await res.json()) as TrackDTO[];
      expect(tracks.length).toBeGreaterThanOrEqual(2);
      expect(tracks.some((t) => t.id === "jftrack001")).toBe(true);
    });

    it("GET /media/:id/audio proxies full audio stream from Jellyfin", async () => {
      const res = await fetch(`${app.baseUrl}/media/jftrack001/audio`);
      expect(res.status).toBe(200);
      expect(res.headers.get("accept-ranges")).toBe("bytes");
      const bytes = Buffer.from(await res.arrayBuffer());
      expect(bytes).toEqual(songBytes);
    });

    it("GET /media/:id/audio proxies Range requests with 206 Partial Content", async () => {
      const res = await fetch(`${app.baseUrl}/media/jftrack001/audio`, {
        headers: { Range: "bytes=0-511" },
      });
      expect(res.status).toBe(206);
      expect(res.headers.get("content-range")).toBe(`bytes 0-511/${songBytes.length}`);
      const chunk = Buffer.from(await res.arrayBuffer());
      expect(chunk).toEqual(songBytes.subarray(0, 512));
    });

    it("GET /t/:id converts Jellyfin Lyrics (.NET ticks) and Lines formats to ms in PlayerData", async () => {
      const res1 = await fetch(`${app.baseUrl}/t/jftrack001`);
      const data1 = parsePlayerData(await res1.text());
      expect(data1?.track.lyrics?.synced).toBe(true);
      expect(data1?.track.lyrics?.lines[0]).toEqual({ t: 500, text: "Primeiro verso da musica" });

      jf.addItem({
        id: "jftrack003",
        name: "Lines Format",
        artists: ["Artista Lines"],
        album: null,
        runTimeTicks: 50_000_000,
        audioBytes: songBytes,
        lyricsPayload: {
          Lines: [
            { Text: "Linha formato Lines", Start: 12_500_000 },
          ],
        },
      });
      const res2 = await fetch(`${app.baseUrl}/t/jftrack003`);
      const data2 = parsePlayerData(await res2.text());
      expect(data2?.track.lyrics?.lines[0]).toEqual({ t: 1250, text: "Linha formato Lines" });
    });
  });

  describe("F4: Config, Session & Translation Cache", () => {
    it("GET /api/session returns authenticated state for valid signed cookie", async () => {
      const anon = (await (await fetch(`${app.baseUrl}/api/session`)).json()) as { owner: boolean };
      expect(anon.owner).toBe(false);

      const { cookie } = await loginAs(app.baseUrl, "jelly", "jelly-pass");
      const authed = (await (await fetch(`${app.baseUrl}/api/session`, { headers: { cookie: cookie! } })).json()) as {
        owner: boolean;
      };
      expect(authed.owner).toBe(true);
    });

    it("DELETE /api/session clears session cookie and revokes access", async () => {
      const { cookie } = await loginAs(app.baseUrl, "jelly", "jelly-pass");
      const del = await fetch(`${app.baseUrl}/api/session`, {
        method: "DELETE",
        headers: { cookie: cookie! },
      });
      expect(del.status).toBe(204);
      expect(del.headers.get("set-cookie")).toContain("Max-Age=0");
    });

    it("GET /api/tracks/:id/translation translates full track via fake translator", async () => {
      const res = await fetch(`${app.baseUrl}/api/tracks/jftrack001/translation?lang=es`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as TranslationDTO;
      expect(body.lang).toBe("es");
      expect(body.lines).toHaveLength(3);
      expect(body.lines[0]).toBeTruthy();
    });

    it("repeated GET /api/tracks/:id/translation hits cache deterministically", async () => {
      const ip = nextClientIp();
      const first = (await (
        await fetch(`${app.baseUrl}/api/tracks/jftrack001/translation?lang=en`, {
          headers: { "x-forwarded-for": ip },
        })
      ).json()) as TranslationDTO;
      const second = (await (
        await fetch(`${app.baseUrl}/api/tracks/jftrack001/translation?lang=en`, {
          headers: { "x-forwarded-for": ip },
        })
      ).json()) as TranslationDTO;
      expect(second).toEqual(first);
    });

    it("GET /api/tracks/:id/translation/line translates a single line and caches it", async () => {
      const params = new URLSearchParams({
        index: "0",
        lang: "en",
        text: "Primeiro verso da musica",
      });
      const res = await fetch(`${app.baseUrl}/api/tracks/jftrack001/translation/line?${params}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as LineTranslationDTO;
      expect(body.lang).toBe("en");
      expect(body.text).toBeTruthy();
    });
  });

  describe("F5: Ported Routes & Upload-to-Jellyfin", () => {
    it("POST /api/tracks writes audio to JELLYFIN_LIBRARY_DIR and triggers POST /Library/Refresh", async () => {
      const { cookie } = await loginAs(app.baseUrl, "jelly", "jelly-pass");
      const beforeRefresh = jf.getRefreshCount();
      const { body, contentType } = multipartBody(
        {},
        [{ field: "file", filename: "Uploaded Song.mp3", contentType: "audio/mpeg", data: songBytes }],
      );
      const res = await fetch(`${app.baseUrl}/api/tracks`, {
        method: "POST",
        headers: { cookie: cookie!, "content-type": contentType },
        body,
      });
      expect(res.status).toBe(201);
      expect(jf.getRefreshCount()).toBeGreaterThan(beforeRefresh);
    });

    it("PUT /api/tracks/:id/lyrics with JSON uploads lyrics to Jellyfin", async () => {
      const { cookie } = await loginAs(app.baseUrl, "jelly", "jelly-pass");
      const res = await fetch(`${app.baseUrl}/api/tracks/jftrack002/lyrics`, {
        method: "PUT",
        headers: { cookie: cookie!, "content-type": "application/json" },
        body: JSON.stringify({ text: "[00:01.00]Nova linha manual" }),
      });
      expect(res.status).toBe(200);
      const updated = (await res.json()) as TrackDTO;
      expect(updated.lyrics?.lines[0].text).toBe("Nova linha manual");
      expect(jf.getItem("jftrack002")?.lyricsPayload?.Lyrics?.[0].Text).toBe("Nova linha manual");
    });

    it("PUT /api/tracks/:id/lyrics with multipart .lrc file uploads lyrics to Jellyfin", async () => {
      const { cookie } = await loginAs(app.baseUrl, "jelly", "jelly-pass");
      const lrc = loadSampleLrc();
      const { body, contentType } = multipartBody(
        {},
        [{ field: "file", filename: "sample.lrc", contentType: "text/plain", data: Buffer.from(lrc, "utf8") }],
      );
      const res = await fetch(`${app.baseUrl}/api/tracks/jftrack002/lyrics`, {
        method: "PUT",
        headers: { cookie: cookie!, "content-type": contentType },
        body,
      });
      expect(res.status).toBe(200);
      const updated = (await res.json()) as TrackDTO;
      expect(updated.lyrics?.lines).toHaveLength(4);
      expect(updated.lyrics?.lines[0].text).toBe("Primeiro verso da música");
    });

    it("POST /api/tracks/:id/lyrics/search resolves lyrics from LRCLIB and saves to Jellyfin", async () => {
      jf.addItem({
        id: "jftrack-lrclib",
        name: "Sem Tags",
        artists: ["Letra Fixtures"],
        album: null,
        runTimeTicks: 80_000_000,
        audioBytes: songBytes,
        lyricsPayload: null,
      });
      const { cookie } = await loginAs(app.baseUrl, "jelly", "jelly-pass");
      const res = await fetch(`${app.baseUrl}/api/tracks/jftrack-lrclib/lyrics/search`, {
        method: "POST",
        headers: { cookie: cookie! },
      });
      expect(res.status).toBe(200);
      const updated = (await res.json()) as TrackDTO;
      expect(updated.lyrics?.lines[0].text).toBe("Verso do LRCLIB um");
      expect(jf.getItem("jftrack-lrclib")?.lyricsPayload).not.toBeNull();
    });

    it("DELETE /api/tracks/:id/lyrics removes lyrics from Jellyfin", async () => {
      const { cookie } = await loginAs(app.baseUrl, "jelly", "jelly-pass");
      const res = await fetch(`${app.baseUrl}/api/tracks/jftrack001/lyrics`, {
        method: "DELETE",
        headers: { cookie: cookie! },
      });
      expect([200, 204]).toContain(res.status);
      expect(jf.getItem("jftrack001")?.lyricsPayload).toBeNull();
    });
  });

  describe("F6: Frontend SSR, OG & Deterministic Palette Contracts", () => {
    it("GET /t/:id embeds PlayerData with track, translationEnabled, and languages", async () => {
      const res = await fetch(`${app.baseUrl}/t/jftrack001`);
      const data = parsePlayerData(await res.text());
      expect(data).not.toBeNull();
      expect(data!.track.id).toBe("jftrack001");
      expect(data!.translationEnabled).toBe(true);
      expect(data!.languages.length).toBeGreaterThan(0);
    });

    it("GET /t/:id renders deterministic SSR palette CSS variables and theme-color", async () => {
      const html = await (await fetch(`${app.baseUrl}/t/jftrack001`)).text();
      expect(html).toMatch(/--mesh-1:#[0-9a-fA-F]{6}/);
      expect(html).toMatch(/--mesh-4:#[0-9a-fA-F]{6}/);
      expect(html).toMatch(/--scrim:/);
      expect(html).toMatch(/<meta name="theme-color" content="#[0-9a-fA-F]{6}">/);
    });

    it("GET /t/:id renders Open Graph and Twitter Card meta tags", async () => {
      const html = await (await fetch(`${app.baseUrl}/t/jftrack001`)).text();
      expect(html).toContain('<meta property="og:title" content="Cancao Teste">');
      expect(html).toContain('<meta property="og:type" content="music.song">');
      expect(html).toContain('/media/jftrack001/og.jpg">');
      expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    });

    it("GET /api/tracks/summary returns palette, hasCover, and durationMs per track", async () => {
      const res = await fetch(`${app.baseUrl}/api/tracks/summary?ids=jftrack001,jftrack002`);
      const body = (await res.json()) as SummaryResponse;
      const t1 = body.tracks.find((t) => t.id === "jftrack001");
      const t2 = body.tracks.find((t) => t.id === "jftrack002");
      expect(t1?.hasCover).toBe(true);
      expect(t1?.durationMs).toBe(8000);
      expect(t1?.palette.mesh).toHaveLength(4);
      expect(t2?.hasCover).toBe(false);
    });

    it("GET /t/:id shareUrl uses PUBLIC_URL and track id", async () => {
      const html = await (await fetch(`${app.baseUrl}/t/jftrack001`)).text();
      const data = parsePlayerData(html);
      expect(data?.track.shareUrl).toBe(`${app.baseUrl}/t/jftrack001`);
    });
  });
});
