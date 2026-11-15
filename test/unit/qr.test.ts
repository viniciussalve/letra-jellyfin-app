import { expect, test } from "vitest";
import { qrCenterBox, qrMatrix, qrSvg } from "../../web/player/qr.ts";

const URL48 = "https://letra.example.com/t/AbC123defG?x=1234567";

test("url fixture is 48 chars", () => {
  expect(URL48).toHaveLength(48);
});

test("matrix is square with dark finder corners", () => {
  const m = qrMatrix(URL48);
  const n = m.length;
  expect(n).toBeGreaterThanOrEqual(25);
  for (const row of m) expect(row).toHaveLength(n);
  expect(m[0][0]).toBe(true);
  expect(m[0][n - 1]).toBe(true);
  expect(m[n - 1][0]).toBe(true);
});

test("svg shape", () => {
  const svg = qrSvg(URL48);
  expect(svg.startsWith("<svg")).toBe(true);
  expect(svg).toContain('viewBox="0 0 240 240"');
  expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
});

test("exactly 6 finder rects", () => {
  expect(qrSvg(URL48).match(/<rect[^>]*data-finder/g)).toHaveLength(6);
});

test("no circle inside the center box; radius is 0.41 module", () => {
  const svg = qrSvg(URL48);
  const n = qrMatrix(URL48).length;
  const box = qrCenterBox(240);
  const circles = [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)];
  expect(circles.length).toBeGreaterThan(50);
  for (const [, cx, cy, r] of circles) {
    const x = Number(cx), y = Number(cy);
    const inside = x > box.x && x < box.x + box.width && y > box.y && y < box.y + box.width;
    expect(inside).toBe(false);
    expect(Math.abs(Number(r) - 0.41 * (240 / n))).toBeLessThan(1e-6);
  }
});

const circleCenters = (svg: string) =>
  [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)"/g)].map(([, cx, cy]) => ({ x: Number(cx), y: Number(cy) }));

test("the alignment pattern is drawn whole, a ring and an eye, with no dots in it", () => {
  // Version 6: one alignment pattern, centered on module (n - 7, n - 7).
  const svg = qrSvg(URL48);
  const n = qrMatrix(URL48).length;
  const m = 240 / n;
  expect(svg.match(/<rect[^>]*data-align="ring"/g)).toHaveLength(1);
  expect(svg.match(/<rect[^>]*data-align="eye"/g)).toHaveLength(1);
  const eye = /<rect data-align="eye" x="([\d.]+)" y="([\d.]+)"/.exec(svg)!;
  expect(Number(eye[1])).toBeCloseTo((n - 7) * m, 6);
  expect(Number(eye[2])).toBeCloseTo((n - 7) * m, 6);
  const lo = (n - 9) * m;
  const hi = (n - 4) * m;
  for (const { x, y } of circleCenters(svg)) expect(x > lo && x < hi && y > lo && y < hi).toBe(false);
});

test("an alignment pattern under the center box is left to the cleared modules", () => {
  // Version 8 has six; the middle one is under the center box and is not drawn.
  const url = "https://a-very-long-public-host-name.example.com/t/AbCdEfGhIj?x=12";
  expect(qrMatrix(url)).toHaveLength(49);
  const svg = qrSvg(url);
  expect(svg.match(/<rect[^>]*data-align="ring"/g)).toHaveLength(5);
  expect(svg.match(/<rect[^>]*data-finder/g)).toHaveLength(6);
  const box = qrCenterBox(240);
  for (const { x, y } of circleCenters(svg)) {
    expect(x > box.x && x < box.x + box.width && y > box.y && y < box.y + box.width).toBe(false);
  }
});

test("center box is centered and sized", () => {
  const b = qrCenterBox(240);
  expect(b.width).toBeCloseTo(0.22 * 240 + 12);
  expect(b.x).toBeCloseTo((240 - b.width) / 2);
  expect(b.y).toBe(b.x);
});
