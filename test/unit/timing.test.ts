import { expect, test } from "vitest";
import { activeIndex, blurLevel, currentVerse, hasIntro, INTRO_MIN_MS, lineEnd, LYRICS_LEAD_MS, startAt, wipeProgress } from "../../web/player/timing.ts";

const L = [
  { t: 500, text: "a" },
  { t: 2500, text: "" },
  { t: 4500, text: "b" },
  { t: 4500, text: "c" },
];

test("before first", () => expect(activeIndex(L, 100)).toBe(-1));
test("exact boundary and duplicates take the last", () => {
  expect(activeIndex(L, 2500)).toBe(1);
  expect(activeIndex(L, 4500)).toBe(3);
});
test("after last stays on last", () => expect(activeIndex(L, 99999)).toBe(3));
test("empty list", () => expect(activeIndex([], 1000)).toBe(-1));
test("untimed lines are skipped", () => {
  const U = [{ t: null, text: "x" }, { t: 1000, text: "y" }];
  expect(activeIndex(U, 5000)).toBe(1);
  expect(activeIndex(U, 500)).toBe(-1);
});
test("last line ends at min(t+6000, duration)", () => {
  expect(lineEnd(L, 3, 20000)).toBe(10500);
  expect(lineEnd(L, 3, 8000)).toBe(8000);
});
test("a line ends where the next timed line starts", () => {
  expect(lineEnd(L, 0, 20000)).toBe(2500);
  expect(lineEnd(L, 2, 20000)).toBe(4500);
});
test("wipe clamps", () => {
  expect(wipeProgress(L, 0, 0, 8000)).toBe(0);
  expect(wipeProgress(L, 0, 1500, 8000)).toBe(0.5);
  expect(wipeProgress(L, 0, 9000, 8000)).toBe(1);
});
test("zero-length line does not divide by zero", () => {
  expect(wipeProgress(L, 2, 4500, 20000)).toBe(1);
  expect(wipeProgress(L, 2, 4000, 20000)).toBe(0);
});

test("hasIntro: first verse at 3 s or later", () => {
  expect(INTRO_MIN_MS).toBe(3000);
  expect(hasIntro([{ t: 2999, text: "a" }])).toBe(false);
  expect(hasIntro([{ t: 3000, text: "a" }])).toBe(true);
  expect(hasIntro([])).toBe(false);
});
test("hasIntro skips blank and untimed lines to find the first verse", () => {
  expect(hasIntro([{ t: 0, text: "" }, { t: 4000, text: "a" }])).toBe(true);
  expect(hasIntro([{ t: null, text: "x" }, { t: 1000, text: "a" }])).toBe(false);
  expect(hasIntro([{ t: 500, text: "  " }, { t: 1000, text: "a" }])).toBe(false);
});

test("currentVerse covers every branch", () => {
  const lines = [{ t: 0, text: "" }, { t: 4000, text: "a" }, { t: 5000, text: "" }];
  const none = { verse: null, translation: null };
  expect(currentVerse("synced", lines, 1, null)).toEqual({ verse: "a", translation: null });
  expect(currentVerse("synced", lines, 1, " olá ")).toEqual({ verse: "a", translation: "olá" });
  expect(currentVerse("synced", lines, 1, "  ")).toEqual({ verse: "a", translation: null });
  expect(currentVerse("synced", lines, -1, "x")).toEqual(none); // intro row or nothing active
  expect(currentVerse("synced", lines, 2, "x")).toEqual(none); // a break
  expect(currentVerse("unsynced", lines, 1, "x")).toEqual(none);
  expect(currentVerse("none", [], -1, null)).toEqual(none);
  expect(currentVerse("instrumental", [], -1, null)).toEqual(none);
});

test("blurLevel: 1, 2 then 3 steps by distance, either side; never 0 for an inactive row", () => {
  expect([1, 2, 3, 4, 10].map((d) => blurLevel(5 + d, 5, 24))).toEqual([1, 2, 3, 3, 3]);
  expect([1, 2, 3, 4].map((d) => blurLevel(5 - d, 5, 24))).toEqual([1, 2, 3, 3]);
  expect(blurLevel(5, 5, 24)).toBe(1); // distance 0 but inactive (before any verse is active)
});
test("blurLevel: off beyond the reach", () => {
  expect(blurLevel(5 + 24, 5, 24)).toBe(3);
  expect(blurLevel(5 + 25, 5, 24)).toBe(0);
  expect(blurLevel(5 - 25, 5, 24)).toBe(0);
});

