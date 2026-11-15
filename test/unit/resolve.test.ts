import { expect, test } from "vitest";
import type { Lyrics } from "../../shared/types.ts";
import type { LrclibClient, LrclibRecord } from "../../server/lib/lyrics/lrclib.ts";
import { resolveLyrics } from "../../server/lib/lyrics/resolve.ts";

const synced = (s: string): Lyrics => ({ synced: true, lines: [{ t: 1000, text: s }], instrumental: false });
const plain = (s: string): Lyrics => ({ synced: false, lines: [{ t: null, text: s }], instrumental: false });
const LRC = "[00:01.00]one\n[00:02.00]two\n[00:03.00]three";
const record = (o: Partial<LrclibRecord>): LrclibRecord => ({
  id: 1, trackName: "T", artistName: "A", albumName: null, duration: 100,
  instrumental: false, plainLyrics: null, syncedLyrics: null, ...o,
});
const meta = (embedded: { synced: Lyrics | null; plain: Lyrics | null } = { synced: null, plain: null }) => ({
  title: "T", artist: "A", album: null, durationMs: 100_000, embedded,
});
const client = (get: LrclibRecord | null, search: LrclibRecord[]): LrclibClient => ({
  get: async () => get,
  search: async () => search,
});

test("embedded synced wins without network", async () => {
  const boom: LrclibClient = { get: () => { throw new Error("network"); }, search: () => { throw new Error("network"); } };
  const r = await resolveLyrics(meta({ synced: synced("e"), plain: plain("p") }), boom);
  expect(r).toEqual({ lyrics: synced("e"), source: "embedded" });
});

test("get synced beats search synced", async () => {
  const r = await resolveLyrics(meta(), client(record({ syncedLyrics: LRC }), [record({ id: 2, syncedLyrics: "[00:01.00]s\n[00:02.00]s\n[00:03.00]s" })]));
  expect(r.source).toBe("lrclib");
  expect(r.lyrics?.synced).toBe(true);
  expect(r.lyrics?.lines[0].text).toBe("one");
});

test("search synced beats embedded plain and get plain", async () => {
  const r = await resolveLyrics(meta({ synced: null, plain: plain("e") }), client(record({ plainLyrics: "gp" }), [record({ id: 2, syncedLyrics: LRC })]));
  expect(r.source).toBe("lrclib");
  expect(r.lyrics?.synced).toBe(true);
});

test("embedded plain beats lrclib plain", async () => {
  const r = await resolveLyrics(meta({ synced: null, plain: plain("e") }), client(record({ plainLyrics: "gp" }), [record({ id: 2, plainLyrics: "sp" })]));
  expect(r).toEqual({ lyrics: plain("e"), source: "embedded" });
});

test("lrclib plain: get before search", async () => {
  const r = await resolveLyrics(meta(), client(record({ plainLyrics: "gp" }), [record({ id: 2, plainLyrics: "sp" })]));
  expect(r.source).toBe("lrclib");
  expect(r.lyrics?.synced).toBe(false);
  expect(r.lyrics?.lines[0].text).toBe("gp");
  const s = await resolveLyrics(meta(), client(null, [record({ id: 2, plainLyrics: "sp" })]));
  expect(s.lyrics?.lines[0].text).toBe("sp");
});

test("search ignores records outside ±3 s; nothing gives none", async () => {
  const far = record({ id: 2, duration: 300, syncedLyrics: LRC, plainLyrics: "x" });
  expect(await resolveLyrics(meta(), client(null, [far]))).toEqual({ lyrics: null, source: "none" });
  expect(await resolveLyrics(meta(), client(null, []))).toEqual({ lyrics: null, source: "none" });
});

test("instrumental record", async () => {
  const r = await resolveLyrics(meta(), client(record({ instrumental: true }), []));
  expect(r).toEqual({ lyrics: { synced: false, lines: [], instrumental: true }, source: "lrclib" });
});

test("embedded plain outranks an instrumental search record", async () => {
  const r = await resolveLyrics(meta({ synced: null, plain: plain("e") }), client(null, [record({ id: 2, instrumental: true })]));
  expect(r).toEqual({ lyrics: plain("e"), source: "embedded" });
});

test("no embedded lyrics plus instrumental search record is instrumental", async () => {
  const r = await resolveLyrics(meta(), client(null, [record({ id: 2, instrumental: true })]));
  expect(r).toEqual({ lyrics: { synced: false, lines: [], instrumental: true }, source: "lrclib" });
});
