import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { TrackDTO } from "../../shared/types.ts";
import { makeApp, multipartBody } from "./helpers.ts";

const SONG = readFileSync(new URL("../fixtures/song.mp3", import.meta.url));
const LRC = readFileSync(new URL("../fixtures/sample.lrc", import.meta.url));

describe("tracks", () => {
  test("GET /api/tracks requires session and lists Jellyfin audio items", async () => {
    const { app, cookie, jf, close } = await makeApp();
    try {
      jf.addItem({
        id: "jf1",
        name: "Track One",
        artists: ["Artist One"],
        album: "Album One",
        runTimeTicks: 120_000_000,
        container: "mp3",
        audioBytes: SONG,
      });

      const anon = await app.inject({ method: "GET", url: "/api/tracks" });
      expect(anon.statusCode).toBe(401);

      const res = await app.inject({ method: "GET", url: "/api/tracks", headers: { cookie } });
      expect(res.statusCode).toBe(200);
      const list = res.json() as TrackDTO[];
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ id: "jf1", title: "Track One", artist: "Artist One", durationMs: 12000 });
    } finally {
      await close();
    }
  });

  test("POST /api/tracks writes to JELLYFIN_LIBRARY_DIR and triggers refreshLibrary", async () => {
    const { app, cookie, libraryDir, jf, close } = await makeApp();
    try {
      const before = jf.getRefreshCount();
      const form = multipartBody("Artist - My Song.mp3", SONG);
      const res = await app.inject({ method: "POST", url: "/api/tracks", headers: { cookie, ...form.headers }, payload: form.payload });
      expect(res.statusCode).toBe(201);
      expect(jf.getRefreshCount()).toBe(before + 1);
      expect(existsSync(join(libraryDir, "Artist - My Song.mp3"))).toBe(true);
      const body = res.json() as TrackDTO;
      expect(body.title).toBe("My Song");
      expect(body.artist).toBe("Artist");
    } finally {
      await close();
    }
  });

  test("POST /api/tracks returns 501 when JELLYFIN_LIBRARY_DIR is not configured", async () => {
    const { app, cookie, close } = await makeApp({ withLibraryDir: false });
    try {
      const form = multipartBody("song.mp3", SONG);
      const res = await app.inject({ method: "POST", url: "/api/tracks", headers: { cookie, ...form.headers }, payload: form.payload });
      expect(res.statusCode).toBe(501);
      expect(res.json()).toMatchObject({ error: { code: "library_dir_not_configured" } });
    } finally {
      await close();
    }
  });

  test("POST /api/tracks rejects non-audio extensions with 415", async () => {
    const { app, cookie, close } = await makeApp();
    try {
      const form = multipartBody("notes.txt", Buffer.from("hello"));
      const res = await app.inject({ method: "POST", url: "/api/tracks", headers: { cookie, ...form.headers }, payload: form.payload });
      expect(res.statusCode).toBe(415);
    } finally {
      await close();
    }
  });

  test("PUT /api/tracks/:id/lyrics uploads JSON and multipart .lrc lyrics and clears translation cache", async () => {
    const { app, cookie, jf, close } = await makeApp();
    try {
      jf.addItem({ id: "jf2", name: "No Lyrics", artists: ["Artist"], album: null, runTimeTicks: 80_000_000, audioBytes: SONG });
      app.translationCache.saveTrackTranslation({
        trackId: "jf2",
        lang: "en",
        engine: "fake",
        sourceLang: "pt",
        sameLanguage: false,
        lines: ["old"],
        createdAt: new Date().toISOString(),
      });

      const res1 = await app.inject({
        method: "PUT",
        url: "/api/tracks/jf2/lyrics",
        headers: { cookie },
        payload: { text: "[00:01.00]Linha manual\n[00:03.00]Segunda linha\n[00:05.00]Terceira linha" },
      });
      expect(res1.statusCode).toBe(200);
      expect((res1.json() as TrackDTO).lyrics?.lines[0]).toEqual({ t: 1000, text: "Linha manual" });
      expect(app.translationCache.getTrackTranslation("jf2", "en")).toBeNull();

      const form = multipartBody("sample.lrc", LRC);
      const res2 = await app.inject({
        method: "PUT",
        url: "/api/tracks/jf2/lyrics",
        headers: { cookie, ...form.headers },
        payload: form.payload,
      });
      expect(res2.statusCode).toBe(200);
      expect((res2.json() as TrackDTO).lyrics?.lines).toHaveLength(4);
    } finally {
      await close();
    }
  });

  test("POST /api/tracks/:id/lyrics/search resolves from LRCLIB and saves to Jellyfin", async () => {
    const { app, cookie, jf, close } = await makeApp({
      fetch: (url) => {
        if (url.includes("/api/get")) {
          return new Response(
            JSON.stringify({
              id: 1,
              trackName: "Found",
              artistName: "Artist",
              albumName: null,
              duration: 8,
              instrumental: false,
              plainLyrics: "Line one",
              syncedLyrics: "[00:00.50]Line one",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    try {
      jf.addItem({ id: "jf3", name: "Found", artists: ["Artist"], album: null, runTimeTicks: 80_000_000, audioBytes: SONG });
      const res = await app.inject({ method: "POST", url: "/api/tracks/jf3/lyrics/search", headers: { cookie } });
      expect(res.statusCode).toBe(200);
      expect((res.json() as TrackDTO).lyrics?.lines[0]?.text).toBe("Line one");
      expect(jf.getItem("jf3")?.lyricsPayload?.Lyrics?.[0]?.Text).toBe("Line one");
    } finally {
      await close();
    }
  });

  test("DELETE /api/tracks/:id/lyrics deletes lyrics from Jellyfin and clears translation cache", async () => {
    const { app, cookie, jf, close } = await makeApp();
    try {
      jf.addItem({
        id: "jf4",
        name: "With Lyrics",
        artists: ["Artist"],
        album: null,
        runTimeTicks: 80_000_000,
        audioBytes: SONG,
        lyricsPayload: { Lyrics: [{ Text: "Hello", Start: 1_000_000 }] },
      });
      const res = await app.inject({ method: "DELETE", url: "/api/tracks/jf4/lyrics", headers: { cookie } });
      expect(res.statusCode).toBe(204);
      expect(jf.getItem("jf4")?.lyricsPayload).toBeNull();
    } finally {
      await close();
    }
  });

  test("PUT /api/tracks/:id/lyrics waits for Jellyfin async lyrics visibility", async () => {
    const { app, cookie, jf, close } = await makeApp();
    try {
      jf.addItem({ id: "jf5", name: "Async Lyrics", artists: ["Artist"], album: null, runTimeTicks: 80_000_000, audioBytes: SONG });
      const origGetLyrics = app.jellyfin.getLyrics.bind(app.jellyfin);
      let calls = 0;
      app.jellyfin.getLyrics = async (token, itemId) => {
        calls += 1;
        if (calls < 3) return null;
        return origGetLyrics(token, itemId);
      };

      const res = await app.inject({
        method: "PUT",
        url: "/api/tracks/jf5/lyrics",
        headers: { cookie },
        payload: { text: "[00:01.00]Eventually visible" },
      });
      expect(res.statusCode).toBe(200);
      expect(calls).toBe(3);
    } finally {
      await close();
    }
  });
});
