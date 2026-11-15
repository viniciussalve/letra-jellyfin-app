import { describe, expect, test } from "vitest";
import type { TrackSummary } from "../../shared/types.ts";
import {
  RECENTS_KEY,
  RECENTS_MAX,
  clearRecents,
  mergeSummaries,
  readRecents,
  recordVisit,
  saveRecents,
  type KeyValueStore,
} from "../../web/shared/recents.ts";

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const throwing: KeyValueStore = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

const track = (id: string, title = id, artist = "Artist", hasCover = false) => ({ id, title, artist, hasCover });

describe("recents", () => {
  test("uses the key letra.recents.v1", () => {
    expect(RECENTS_KEY).toBe("letra.recents.v1");
    const store = memoryStore();
    recordVisit(track("a"), 1, store);
    expect(store.data.has("letra.recents.v1")).toBe(true);
  });

  test("records newest first and moves a repeat to the front", () => {
    const store = memoryStore();
    recordVisit(track("a"), 1, store);
    recordVisit(track("b"), 2, store);
    const list = recordVisit(track("a"), 3, store);
    expect(list.map((r) => r.id)).toEqual(["a", "b"]);
    expect(list[0].at).toBe(3);
    expect(readRecents(store)).toEqual(list);
  });

  test("keeps at most 50", () => {
    const store = memoryStore();
    let list: ReturnType<typeof recordVisit> = [];
    for (let i = 0; i < RECENTS_MAX + 1; i++) list = recordVisit(track(`t${i}`), i, store);
    expect(list).toHaveLength(50);
    expect(list.some((r) => r.id === "t0")).toBe(false);
    expect(list[0].id).toBe("t50");
    expect(readRecents(store)).toHaveLength(50);
  });

  test("refreshes title, artist and hasCover on a repeat visit", () => {
    const store = memoryStore();
    recordVisit(track("a", "Old", "Old Artist", false), 1, store);
    const list = recordVisit(track("a", "New", "New Artist", true), 2, store);
    expect(list).toEqual([{ id: "a", title: "New", artist: "New Artist", hasCover: true, at: 2 }]);
  });

  test("reads malformed JSON as empty", () => {
    expect(readRecents(memoryStore({ [RECENTS_KEY]: "{not json" }))).toEqual([]);
    expect(readRecents(memoryStore({ [RECENTS_KEY]: '{"id":"a"}' }))).toEqual([]);
    expect(readRecents(memoryStore({ [RECENTS_KEY]: '[{"id":1}]' }))).toEqual([]);
    expect(readRecents(memoryStore())).toEqual([]);
  });

  test("drops entries with the wrong field types and keeps the good ones", () => {
    const good = { id: "a", title: "T", artist: "A", hasCover: true, at: 5 };
    const raw = JSON.stringify([good, { ...good, id: "b", at: "x" }, { ...good, id: "c", hasCover: "yes" }, null, 3]);
    expect(readRecents(memoryStore({ [RECENTS_KEY]: raw }))).toEqual([good]);
  });

  test("a throwing store reads empty and never throws", () => {
    expect(readRecents(throwing)).toEqual([]);
    expect(() => recordVisit(track("a"), 1, throwing)).not.toThrow();
    expect(recordVisit(track("a"), 1, throwing).map((r) => r.id)).toEqual(["a"]);
    expect(() => saveRecents([], throwing)).not.toThrow();
    expect(() => clearRecents(throwing)).not.toThrow();
    expect(readRecents(null)).toEqual([]);
    expect(() => recordVisit(track("a"), 1, null)).not.toThrow();
  });

  test("clearRecents empties the store", () => {
    const store = memoryStore();
    recordVisit(track("a"), 1, store);
    clearRecents(store);
    expect(readRecents(store)).toEqual([]);
  });

  test("mergeSummaries drops deleted ids, updates fields, keeps order and at", () => {
    const list = [
      { id: "a", title: "A", artist: "x", hasCover: false, at: 30 },
      { id: "gone", title: "G", artist: "x", hasCover: false, at: 20 },
      { id: "b", title: "B", artist: "x", hasCover: false, at: 10 },
    ];
    const palette: TrackSummary["palette"] = { mesh: ["#000", "#111", "#222", "#333"], scrim: 0.5 };
    const summaries: TrackSummary[] = [
      { id: "b", title: "B2", artist: "y", hasCover: true, palette: palette, durationMs: 1 },
      { id: "a", title: "A2", artist: "z", hasCover: false, palette: palette, durationMs: 2 },
    ];
    expect(mergeSummaries(list, summaries)).toEqual([
      { id: "a", title: "A2", artist: "z", hasCover: false, at: 30 },
      { id: "b", title: "B2", artist: "y", hasCover: true, at: 10 },
    ]);
  });
});