const G = [
  { t: 1000, text: "a" },
  { t: 3000, text: "b" },
  { t: 3200, text: "c" }, // shorter than the lead
  { t: 3200, text: "d" }, // same start
  { t: 9000, text: "e" },
];
test("activeIndex with a lead lights a verse early, but never before half the gap from the previous line", () => {
  expect(activeIndex(G, 2650, LYRICS_LEAD_MS)).toBe(0);
  expect(activeIndex(G, 2700, LYRICS_LEAD_MS)).toBe(1);
  expect(activeIndex(G, 700, LYRICS_LEAD_MS)).toBe(0); // the first line has no line before it
  expect(activeIndex(G, 699, LYRICS_LEAD_MS)).toBe(-1);
  // c starts 200 ms after b: the lead shrinks to 100 ms, so a seek to b's start still shows b.
  expect(activeIndex(G, 3000, LYRICS_LEAD_MS)).toBe(1);
  // Equal starts light together (the last of the group wins); the first is never shown.
  expect(activeIndex(G, 3099, LYRICS_LEAD_MS)).toBe(1);
  expect(activeIndex(G, 3100, LYRICS_LEAD_MS)).toBe(3);
  expect(activeIndex(G, 3000)).toBe(1); // no lead: unchanged
});
test("a wipe with a lead ends when the next verse lights, and starts on real time", () => {
  expect(lineEnd(G, 0, 20000, LYRICS_LEAD_MS)).toBe(2700);
  expect(wipeProgress(G, 0, 1000, 20000, LYRICS_LEAD_MS)).toBe(0);
  expect(wipeProgress(G, 0, 2700, 20000, LYRICS_LEAD_MS)).toBe(1);
  expect(wipeProgress(G, 0, 1850, 20000, LYRICS_LEAD_MS)).toBeCloseTo(0.5, 5);
  // Shorter than the lead: ends halfway, after the start.
  expect(lineEnd(G, 1, 20000, LYRICS_LEAD_MS)).toBe(3100);
  expect(lineEnd(G, 2, 20000, LYRICS_LEAD_MS)).toBe(3100); // c is never shown; its end is d's light time
  expect(lineEnd(G, 3, 20000, LYRICS_LEAD_MS)).toBe(8700);
  // The last line has no next verse: unchanged.
  expect(lineEnd(G, 4, 20000, LYRICS_LEAD_MS)).toBe(15000);
  expect(lineEnd(G, 0, 20000)).toBe(3000);
});

test("sweeping the clock: monotonic, a seek to a start shows that line, a wipe ends as the next shown line lights", () => {
  const F = [
    { t: 1000, text: "a" },
    { t: 3000, text: "b" },
    { t: 3000, text: "b2" }, // equal start
    { t: 3200, text: "c" }, // short gap
    { t: 5000, text: "" }, // a break row
    { t: 7000, text: "d" },
  ];
  let last = -1;
  for (let ms = 0; ms <= 9000; ms += 10) {
    const i = activeIndex(F, ms, LYRICS_LEAD_MS);
    expect(i).toBeGreaterThanOrEqual(last);
    last = i;
  }
  const shownAfter = (i: number) => {
    // The next index the sweep shows after i.
    for (let ms = 0; ms <= 9000; ms++) if (activeIndex(F, ms, LYRICS_LEAD_MS) > i) return ms;
    return null;
  };
  F.forEach((l, i) => {
    const shown = activeIndex(F, l.t, LYRICS_LEAD_MS);
    expect(shown).toBe(F.map((x) => x.t).lastIndexOf(l.t)); // the clicked line, or its group's last member
    if (shown !== i) return; // only shown lines have a wipe
    const next = shownAfter(i);
    if (next !== null) expect(lineEnd(F, i, 20000, LYRICS_LEAD_MS)).toBe(next);
  });
});

test("startAt reads seconds with at most one decimal, inside the song", () => {
  expect(startAt("?t=83.5", 200_000)).toBe(83_500);
  expect(startAt("?t=0", 200_000)).toBe(0);
  expect(startAt("?t=12&x=1", 200_000)).toBe(12_000);
  for (const bad of ["", "?x=5", "?t=", "?t=abc", "?t=-3", "?t=+5", "?t=1.25", "?t=1e3", "?t=200", "?t=999"]) {
    expect(startAt(bad, 200_000), bad).toBeNull();
  }
});
