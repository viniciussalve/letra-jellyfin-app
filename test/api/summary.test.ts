import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { SummaryResponse } from "../../shared/types.ts";
import { makeApp } from "./helpers.ts";

const SONG = readFileSync(new URL("../fixtures/song.mp3", import.meta.url));

describe("summary", () => {
  test("GET /api/tracks/summary preserves requested order, drops unknown IDs, and accepts Jellyfin IDs", async () => {
    const { app, jf, close } = await makeApp();
    try {
      jf.addItem({ id: "abc-123_def", name: "First", artists: ["A1"], album: null, runTimeTicks: 60_000_000, audioBytes: SONG });
      jf.addItem({ id: "xyz987654321", name: "Second", artists: ["A2"], album: null, runTimeTicks: 90_000_000, audioBytes: SONG });

      const res = await app.inject({
        method: "GET",
        url: "/api/tracks/summary?ids=xyz987654321,missing-id,abc-123_def",
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      const body = res.json() as SummaryResponse;
      expect(body.tracks.map((t) => t.id)).toEqual(["xyz987654321", "abc-123_def"]);
      expect(body.translationEnabled).toBe(false);
    } finally {
      await close();
    }
  });

  test("GET /api/tracks/summary rejects missing or invalid ids with 400", async () => {
    const { app, close } = await makeApp();
    try {
      expect((await app.inject({ method: "GET", url: "/api/tracks/summary" })).statusCode).toBe(400);
      expect((await app.inject({ method: "GET", url: "/api/tracks/summary?ids=bad/id" })).statusCode).toBe(400);
    } finally {
      await close();
    }
  });
});
