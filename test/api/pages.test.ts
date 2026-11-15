import { readFileSync, rmSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { PlayerData } from "../../shared/types.ts";
import { makeApp } from "./helpers.ts";

const SONG = readFileSync(new URL("../fixtures/song.mp3", import.meta.url));

describe("pages", () => {
  test("GET /, /salvas, /salvas/ and /assets/* serve SSR HTML and static assets", async () => {
    const { app, close } = await makeApp();
    try {
      const home = await app.inject({ method: "GET", url: "/" });
      expect(home.statusCode).toBe(200);
      expect(home.body).toContain("<title>letra</title>");

      const saved = await app.inject({ method: "GET", url: "/salvas" });
      expect(saved.statusCode).toBe(200);
      expect(saved.body).toContain("Linhas salvas");

      const asset = await app.inject({ method: "GET", url: "/assets/app.js" });
      expect(asset.statusCode).toBe(200);
      expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
      expect(asset.headers["content-type"]).toContain("application/javascript");
    } finally {
      await close();
    }
  });

  test("GET /t/:id renders Jellyfin track SSR PlayerData and escapes XSS", async () => {
    const { app, jf, close } = await makeApp();
    try {
      jf.addItem({
        id: "jf-page-1",
        name: 'Song <script>alert("xss")</script>',
        artists: ["Artist & Co"],
        album: null,
        runTimeTicks: 80_000_000,
        audioBytes: SONG,
        lyricsPayload: { Lyrics: [{ Text: "Verso 1", Start: 5_000_000 }] },
      });

      const res = await app.inject({ method: "GET", url: "/t/jf-page-1" });
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain("<script>alert");
      const match = /<script id="letra-data" type="application\/json">([\s\S]*?)<\/script>/.exec(res.body);
      expect(match).not.toBeNull();
      const data = JSON.parse(match![1]!.replace(/\\u003c/g, "<")) as NonNullable<PlayerData>;
      expect(data.track.id).toBe("jf-page-1");
      expect(data.track.lyrics?.lines[0]).toEqual({ t: 500, text: "Verso 1" });

      const missing = await app.inject({ method: "GET", url: "/t/unknown-id" });
      expect(missing.statusCode).toBe(404);
    } finally {
      await close();
    }
  });

  test("GET / returns 503 when WEB_DIR is missing", async () => {
    const { app, webDir, close } = await makeApp();
    try {
      rmSync(webDir, { recursive: true, force: true });
      const res = await app.inject({ method: "GET", url: "/" });
      expect(res.statusCode).toBe(503);
    } finally {
      await close();
    }
  });
});
