import { expect, test } from "vitest";
import { wrapLines } from "../../web/shared/wrap.ts";

const measure = (s: string) => s.length * 10;

test("wrapLines breaks at spaces", () => {
  expect(wrapLines("aaa bbb ccc", 70, measure, 3)).toEqual(["aaa bbb", "ccc"]);
});

test("ellipsis on the last allowed line", () => {
  const lines = wrapLines("aaaa bbbb cccc dddd eeee ffff", 50, measure, 2);
  expect(lines).toHaveLength(2);
  expect(lines[1]!.endsWith("…")).toBe(true);
  for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(50);
});

test("no ellipsis when the text fits exactly", () => {
  expect(wrapLines("aaa bbb ccc", 30, measure, 3)).toEqual(["aaa", "bbb", "ccc"]);
});

test("a 200-character word breaks by characters", () => {
  const word = "x".repeat(200);
  const lines = wrapLines(word, 100, measure, 30);
  expect(lines.length).toBe(20);
  for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(100);
  expect(lines.join("").replace("…", "").startsWith("xxxxxxxxxx")).toBe(true);
  const cut = wrapLines(word, 100, measure, 3);
  expect(cut).toHaveLength(3);
  expect(cut[2]!.endsWith("…")).toBe(true);
  for (const l of cut) expect(measure(l)).toBeLessThanOrEqual(100);
});

test("Japanese without spaces wraps within the width", () => {
  const lines = wrapLines("夜空に浮かぶ星のように君を想う", 60, measure, 10);
  expect(lines.length).toBeGreaterThan(1);
  for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(60);
  expect(lines.join("")).toBe("夜空に浮かぶ星のように君を想う");
});

test("empty and blank input give no lines", () => {
  expect(wrapLines("", 100, measure, 3)).toEqual([]);
  expect(wrapLines("   ", 100, measure, 3)).toEqual([]);
  expect(wrapLines("abc", 100, measure, 0)).toEqual([]);
});
