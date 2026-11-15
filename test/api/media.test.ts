import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { makeApp } from "./helpers.ts";

const SONG = readFileSync(new URL("../fixtures/song.mp3", import.meta.url));
const COVER = readFileSync(new URL("../fixtures/cover.png", import.meta.url));

describe("media", () => {
  test("GET /media/:id/audio proxies full stream and Range 206/416 responses", async () => {
    const { app, jf, close } = await makeApp();
    try {
      jf.addItem({
        id: "jf-media-1",
        name: "Media Song",
        artists: ["Artist"],
        album: null,
        runTimeTicks: 80_000_000,
        audioBytes: SONG,
        audioMime: "audio/mpeg",
        coverBytes: COVER,
        coverMime: "image/png",
      });

      const full = await app.inject({ method: "GET", url: "/media/jf-media-1/audio" });
      expect(full.statusCode).toBe(200);
      expect(full.headers["accept-ranges"]).toBe("bytes");
      expect(full.rawPayload).toEqual(SONG);

      const partial = await app.inject({
        method: "GET",
        url: "/media/jf-media-1/audio",
        headers: { range: "bytes=0-127" },
      });
      expect(partial.statusCode).toBe(206);
      expect(partial.headers["content-range"]).toBe(`bytes 0-127/${SONG.length}`);
      expect(partial.rawPayload).toEqual(SONG.subarray(0, 128));

      const badRange = await app.inject({
        method: "GET",
        url: "/media/jf-media-1/audio",
        headers: { range: `bytes=${SONG.length + 10}-${SONG.length + 20}` },
      });
      expect(badRange.statusCode).toBe(416);

      const missing = await app.inject({ method: "GET", url: "/media/missing/audio" });
      expect(missing.statusCode).toBe(404);
    } finally {
      await close();
    }
  });

  test("GET /media/:id/cover.jpg and og.jpg proxy Jellyfin Primary image", async () => {
    const { app, jf, close } = await makeApp();
    try {
      jf.addItem({
        id: "jf-media-2",
        name: "Cover Song",
        artists: ["Artist"],
        album: null,
        runTimeTicks: 80_000_000,
        audioBytes: SONG,
        coverBytes: COVER,
        coverMime: "image/png",
      });
      jf.addItem({
        id: "jf-media-no-cover",
        name: "No Cover",
        artists: ["Artist"],
        album: null,
        runTimeTicks: 80_000_000,
        audioBytes: SONG,
      });

      const cover = await app.inject({ method: "GET", url: "/media/jf-media-2/cover.jpg" });
      expect(cover.statusCode).toBe(200);
      expect(cover.rawPayload).toEqual(COVER);

      const og = await app.inject({ method: "GET", url: "/media/jf-media-2/og.jpg" });
      expect(og.statusCode).toBe(200);
      expect(og.rawPayload).toEqual(COVER);

      const missing = await app.inject({ method: "GET", url: "/media/jf-media-no-cover/cover.jpg" });
      expect(missing.statusCode).toBe(404);
    } finally {
      await close();
    }
  });
});
