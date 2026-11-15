import { expect, test } from "vitest";
import { layoutStoryCard, STORY, type StoryData } from "../../web/player/story-card.ts";

const measure = (s: string) => s.length * 10;
const palette = { mesh: ["#112233", "#223344", "#334455", "#445566"], scrim: 0.5 } as StoryData["palette"];
const base: StoryData = {
  title: "Song",
  artist: "Artist",
  palette,
  coverUrl: "/media/abc/cover.jpg",
  verse: "one two three four five six seven eight nine ten eleven twelve",
  translation: "um dois três quatro cinco seis sete oito nove dez onze doze treze",
};
const long = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

test("no verse gives no verse and no translation lines", () => {
  const l = layoutStoryCard({ ...base, verse: null }, measure);
  expect(l.verseLines).toEqual([]);
  expect(l.translationLines).toEqual([]);
  expect(layoutStoryCard({ ...base, verse: "  " }, measure).translationLines).toEqual([]);
});

test("verse and translation are both present and capped", () => {
  const l = layoutStoryCard({ ...base, verse: long(80), translation: long(80) }, measure);
  expect(l.verseLines.length).toBeGreaterThan(0);
  expect(l.verseLines.length).toBeLessThanOrEqual(STORY.verseMax);
  expect(l.translationLines.length).toBeGreaterThan(0);
  expect(l.translationLines.length).toBeLessThanOrEqual(STORY.transMax);
});

test("a blank translation gives no translation lines", () => {
  expect(layoutStoryCard({ ...base, translation: null }, measure).translationLines).toEqual([]);
  expect(layoutStoryCard({ ...base, translation: " " }, measure).translationLines).toEqual([]);
});

test("coverUrl null does not change the text layout", () => {
  expect(layoutStoryCard({ ...base, coverUrl: null }, measure)).toEqual(layoutStoryCard(base, measure));
});

test("a 200-character title gives one line ending with an ellipsis", () => {
  const l = layoutStoryCard({ ...base, title: "T".repeat(200), artist: "A ".repeat(100) }, measure);
  expect(l.title.endsWith("…")).toBe(true);
  expect(l.title.includes("\n")).toBe(false);
  expect(measure(l.title)).toBeLessThanOrEqual(STORY.textWidth);
  expect(l.artist.endsWith("…")).toBe(true);
  expect(measure(l.artist)).toBeLessThanOrEqual(STORY.textWidth);
});

test("a 4-line verse keeps the translation above the wordmark", () => {
  const l = layoutStoryCard({ ...base, verse: long(80), translation: long(80) }, measure);
  expect(l.verseLines).toHaveLength(STORY.verseMax);
  const start = STORY.verseY + l.verseLines.length * STORY.verseLine;
  const lastBaseline = start + (l.translationLines.length - 1) * STORY.transLine;
  expect(lastBaseline).toBeLessThanOrEqual(STORY.wordmarkY - 60);
  expect(l.translationLines.length).toBeLessThan(STORY.transMax);
  expect(l.translationLines.at(-1)!.endsWith("…")).toBe(true);
});

test("a short verse leaves room for the full translation", () => {
  const l = layoutStoryCard({ ...base, verse: "hi", translation: long(80) }, measure);
  expect(l.translationLines).toHaveLength(STORY.transMax);
});

test("the no-cover tile is square and has no black backing", async () => {
  const { drawStoryCard } = await import("../../web/player/story-card.ts");
  const calls: { name: string; args: unknown[]; fill: unknown }[] = [];
  const state: Record<string, unknown> = {};
  const grad = { addColorStop() {} };
  const ctx = new Proxy(state, {
    get(t, k: string) {
      if (k === "measureText") return (s: string) => ({ width: s.length * 10 });
      if (k === "createRadialGradient") return () => grad;
      if (k in t) return t[k];
      return (...args: unknown[]) => void calls.push({ name: k, args, fill: t.fillStyle });
    },
    set(t, k: string, v) {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  drawStoryCard(ctx, { ...base, coverUrl: null, translation: null }, null);
  expect(calls.some((c) => c.name === "arcTo" || c.name === "roundRect")).toBe(false);
  const squares = calls.filter((c) => c.name === "fillRect" && c.args[2] === STORY.cover);
  expect(squares).toHaveLength(1);
  expect(squares[0]!.fill).toBe(palette.mesh[0]);
});
