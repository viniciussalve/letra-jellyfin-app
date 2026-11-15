import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTranslationCache,
  type CachedLineTranslation,
  type CachedTranslation,
} from "../../server/lib/translate/cache.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeTrackEntry(trackId: string, lang = "pt"): CachedTranslation {
  return {
    trackId,
    lang,
    engine: "fake",
    sourceLang: "en",
    sameLanguage: false,
    lines: ["olá", "mundo"],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeLineEntry(trackId: string, lineHash = "h1", lang = "pt"): CachedLineTranslation {
  return {
    trackId,
    lang,
    lineHash,
    text: "olá",
    engine: "fake",
    sourceLang: "en",
    sameLanguage: false,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("createTranslationCache", () => {
  it("stores, retrieves, and clears entries in memory when filePath is null", () => {
    const cache = createTranslationCache(null);
    const trA = makeTrackEntry("a");
    const trB = makeTrackEntry("b");
    const lineA = makeLineEntry("a");
    const lineB = makeLineEntry("b");

    cache.saveTrackTranslation(trA);
    cache.saveTrackTranslation(trB);
    cache.saveLineTranslation(lineA);
    cache.saveLineTranslation(lineB);

    expect(cache.getTrackTranslation("a", "pt")).toEqual(trA);
    expect(cache.getTrackTranslation("a", "es")).toBeNull();
    expect(cache.getLineTranslation("a", "pt", "h1")).toEqual(lineA);
    expect(cache.getLineTranslation("a", "pt", "h2")).toBeNull();

    cache.clearTrackTranslations("a");
    expect(cache.getTrackTranslation("a", "pt")).toBeNull();
    expect(cache.getLineTranslation("a", "pt", "h1")).toBeNull();
    expect(cache.getTrackTranslation("b", "pt")).toEqual(trB);
    expect(cache.getLineTranslation("b", "pt", "h1")).toEqual(lineB);
  });

  it("persists atomically to JSON on disk and reloads across instances", () => {
    const dir = mkdtempSync(join(tmpdir(), "letra-cache-"));
    dirs.push(dir);
    const file = join(dir, "nested", "translations.json");

    const cache1 = createTranslationCache(file);
    const tr = makeTrackEntry("t1");
    const line = makeLineEntry("t1", "hash1");
    cache1.saveTrackTranslation(tr);
    cache1.saveLineTranslation(line);

    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    expect(raw).toHaveProperty("tracks");
    expect(raw).toHaveProperty("lines");

    const cache2 = createTranslationCache(file);
    expect(cache2.getTrackTranslation("t1", "pt")).toEqual(tr);
    expect(cache2.getLineTranslation("t1", "pt", "hash1")).toEqual(line);

    cache2.clearTrackTranslations("t1");
    const cache3 = createTranslationCache(file);
    expect(cache3.getTrackTranslation("t1", "pt")).toBeNull();
    expect(cache3.getLineTranslation("t1", "pt", "hash1")).toBeNull();
  });

  it("recovers gracefully when the cache file is corrupt", () => {
    const dir = mkdtempSync(join(tmpdir(), "letra-cache-"));
    dirs.push(dir);
    const file = join(dir, "corrupt.json");
    writeFileSync(file, "{not valid json", "utf8");

    const cache = createTranslationCache(file);
    expect(cache.getTrackTranslation("a", "pt")).toBeNull();
    const tr = makeTrackEntry("a");
    cache.saveTrackTranslation(tr);
    expect(createTranslationCache(file).getTrackTranslation("a", "pt")).toEqual(tr);
  });
});
