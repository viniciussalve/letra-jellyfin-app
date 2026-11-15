import { describe, expect, test } from "vitest";
import type { TrackSummary } from "../../shared/types.ts";
import type { KeyValueStore } from "../../web/shared/recents.ts";
import {
  SAVED_HINT_KEY,
  SAVED_KEY,
  SAVED_MAX,
  countLabel,
  groupBySong,
  isSaved,
  isTrackId,
  latest,
  lineHref,
  linesLabel,
  mergeSummaries,
  readSaved,
  removeLine,
  restoreLine,
  saveLine,
  savedLabel,
  setLineTranslation,
  writeSaved,
  type SavedLine,
} from "../../web/shared/saved.ts";

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

/** Reads fine, refuses every write (full or blocked storage). */
function readOnlyStore(initial: Record<string, string> = {}): KeyValueStore {
  const inner = memoryStore(initial);
  return {
    getItem: inner.getItem,
    removeItem: inner.removeItem,
    setItem: () => {
      throw new Error("quota");
    },
  };
}

const draft = (over: Partial<Omit<SavedLine, "at">> = {}): Omit<SavedLine, "at"> => ({
  trackId: "a",
  title: "Song A",
  artist: "Artist",
  hasCover: false,
  index: 0,
  t: 500,
  text: "Primeiro verso",
  lang: "pt",
  tr: null,
  ...over,
});
const rec = (over: Partial<SavedLine> = {}): SavedLine => ({ ...draft(), at: 1, ...over });
const stored = (store: ReturnType<typeof memoryStore>): unknown => JSON.parse(store.data.get(SAVED_KEY) ?? "null");

