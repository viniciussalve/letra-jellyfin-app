import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ApiError, SummaryResponse, TrackDTO } from "../../shared/types.ts";
import {
  loadFixture,
  loginAs,
  multipartBody,
  nextClientIp,
  parsePlayerData,
  startAppServer,
  type AppServerHandle,
} from "./helpers.ts";
import { startMockJellyfin, type MockJellyfinServer } from "./mock-jellyfin.ts";

describe("Tier 2: Boundary & Corner Cases", () => {
  let jf: MockJellyfinServer;
  let app: AppServerHandle;
  let libraryDir: string;
  let songBytes: Buffer;
  let notAudioBytes: Buffer;

  beforeAll(async () => {
    libraryDir = mkdtempSync(join(tmpdir(), "letra-t2-lib-"));
    songBytes = loadFixture("song.mp3");
    notAudioBytes = loadFixture("not-audio.mp3");
    jf = await startMockJellyfin({ libraryDir });
    app = await startAppServer({
      jellyfinUrl: jf.url,
      jellyfinApiKey: jf.apiKey,
      jellyfinLibraryDir: libraryDir,
      translator: "fake",
      env: { MAX_UPLOAD_BYTES: "65536" },
    });
  });

  afterAll(async () => {
    await app?.stop();
    await jf?.close();
    rmSync(libraryDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    jf.reset();
    jf.addItem({
      id: "jfbound001",
      name: "Boundary Track",
      artists: ["Boundary Artist"],
      album: null,
      runTimeTicks: 80_000_000,
      audioBytes: songBytes,
      audioMime: "audio/mpeg",
      lyricsPayload: {
        Lyrics: [
          { Text: "Linha um", Start: 1_000_000 },
          { Text: "Linha dois", Start: 2_000_000 },
        ],
      },
    });
    jf.addItem({
      id: "jfbound002",
      name: "No Lyrics Track",
      artists: ["Silent Artist"],
      album: null,
      runTimeTicks: 50_000_000,
      audioBytes: songBytes,
      audioMime: "audio/mpeg",
      lyricsPayload: null,
    });
  });

  describe("Auth & Session Boundaries", () => {
    it("POST /api/session with wrong password returns 401", async () => {
      const { response } = await loginAs(app.baseUrl, "jelly", "wrong-password");
      expect(response.status).toBe(401);
    });

    it("POST /api/session with empty credentials returns 400 or 401", async () => {
      const { response } = await loginAs(app.baseUrl, "", "");
      expect([400, 401]).toContain(response.status);
    });

    it("protected routes reject requests without session cookie with 401", async () => {
      const listRes = await fetch(`${app.baseUrl}/api/tracks`);
      expect(listRes.status).toBe(401);

      const putRes = await fetch(`${app.baseUrl}/api/tracks/jfbound001/lyrics`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Linha" }),
      });
      expect(putRes.status).toBe(401);
    });

    it("tampered session cookie is rejected with 401", async () => {
      const res = await fetch(`${app.baseUrl}/api/tracks`, {
        headers: { cookie: "letra_session=tampered.invalidSignature" },
      });
      expect(res.status).toBe(401);
    });

    it("POST /api/session rate-limits after 5 attempts from same IP with 429", async () => {
      const ip = nextClientIp();
      for (let i = 0; i < 5; i += 1) {
        const { response } = await loginAs(app.baseUrl, "jelly", "bad", { ip });
        expect(response.status).toBe(401);
      }
      const { response: sixth } = await loginAs(app.baseUrl, "jelly", "bad", { ip });
      expect(sixth.status).toBe(429);
    });
  });

  describe("Media & Range Boundaries", () => {
    it("GET /media/:id/audio with out-of-range Range header returns 416", async () => {
      const res = await fetch(`${app.baseUrl}/media/jfbound001/audio`, {
        headers: { Range: "bytes=99999999-" },
      });
      expect(res.status).toBe(416);
    });

    it("GET /media/:id/audio for nonexistent track returns 404", async () => {
      const res = await fetch(`${app.baseUrl}/media/does-not-exist/audio`);
      expect(res.status).toBe(404);
    });

    it("GET /media/:id/cover.jpg for track without cover returns 404", async () => {
      const res = await fetch(`${app.baseUrl}/media/jfbound001/cover.jpg`);
      expect(res.status).toBe(404);
    });

    it("GET /media/:id/cover.jpg for nonexistent track returns 404", async () => {
      const res = await fetch(`${app.baseUrl}/media/does-not-exist/cover.jpg`);
      expect(res.status).toBe(404);
    });

    it("GET /t/:id for nonexistent track returns 404 HTML with PlayerData = null", async () => {
      const res = await fetch(`${app.baseUrl}/t/does-not-exist`);
      expect(res.status).toBe(404);
      const html = await res.text();
      expect(parsePlayerData(html)).toBeNull();
    });
  });

  describe("Lyrics Parsing & Upload Boundaries", () => {
    it("PUT /api/tracks/:id/lyrics with empty/whitespace text returns 400", async () => {
      const { cookie } = await loginAs(app.baseUrl, "jelly", "jelly-pass");
      const res = await fetch(`${app.baseUrl}/api/tracks/jfbound001/lyrics`, {
        method: "PUT",
        headers: { cookie: cookie!, "content-type": "application/json" },
        body: JSON.stringify({ text: "   \n  " }),
      });
      expect(res.status).toBe(400);
    });

    it("PUT /api/tracks/:id/lyrics strips UTF-8 BOM before parsing", async () => {
      const { cookie } = await loginAs(app.baseUrl, "jelly", "jelly-pass");
      const res = await fetch(`${app.baseUrl}/api/tracks/jfbound002/lyrics`, {
        method: "PUT",
        headers: { cookie: cookie!, "content-type": "application/json" },
        body: JSON.stringify({ text: "\uFEFF[00:01.00]Com BOM" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as TrackDTO;
      expect(body.lyrics?.lines[0].text).toBe("Com BOM");
      expect(body.lyrics?.lines[0].t).toBe(1000);
    });

    it("PUT /api/tracks/:id/lyrics handles malformed LRC timestamps without 500", async () => {
      const { cookie } = await loginAs(app.baseUrl, "jelly", "jelly-pass");
      const res = await fetch(`${app.baseUrl}/api/tracks/jfbound002/lyrics`, {
        method: "PUT",
        headers: { cookie: cookie!, "content-type": "application/json" },
        body: JSON.stringify({ text: "[xx:yy.zz]Texto malformado\nLinha normal" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as TrackDTO;
      expect(body.lyrics?.lines.length).toBeGreaterThan(0);
    });

    it("POST /api/tracks with non-audio extension returns 415", async () => {
      const { cookie } = await loginAs(app.baseUrl, "jelly", "jelly-pass");
      const { body, contentType } = multipartBody(
        {},
        [{ field: "file", filename: "notes.txt", contentType: "text/plain", data: Buffer.from("hello") }],
      );
      const res = await fetch(`${app.baseUrl}/api/tracks`, {
        method: "POST",
        headers: { cookie: cookie!, "content-type": contentType },
        body,
      });
      expect(res.status).toBe(415);
    });

    it("POST /api/tracks with missing file returns 400 and invalid audio returns 415", async () => {
      const { cookie } = await loginAs(app.baseUrl, "jelly", "jelly-pass");
      const emptyMp = multipartBody({}, []);
      const noFile = await fetch(`${app.baseUrl}/api/tracks`, {
        method: "POST",
        headers: { cookie: cookie!, "content-type": emptyMp.contentType },
        body: emptyMp.body,
      });
      expect(noFile.status).toBe(400);

      const badMp = multipartBody(
        {},
        [{ field: "file", filename: "not-audio.mp3", contentType: "audio/mpeg", data: notAudioBytes }],
      );
      const badAudio = await fetch(`${app.baseUrl}/api/tracks`, {
        method: "POST",
        headers: { cookie: cookie!, "content-type": badMp.contentType },
        body: badMp.body,
      });
      expect([400, 415]).toContain(badAudio.status);
    });

    it("POST /api/tracks exceeding MAX_UPLOAD_BYTES returns 413", async () => {
      const { cookie } = await loginAs(app.baseUrl, "jelly", "jelly-pass");
      const big = Buffer.alloc(128 * 1024, 0xff);
      const { body, contentType } = multipartBody(
        {},
        [{ field: "file", filename: "too-big.mp3", contentType: "audio/mpeg", data: big }],
      );
      const res = await fetch(`${app.baseUrl}/api/tracks`, {
        method: "POST",
        headers: { cookie: cookie!, "content-type": contentType },
        body,
      });
      expect(res.status).toBe(413);
    });
  });

  describe("Translation Boundaries", () => {
    it("GET /api/tracks/:id/translation with unsupported lang returns 400", async () => {
      const res = await fetch(`${app.baseUrl}/api/tracks/jfbound001/translation?lang=xx`);
      expect(res.status).toBe(400);
      const body = (await res.json()) as ApiError;
      expect(body.error.code).toBe("bad_language");
    });

    it("GET /api/tracks/:id/translation on track with no lyrics returns 404", async () => {
      const res = await fetch(`${app.baseUrl}/api/tracks/jfbound002/translation?lang=en`);
      expect(res.status).toBe(404);
      const body = (await res.json()) as ApiError;
      expect(body.error.code).toBe("no_lyrics");
    });

    it("GET /api/tracks/:id/translation/line with stale text returns 404 line_changed", async () => {
      const params = new URLSearchParams({ index: "0", lang: "en", text: "Texto antigo que mudou" });
      const res = await fetch(`${app.baseUrl}/api/tracks/jfbound001/translation/line?${params}`);
      expect(res.status).toBe(404);
      const body = (await res.json()) as ApiError;
      expect(body.error.code).toBe("line_changed");
    });

    it("GET /api/tracks/:id/translation/line with negative or non-numeric index returns 400", async () => {
      const params = new URLSearchParams({ index: "-1", lang: "en", text: "Linha um" });
      const res = await fetch(`${app.baseUrl}/api/tracks/jfbound001/translation/line?${params}`);
      expect(res.status).toBe(400);
    });

    it("TRANSLATOR=off returns 404 translation_off on translation endpoints", async () => {
      const offApp = await startAppServer({
        jellyfinUrl: jf.url,
        jellyfinApiKey: jf.apiKey,
        jellyfinLibraryDir: libraryDir,
        translator: "off",
      });
      try {
        const res = await fetch(`${offApp.baseUrl}/api/tracks/jfbound001/translation?lang=en`);
        expect(res.status).toBe(404);
        const body = (await res.json()) as ApiError;
        expect(body.error.code).toBe("translation_off");

        const lineRes = await fetch(
          `${offApp.baseUrl}/api/tracks/jfbound001/translation/line?index=0&lang=en&text=Linha+um`,
        );
        expect(lineRes.status).toBe(404);
      } finally {
        await offApp.stop();
      }
    });
  });

  describe("Summary & Query Boundaries", () => {
    it("GET /api/tracks/summary without ids returns 400", async () => {
      const res = await fetch(`${app.baseUrl}/api/tracks/summary`);
      expect(res.status).toBe(400);
    });

    it("GET /api/tracks/summary with >50 ids returns 400", async () => {
      const ids = Array.from({ length: 51 }, (_, i) => `id${String(i).padStart(8, "0")}`).join(",");
      const res = await fetch(`${app.baseUrl}/api/tracks/summary?ids=${ids}`);
      expect(res.status).toBe(400);
    });

    it("GET /api/tracks/summary with unknown ids returns empty tracks array", async () => {
      const res = await fetch(`${app.baseUrl}/api/tracks/summary?ids=unknown001,unknown002`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as SummaryResponse;
      expect(body.tracks).toEqual([]);
    });
  });

  describe("SSR & Missing WEB_DIR Boundaries", () => {
    it("GET /t/:id escapes HTML special characters in track title and artist (XSS protection)", async () => {
      jf.addItem({
        id: "jfxss00001",
        name: '<script>alert("xss")</script>',
        artists: ['Artist & "Friends"'],
        album: null,
        runTimeTicks: 50_000_000,
        audioBytes: songBytes,
      });
      const res = await fetch(`${app.baseUrl}/t/jfxss00001`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).not.toContain('<script>alert("xss")</script>');
      expect(html).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
    });

    it("missing WEB_DIR returns 503 on /, /salvas, and /t/:id", async () => {
      const noWebApp = await startAppServer({
        jellyfinUrl: jf.url,
        jellyfinApiKey: jf.apiKey,
        jellyfinLibraryDir: libraryDir,
        webDir: join(tmpdir(), "nonexistent-web-dir-letra"),
      });
      try {
        for (const path of ["/", "/salvas", "/t/jfbound001"]) {
          const res = await fetch(`${noWebApp.baseUrl}${path}`);
          expect(res.status).toBe(503);
        }
      } finally {
        await noWebApp.stop();
      }
    });
  });

  describe("Upstream Jellyfin Fault Injection Boundaries", () => {
    it("upstream Jellyfin 500 on /Items returns 502/503 from GET /api/tracks", async () => {
      const { cookie } = await loginAs(app.baseUrl, "jelly", "jelly-pass");
      jf.setFault("GET /Items", 500, { once: true });
      const res = await fetch(`${app.baseUrl}/api/tracks`, {
        headers: { cookie: cookie! },
      });
      expect([502, 503]).toContain(res.status);
    });

    it("upstream Jellyfin 401 on /Items propagates 401 cleanly", async () => {
      const { cookie } = await loginAs(app.baseUrl, "jelly", "jelly-pass");
      jf.setFault("GET /Items", 401, { once: true });
      const res = await fetch(`${app.baseUrl}/api/tracks`, {
        headers: { cookie: cookie! },
      });
      expect(res.status).toBe(401);
    });

    it("upstream Jellyfin 500 on /Audio/:id/Lyrics degrades gracefully on GET /t/:id", async () => {
      jf.setFault("GET /Audio/jfbound001/Lyrics", 500, { once: true });
      const res = await fetch(`${app.baseUrl}/t/jfbound001`);
      expect([200, 502, 503]).toContain(res.status);
    });

    it("upstream Jellyfin 500 on /System/Info/Public causes GET /healthz to return 503", async () => {
      jf.setFault("GET /System/Info/Public", 500, { once: true });
      const res = await fetch(`${app.baseUrl}/healthz`);
      expect(res.status).toBe(503);
    });
  });
});
