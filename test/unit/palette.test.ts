import { describe, expect, test } from "vitest";
import {
  DEFAULT_PALETTE,
  adjustForText,
  blendWhite,
  contrastRatio,
  darkest,
  deterministicPalette,
  scrimFor,
} from "../../server/lib/palette.ts";

function toLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16))) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
}
function passes(c: string): void {
  expect(contrastRatio("#FFFFFF", c)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(blendWhite(0.75, c), c)).toBeGreaterThanOrEqual(3);
}
function scrimmed(hex: string, s: number): string {
  const ch = [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - s)));
  return "#" + ch.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}

describe("palette", () => {
  test("DEFAULT_PALETTE has 4 hex colors and valid scrim", () => {
    expect(DEFAULT_PALETTE.mesh).toHaveLength(4);
    expect(DEFAULT_PALETTE.scrim).toBe(0.25);
  });

  test("grey-teal from the reference is darkened, hue kept", () => {
    const c = adjustForText("#738488");
    expect(c).not.toBe("#738488");
    passes(c);
    expect(Math.abs(hue(c) - hue("#738488"))).toBeLessThan(6);
  });
  test("navy already passes, unchanged", () => expect(adjustForText("#2F3E57")).toBe("#2F3E57"));
  test("a very light color is darkened until it passes", () => passes(adjustForText("#F0F0F0")));

  test("scrim makes white 60% reach 4.5:1", () => {
    const c = adjustForText("#738488");
    const s = scrimFor(c);
    expect(s).toBeGreaterThanOrEqual(0.25);
    expect(s).toBeLessThanOrEqual(0.45);
    const bg = scrimmed(c, s);
    expect(contrastRatio(blendWhite(0.6, bg), bg)).toBeGreaterThanOrEqual(4.5);
  });
  test("scrim is 0.25 when the color already passes", () => {
    expect(scrimFor("#0F1014")).toBe(0.25);
  });
  test("scrim is capped at 0.45 when 4.5:1 is unreachable", () => {
    expect(scrimFor("#BBBBBB")).toBe(0.45);
  });

  test("deterministicPalette is deterministic and WCAG AA compliant", () => {
    const p1 = deterministicPalette("jf-track-123");
    const p2 = deterministicPalette("jf-track-123");
    const p3 = deterministicPalette("jf-track-456");

    expect(p1).toEqual(p2);
    expect(p1.mesh).not.toEqual(p3.mesh);
    expect(p1.mesh).toHaveLength(4);
    for (const c of p1.mesh) {
      expect(c).toMatch(/^#[0-9A-F]{6}$/);
      passes(c);
    }
    expect(p1.scrim).toBeGreaterThanOrEqual(0.25);
    expect(p1.scrim).toBeLessThanOrEqual(0.45);
    expect(p1.scrim).toBe(Math.max(...p1.mesh.map(scrimFor)));
  });

  test("darkest returns the lowest-luminance color", () => {
    expect(darkest(["#334455", "#0F1014", "#2F3E57"])).toBe("#0F1014");
  });
});
