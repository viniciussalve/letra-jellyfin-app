import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { Translator } from "../../server/lib/translate/types.ts";
import type { LineTranslationDTO, TranslationDTO } from "../../shared/types.ts";
import { makeApp } from "./helpers.ts";

const SONG = readFileSync(new URL("../fixtures/song.mp3", import.meta.url));

function fakeTranslator(): Translator {
  return {
    name: "fake",
    async translate({ lines, target }) {
      return {
        sourceLang: "pt",
        lines: lines.map((l) => `[${target.code}] ${l}`),
      };
    },
  };
}

describe("translation", () => {
  test("GET /api/tracks/:id/translation translates full track and caches in TranslationCache", async () => {
    const { app, jf, close } = await makeApp({ translators: [fakeTranslator()] });
    try {
      jf.addItem({
        id: "jf-tr-1",
        name: "Musica",
        artists: ["Artista"],
        album: null,
        runTimeTicks: 80_000_000,
        audioBytes: SONG,
        lyricsPayload: {
          Lyrics: [
            { Text: "Primeira linha", Start: 1_000_000 },
            { Text: "Segunda linha", Start: 3_000_000 },
          ],
        },
      });

      const res = await app.inject({ method: "GET", url: "/api/tracks/jf-tr-1/translation?lang=en" });
      expect(res.statusCode).toBe(200);
      const body = res.json() as TranslationDTO;
      expect(body.lang).toBe("en");
      expect(body.lines).toEqual(["[en] Primeira linha", "[en] Segunda linha"]);
      expect(app.translationCache.getTrackTranslation("jf-tr-1", "en")?.lines).toEqual([
        "[en] Primeira linha",
        "[en] Segunda linha",
      ]);
    } finally {
      await close();
    }
  });

  test("GET /api/tracks/:id/translation/line translates a single line", async () => {
    const { app, jf, close } = await makeApp({ translators: [fakeTranslator()] });
    try {
      jf.addItem({
        id: "jf-tr-2",
        name: "Musica 2",
        artists: ["Artista"],
        album: null,
        runTimeTicks: 80_000_000,
        audioBytes: SONG,
        lyricsPayload: {
          Lyrics: [{ Text: "Verso unico", Start: 1_000_000 }],
        },
      });

      const params = new URLSearchParams({ index: "0", lang: "es", text: "Verso unico" });
      const res = await app.inject({ method: "GET", url: `/api/tracks/jf-tr-2/translation/line?${params}` });
      expect(res.statusCode).toBe(200);
      const body = res.json() as LineTranslationDTO;
      expect(body.lang).toBe("es");
      expect(body.text).toBe("[es] Verso unico");
    } finally {
      await close();
    }
  });

  test("returns 404 when track has no lyrics or translation is off", async () => {
    const { app, jf, close } = await makeApp({ translators: [] });
    try {
      jf.addItem({ id: "jf-tr-3", name: "No Lyrics", artists: ["Artista"], album: null, runTimeTicks: 80_000_000, audioBytes: SONG });
      const off = await app.inject({ method: "GET", url: "/api/tracks/jf-tr-3/translation?lang=en" });
      expect(off.statusCode).toBe(404);
    } finally {
      await close();
    }
  });
});
