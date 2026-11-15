import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ApiError, TrackDTO, TranslationDTO } from "../../shared/types.ts";
import {
  loadFixture,
  loginAs,
  multipartBody,
  parsePlayerData,
  startAppServer,
  type AppServerHandle,
} from "./helpers.ts";
import { startMockJellyfin, type MockJellyfinServer } from "./mock-jellyfin.ts";

describe("Tier 5: White-Box Adversarial Hardening", () => {
  let jf: MockJellyfinServer;
  let app: AppServerHandle;
  let libraryDir: string;
  let songBytes: Buffer;
  let notAudioBytes: Buffer;

  beforeAll(async () => {
    libraryDir = mkdtempSync(join(tmpdir(), "letra-t5-lib-"));
    songBytes = loadFixture("song.mp3");
    notAudioBytes = loadFixture("not-audio.mp3");
    jf = await startMockJellyfin({ libraryDir });
    app = await startAppServer({
      jellyfinUrl: jf.url,
      jellyfinApiKey: jf.apiKey,
      jellyfinLibraryDir: libraryDir,
      translator: "fake",
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
      id: "jfadv001",
      name: "Adversarial Track",
      artists: ["Adv Artist"],
      album: null,
      runTimeTicks: 80_000_000,
      audioBytes: songBytes,
      audioMime: "audio/mpeg",
      lyricsPayload: {
        Lyrics: [
          { Text: "Original line one", Start: 1_000_000 },
          { Text: "Original line two", Start: 2_000_000 },
        ],
      },
    });
  });

  it("C1-01: POST /api/tracks collision does NOT overwrite or delete pre-existing file on failed upload", async () => {
    const existingPath = join(libraryDir, "important.mp3");
    const sentinel = Buffer.concat([songBytes, Buffer.from("SENTINEL_KEEP_ME")]);
    writeFileSync(existingPath, sentinel);

    const { cookie } = await loginAs(app.baseUrl, "jelly", "jelly-pass");
    const badMp = multipartBody(
      {},
      [{ field: "file", filename: "important.mp3", contentType: "audio/mpeg", data: notAudioBytes }],
    );
    const badRes = await fetch(`${app.baseUrl}/api/tracks`, {
      method: "POST",
      headers: { cookie: cookie!, "content-type": badMp.contentType },
      body: badMp.body,
    });
    expect(badRes.status).toBe(415);
    expect(existsSync(existingPath)).toBe(true);
    expect(readFileSync(existingPath)).toEqual(sentinel);

    const goodMp = multipartBody(
      {},
      [{ field: "file", filename: "important.mp3", contentType: "audio/mpeg", data: songBytes }],
    );
    const goodRes = await fetch(`${app.baseUrl}/api/tracks`, {
      method: "POST",
      headers: { cookie: cookie!, "content-type": goodMp.contentType },
      body: goodMp.body,
    });
    expect(goodRes.status).toBe(201);
    expect(readFileSync(existingPath)).toEqual(sentinel);
  });

  it("C1-02: rejects path-traversal itemIds on media/API routes and returns HTML 404 on /t/..%2Fetc", async () => {
    const mediaRes = await fetch(`${app.baseUrl}/media/..%2F..%2Fetc/audio`);
    expect(mediaRes.status).toBe(400);

    const mediaDotRes = await fetch(`${app.baseUrl}/media/%2e%2e/audio`);
    expect([400, 404]).toContain(mediaDotRes.status);

    const pageRes = await fetch(`${app.baseUrl}/t/..%2Fetc`);
    expect(pageRes.status).toBe(404);
    expect(pageRes.headers.get("content-type")).toContain("text/html");
  });

  it("C1-03: PUT /api/tracks/:id/lyrics > 1 MiB multipart .lrc returns 413 too_large", async () => {
    const { cookie } = await loginAs(app.baseUrl, "jelly", "jelly-pass");
    const line = "[00:01.00]This is a repeated lyric line for padding\n";
    const bigLrc = Buffer.from(line.repeat(Math.ceil(1_150_000 / line.length)));
    const { body, contentType } = multipartBody(
      {},
      [{ field: "file", filename: "big.lrc", contentType: "text/plain", data: bigLrc }],
    );

    const res = await fetch(`${app.baseUrl}/api/tracks/jfadv001/lyrics`, {
      method: "PUT",
      headers: { cookie: cookie!, "content-type": contentType },
      body,
    });
    expect(res.status).toBe(413);
    const err = (await res.json()) as ApiError;
    expect(err.error.code).toBe("too_large");
  });

  it("C1-04: POST /api/tracks with >255-byte filename truncates cleanly and returns 201", async () => {
    const { cookie } = await loginAs(app.baseUrl, "jelly", "jelly-pass");
    const longName = `${"a".repeat(300)}.mp3`;
    const { body, contentType } = multipartBody(
      {},
      [{ field: "file", filename: longName, contentType: "audio/mpeg", data: songBytes }],
    );

    const res = await fetch(`${app.baseUrl}/api/tracks`, {
      method: "POST",
      headers: { cookie: cookie!, "content-type": contentType },
      body,
    });
    expect(res.status).toBe(201);
    const dto = (await res.json()) as TrackDTO;
    expect(dto.id).toBeTruthy();
  });

  it("C1-05: translation cache invalidates when lyrics change externally in Jellyfin", async () => {
    const firstRes = await fetch(`${app.baseUrl}/api/tracks/jfadv001/translation?lang=pt-BR`);
    expect(firstRes.status).toBe(200);
    const first = (await firstRes.json()) as TranslationDTO;
    expect(first.lines[0]).toContain("Original line one");

    // Simulate external edit directly in Jellyfin (bypassing PUT /api/tracks/:id/lyrics)
    jf.addItem({
      id: "jfadv001",
      name: "Adversarial Track",
      artists: ["Adv Artist"],
      album: null,
      runTimeTicks: 80_000_000,
      audioBytes: songBytes,
      audioMime: "audio/mpeg",
      lyricsPayload: {
        Lyrics: [
          { Text: "Updated line one", Start: 1_000_000 },
          { Text: "Updated line two", Start: 2_000_000 },
        ],
      },
    });

    const secondRes = await fetch(`${app.baseUrl}/api/tracks/jfadv001/translation?lang=pt-BR`);
    expect(secondRes.status).toBe(200);
    const second = (await secondRes.json()) as TranslationDTO;
    expect(second.lines[0]).toContain("Updated line one");
    expect(second.lines[0]).not.toContain("Original line one");
  });

  it("C1-07: X-Real-IP spoofing does not bypass rate limit when TRUST_PROXY=false", async () => {
    const directApp = await startAppServer({
      jellyfinUrl: jf.url,
      jellyfinApiKey: jf.apiKey,
      jellyfinLibraryDir: libraryDir,
      env: {
        TRUST_PROXY: "false",
        RAILWAY_PUBLIC_DOMAIN: "letra.example.com",
      },
    });
    try {
      for (let i = 0; i < 5; i++) {
        const response = await fetch(`${directApp.baseUrl}/api/session`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-real-ip": `198.51.100.${i + 1}` },
          body: JSON.stringify({ username: "jelly", password: "wrong" }),
        });
        expect(response.status).toBe(401);
      }
      const sixth = await fetch(`${directApp.baseUrl}/api/session`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-real-ip": "198.51.100.99" },
        body: JSON.stringify({ username: "jelly", password: "wrong" }),
      });
      expect(sixth.status).toBe(429);
    } finally {
      await directApp.stop();
    }
  });

  it("C2-02: GET /t/:id degrades gracefully to HTML 200 without lyrics when /Audio/:id/Lyrics returns 500", async () => {
    jf.setFault("GET /Audio/jfadv001/Lyrics", 500, { once: true });
    const res = await fetch(`${app.baseUrl}/t/jfadv001`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    const data = parsePlayerData(html);
    expect(data).not.toBeNull();
    expect(data!.track.id).toBe("jfadv001");
    expect(data!.track.lyrics).toBeNull();
  });
});