describe("saved lines store", () => {
  test("uses the documented keys and limit", () => {
    expect(SAVED_KEY).toBe("letra.saved.v1");
    expect(SAVED_HINT_KEY).toBe("letra.saved.hint.v1");
    expect(SAVED_MAX).toBe(1000);
  });

  test("saves a line and reads it back", () => {
    const store = memoryStore();
    expect(saveLine(draft(), 10, store)).toBe("saved");
    expect(readSaved(store)).toEqual([{ ...draft(), at: 10 }]);
    expect(stored(store)).toEqual([{ ...draft(), at: 10 }]);
  });

  test("saving the same position again replaces the record", () => {
    const store = memoryStore();
    saveLine(draft({ text: "old" }), 10, store);
    saveLine(draft({ index: 1, text: "other" }), 11, store);
    expect(saveLine(draft({ text: "new" }), 20, store)).toBe("saved");
    const list = readSaved(store);
    expect(list).toHaveLength(2);
    expect(list.find((l) => l.index === 0)).toMatchObject({ text: "new", at: 20 });
  });

  test("isSaved needs the same track, index and text", () => {
    const list = [rec({ trackId: "a", index: 2, text: "x" })];
    expect(isSaved(list, "a", 2, "x")).toBe(true);
    expect(isSaved(list, "b", 2, "x")).toBe(false);
    expect(isSaved(list, "a", 3, "x")).toBe(false);
    expect(isSaved(list, "a", 2, "y")).toBe(false);
  });

  test("an edited line: the old text is no longer saved, and saving the new text replaces it", () => {
    const store = memoryStore();
    saveLine(draft({ text: "before" }), 10, store);
    expect(isSaved(readSaved(store), "a", 0, "after")).toBe(false);
    expect(isSaved(readSaved(store), "a", 0, "before")).toBe(true);
    saveLine(draft({ text: "after" }), 20, store);
    const list = readSaved(store);
    expect(list).toHaveLength(1);
    expect(isSaved(list, "a", 0, "after")).toBe(true);
    expect(isSaved(list, "a", 0, "before")).toBe(false);
  });

  test("removeLine returns the record and restoreLine puts it back with its date", () => {
    const store = memoryStore();
    saveLine(draft(), 10, store);
    saveLine(draft({ index: 1, text: "two" }), 20, store);
    expect(removeLine("a", 5, store)).toBeNull();
    const removed = removeLine("a", 0, store);
    expect(removed).toEqual({ ...draft(), at: 10 });
    expect(readSaved(store).map((l) => l.index)).toEqual([1]);
    expect(restoreLine(removed as SavedLine, store)).toBe("saved");
    expect(readSaved(store).find((l) => l.index === 0)?.at).toBe(10);
    expect(readSaved(store)).toHaveLength(2);
  });

  test("at 1000 records a new line is refused and nothing is removed; replacing still works", () => {
    const many = Array.from({ length: SAVED_MAX }, (_, i) => rec({ trackId: "t", index: i, text: `l${i}`, at: i }));
    const store = memoryStore({ [SAVED_KEY]: JSON.stringify(many) });
    expect(saveLine(draft({ trackId: "other" }), 5000, store)).toBe("full");
    expect(restoreLine(rec({ trackId: "other" }), store)).toBe("full");
    expect(readSaved(store)).toHaveLength(SAVED_MAX);
    expect(saveLine(draft({ trackId: "t", index: 7, text: "edited" }), 5000, store)).toBe("saved");
    const list = readSaved(store);
    expect(list).toHaveLength(SAVED_MAX);
    expect(list.find((l) => l.index === 7)).toMatchObject({ text: "edited", at: 5000 });
  });

  test("no store reads as empty; no store, or one that refuses writes, answers blocked and keeps nothing", () => {
    expect(readSaved(null)).toEqual([]);
    expect(saveLine(draft(), 1, null)).toBe("blocked");
    expect(restoreLine(rec(), null)).toBe("blocked");
    expect(removeLine("a", 0, null)).toBeNull();

    const refusing = readOnlyStore();
    expect(saveLine(draft(), 1, refusing)).toBe("blocked");
    expect(restoreLine(rec(), refusing)).toBe("blocked");
    expect(readSaved(refusing)).toEqual([]);

    const raw = JSON.stringify([rec()]);
    const full = readOnlyStore({ [SAVED_KEY]: raw });
    expect(saveLine(draft({ index: 4 }), 1, full)).toBe("blocked");
    expect(removeLine("a", 0, full)).toBeNull();
    expect(readSaved(full)).toEqual([rec()]);

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
    expect(readSaved(throwing)).toEqual([]);
    expect(saveLine(draft(), 1, throwing)).toBe("blocked");
    expect(() => setLineTranslation("a", 0, "Primeiro verso", { tr: null }, throwing)).not.toThrow();
  });

  test("writeSaved writes the list and answers true; no store or a refusing store answers false", () => {
    const store = memoryStore();
    expect(writeSaved([rec({ at: 3 })], store)).toBe(true);
    expect(readSaved(store)).toEqual([rec({ at: 3 })]);
    expect(writeSaved([], store)).toBe(true);
    expect(readSaved(store)).toEqual([]);
    expect(writeSaved([rec()], null)).toBe(false);
    expect(writeSaved([rec()], readOnlyStore())).toBe(false);
  });

  test("bad records are dropped one by one; a repeated position keeps the first", () => {
    const good = rec({ trackId: "a", index: 0, text: "first", at: 5 });
    const raw = JSON.stringify([
      good,
      { ...good, text: "repeat", at: 6 },
      { ...good, index: -1 },
      { ...good, index: 1.5 },
      { ...good, index: "2" },
      { ...good, index: 3, t: "1" },
      { ...good, index: 4, t: undefined },
      { ...good, index: 5, lang: 3 },
      { ...good, index: 6, tr: { lang: "en" } },
      { ...good, index: 7, tr: { lang: "en", text: 1 } },
      { ...good, index: 8, tr: "x" },
      { ...good, index: 9, hasCover: "no" },
      { ...good, index: 10, at: "now" },
      { ...good, index: 11, text: null },
      null,
      7,
      rec({ trackId: "b", index: 0, t: null, lang: null, tr: { lang: "en", text: "One" }, at: 9 }),
    ]);
    expect(readSaved(memoryStore({ [SAVED_KEY]: raw }))).toEqual([
      good,
      rec({ trackId: "b", index: 0, t: null, lang: null, tr: { lang: "en", text: "One" }, at: 9 }),
    ]);
  });

  test("a record whose date a Date cannot hold is dropped", () => {
    const good = rec({ trackId: "a", index: 0, at: 5 });
    const raw = JSON.stringify([good, { ...good, index: 1, at: 8.64e15 + 1 }, { ...good, index: 2, at: -8.64e15 - 1 }, { ...good, index: 3, at: 1e300 }]);
    expect(readSaved(memoryStore({ [SAVED_KEY]: raw }))).toEqual([good]);
    // The edges a Date still holds are kept.
    const edges = JSON.stringify([{ ...good, at: 8.64e15 }, { ...good, index: 1, at: -8.64e15 }]);
    expect(readSaved(memoryStore({ [SAVED_KEY]: edges })).map((l) => l.index)).toEqual([0, 1]);
  });

  test("text that is not JSON, or not a list, reads as empty", () => {
    expect(readSaved(memoryStore({ [SAVED_KEY]: "{not json" }))).toEqual([]);
    expect(readSaved(memoryStore({ [SAVED_KEY]: JSON.stringify(rec()) }))).toEqual([]);
    expect(readSaved(memoryStore({ [SAVED_KEY]: "3" }))).toEqual([]);
    expect(readSaved(memoryStore())).toEqual([]);
  });

  test("setLineTranslation sets and clears the translation and can correct the language", () => {
    const store = memoryStore();
    saveLine(draft({ lang: "en" }), 10, store);
    const tr = { lang: "pt", text: "First verse" };
    const text = "Primeiro verso";
    setLineTranslation("a", 0, text, { tr }, store);
    expect(readSaved(store)[0]).toMatchObject({ tr, lang: "en" });
    setLineTranslation("a", 0, text, { tr, lang: "es" }, store);
    expect(readSaved(store)[0]).toMatchObject({ tr, lang: "es" });
    setLineTranslation("a", 0, text, { tr: null, lang: null }, store);
    expect(readSaved(store)[0]).toMatchObject({ tr: null, lang: null, at: 10 });
    const before = store.data.get(SAVED_KEY);
    setLineTranslation("a", 9, text, { tr, lang: "xx" }, store);
    setLineTranslation("zzz", 0, text, { tr, lang: "xx" }, store);
    expect(store.data.get(SAVED_KEY)).toBe(before);
  });

  test("setLineTranslation writes tr and answers true", () => {
    const store = memoryStore();
    saveLine(draft({ index: 2, text: "Terceiro verso", lang: "pt" }), 10, store);
    const tr = { lang: "en", text: "Third verse" };
    expect(setLineTranslation("a", 2, "Terceiro verso", { tr }, store)).toBe(true);
    expect(readSaved(store)[0]).toMatchObject({ tr, lang: "pt" });
  });

  test("setLineTranslation leaves a record whose text differs", () => {
    const store = memoryStore();
    saveLine(draft({ index: 2, text: "Terceiro verso" }), 10, store);
    const before = store.data.get(SAVED_KEY);
    const tr = { lang: "en", text: "Third verse" };
    expect(setLineTranslation("a", 2, "Outro texto", { tr }, store)).toBe(false);
    expect(setLineTranslation("a", 5, "Terceiro verso", { tr }, store)).toBe(false);
    expect(store.data.get(SAVED_KEY)).toBe(before);
  });

  test("setLineTranslation patches lang alone", () => {
    const store = memoryStore();
    const tr = { lang: "en", text: "Third verse" };
    saveLine(draft({ index: 2, text: "Terceiro verso", lang: "en", tr }), 10, store);
    expect(setLineTranslation("a", 2, "Terceiro verso", { lang: "pt" }, store)).toBe(true);
    expect(readSaved(store)[0]).toMatchObject({ lang: "pt", tr });
  });

  test("setLineTranslation answers false when the store refuses the write", () => {
    const seeded = memoryStore();
    saveLine(draft({ text: "Primeiro verso" }), 10, seeded);
    const refusing = readOnlyStore({ [SAVED_KEY]: seeded.data.get(SAVED_KEY)! });
    expect(setLineTranslation("a", 0, "Primeiro verso", { tr: { lang: "en", text: "First" } }, refusing)).toBe(false);
  });

  test("isTrackId accepts Jellyfin IDs (1..64 alphanumeric/hyphen/underscore) and rejects invalid IDs", () => {
    expect(isTrackId("KyD0ZYYTz6")).toBe(true);
    expect(isTrackId("4f9b2e1c8a3d4b5e9f0a1b2c3d4e5f60")).toBe(true);
    expect(isTrackId("abc-123_def")).toBe(true);
    expect(isTrackId("KyD0ZYYT-6")).toBe(true);
    for (const bad of ["", "não é um id", "bad/id", "a".repeat(65), "has space", ".."]) expect(isTrackId(bad)).toBe(false);
  });

  test("mergeSummaries refreshes the details and names the songs the server no longer has", () => {
    const palette: TrackSummary["palette"] = { mesh: ["#000", "#111", "#222", "#333"], scrim: 0.5 };
    const list = [
      rec({ trackId: "a", index: 0, at: 3 }),
      rec({ trackId: "gone", index: 0, at: 2 }),
      rec({ trackId: "a", index: 1, at: 1 }),
      rec({ trackId: "gone", index: 4, at: 1 }),
      rec({ trackId: "gone2", index: 0, at: 1 }),
    ];
    const summaries: TrackSummary[] = [{ id: "a", title: "New", artist: "Newer", hasCover: true, palette, durationMs: 1 }];
    const merged = mergeSummaries(list, summaries);
    expect(merged.gone).toEqual(["gone", "gone2"]);
    expect(merged.list).toHaveLength(5);
    expect(merged.list.filter((l) => l.trackId === "a")).toEqual([
      rec({ trackId: "a", index: 0, at: 3, title: "New", artist: "Newer", hasCover: true }),
      rec({ trackId: "a", index: 1, at: 1, title: "New", artist: "Newer", hasCover: true }),
    ]);
    expect(merged.list[1]).toEqual(list[1]);
    expect(merged.changed).toBe(true);
  });

  test("mergeSummaries says when nothing changed", () => {
    const palette: TrackSummary["palette"] = { mesh: ["#000", "#111", "#222", "#333"], scrim: 0.5 };
    const list = [rec({ trackId: "a", index: 0, title: "T", artist: "A", hasCover: false }), rec({ trackId: "gone", index: 0 })];
    const same: TrackSummary[] = [{ id: "a", title: "T", artist: "A", hasCover: false, palette, durationMs: 1 }];
    expect(mergeSummaries(list, same)).toEqual({ list, gone: ["gone"], changed: false });
    for (const over of [{ title: "U" }, { artist: "B" }, { hasCover: true }]) {
      expect(mergeSummaries(list, [{ ...same[0]!, ...over }]).changed).toBe(true);
    }
  });

  test("groupBySong orders songs by the latest save and lines by index", () => {
    const list = [
      rec({ trackId: "a", index: 5, at: 10 }),
      rec({ trackId: "b", index: 1, at: 30 }),
      rec({ trackId: "a", index: 2, at: 20 }),
      rec({ trackId: "c", index: 0, at: 20 }),
      rec({ trackId: "b", index: 0, at: 5, title: "Song B" }),
    ];
    const songs = groupBySong(list);
    expect(songs.map((s) => s.trackId)).toEqual(["b", "a", "c"]);
    expect(songs.map((s) => s.latest)).toEqual([30, 20, 20]);
    expect(songs[0].lines.map((l) => l.index)).toEqual([0, 1]);
    expect(songs[1].lines.map((l) => l.index)).toEqual([2, 5]);
    expect(songs[1]).toMatchObject({ trackId: "a", title: "Song A", artist: "Artist", hasCover: false });
    expect(groupBySong([])).toEqual([]);
  });

  test("latest gives the newest records first", () => {
    const list = [
      rec({ trackId: "a", index: 0, at: 1 }),
      rec({ trackId: "b", index: 1, at: 9 }),
      rec({ trackId: "b", index: 0, at: 9 }),
      rec({ trackId: "a", index: 1, at: 5 }),
    ];
    expect(latest(list, 3).map((l) => `${l.trackId}${l.index}`)).toEqual(["b0", "b1", "a1"]);
    expect(latest(list, 0)).toEqual([]);
    expect(latest(list, 10)).toHaveLength(4);
    expect(latest([...list].reverse(), 3).map((l) => `${l.trackId}${l.index}`)).toEqual(["b0", "b1", "a1"]);
    expect(list[0].at).toBe(1);
  });

  test("savedLabel", () => {
    const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();
    const now = at(2026, 11, 10, 15);
    expect(savedLabel(at(2026, 11, 10, 0, 1), now, "page")).toBe("Salva hoje");
    expect(savedLabel(at(2026, 11, 10, 0, 1), now, "card")).toBe("Hoje");
    expect(savedLabel(at(2026, 11, 9, 23, 59), now, "page")).toBe("Salva ontem");
    expect(savedLabel(at(2026, 11, 9, 23, 59), now, "card")).toBe("Ontem");
    expect(savedLabel(at(2026, 11, 2), now, "page")).toBe("Salva em 2 de nov.");
    expect(savedLabel(at(2026, 5, 20), now, "card")).toBe("20 de mai.");
    expect(savedLabel(at(2025, 12, 3), now, "page")).toBe("Salva em 3 de dez. de 2025");
    expect(savedLabel(at(2025, 12, 3), now, "card")).toBe("3 de dez. de 2025");
    // one minute apart, across midnight and across the year
    expect(savedLabel(at(2025, 12, 31, 23, 59), at(2026, 1, 1, 0, 0), "page")).toBe("Salva ontem");
    // a clock set back: a date after "now" is still a date, never an error
    expect(savedLabel(at(2026, 11, 12), now, "card")).toBe("12 de nov.");
  });

  test("lineHref", () => {
    expect(lineHref({ trackId: "KyD0ZYYTz6", t: null })).toBe("/t/KyD0ZYYTz6");
    expect(lineHref({ trackId: "KyD0ZYYTz6", t: 0 })).toBe("/t/KyD0ZYYTz6?t=0");
    expect(lineHref({ trackId: "KyD0ZYYTz6", t: 2500 })).toBe("/t/KyD0ZYYTz6?t=2.5");
    expect(lineHref({ trackId: "KyD0ZYYTz6", t: 83_000 })).toBe("/t/KyD0ZYYTz6?t=83");
    expect(lineHref({ trackId: "KyD0ZYYTz6", t: 83_449 })).toBe("/t/KyD0ZYYTz6?t=83.5");
    expect(lineHref({ trackId: "a b/c", t: null })).toBe("/t/a%20b%2Fc");
  });

  test("countLabel and linesLabel", () => {
    expect(countLabel(10, 4)).toBe("10 linhas em 4 músicas");
    expect(countLabel(1, 1)).toBe("1 linha em 1 música");
    expect(countLabel(3, 1)).toBe("3 linhas em 1 música");
    expect(linesLabel(1)).toBe("1 linha");
    expect(linesLabel(4)).toBe("4 linhas");
  });
});
