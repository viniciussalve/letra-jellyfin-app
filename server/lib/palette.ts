import { createHash } from "node:crypto";
import type { Palette } from "../../shared/types.ts";

export const DEFAULT_PALETTE: Palette = {
  mesh: ["#2F3E57", "#738488", "#0F1014", "#424B51"],
  scrim: 0.25,
};

type RGB = [number, number, number];

// ---------- sRGB / WCAG ----------

function parseHex(hex: string): RGB {
  const raw = hex.trim().replace(/^#/, "");
  const h = /^[0-9a-f]{3}$/i.test(raw) ? raw.replace(/./g, (c) => c + c) : raw;
  if (!/^[0-9a-f]{6}$/i.test(h)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
}

function toHex([r, g, b]: RGB): string {
  return (
    "#" +
    [r, g, b]
      .map((v) => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

function toLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function fromLinear(c: number): number {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return v * 255;
}

function luminance(rgb: RGB): number {
  const [r, g, b] = rgb.map(toLinear) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two #RRGGBB colors. */
export function contrastRatio(fg: string, bg: string): number {
  const a = luminance(parseHex(fg));
  const b = luminance(parseHex(bg));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** White at `alpha` composited over `bg`, as #RRGGBB. */
export function blendWhite(alpha: number, bg: string): string {
  return toHex(parseHex(bg).map((c) => 255 * alpha + c * (1 - alpha)) as RGB);
}

// ---------- OKLCH ----------

function toOklch(hex: string): { l: number; c: number; h: number } {
  const [r, g, b] = parseHex(hex).map(toLinear) as RGB;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(a, bb), h: Math.atan2(bb, a) };
}

/** Linear sRGB for an OKLCH color; may fall outside 0..1. */
function oklchToLinear(L: number, C: number, h: number): RGB {
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const EPS = 1e-6;
const inGamut = (rgb: RGB): boolean => rgb.every((v) => v >= -EPS && v <= 1 + EPS);

/** OKLCH to hex; chroma is reduced if the color is outside sRGB. */
function oklchToHex(L: number, C: number, h: number): string {
  let lo = 0;
  let hi = C;
  if (inGamut(oklchToLinear(L, C, h))) lo = C;
  else {
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear(L, mid, h))) lo = mid;
      else hi = mid;
    }
  }
  return toHex(oklchToLinear(L, lo, h).map((v) => fromLinear(Math.min(1, Math.max(0, v)))) as RGB);
}

// ---------- spec §7 steps 3 and 4 ----------

function readable(hex: string): boolean {
  return contrastRatio("#FFFFFF", hex) >= 4.5 && contrastRatio(blendWhite(0.75, hex), hex) >= 3;
}

/** Lowers OKLCH lightness, keeping hue, until white and white at 75% are legible. */
export function adjustForText(hex: string): string {
  const normalized = toHex(parseHex(hex));
  if (readable(normalized)) return normalized;
  const { l, c, h } = toOklch(normalized);
  let lo = 0;
  let hi = l;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (readable(oklchToHex(mid, c, h))) lo = mid;
    else hi = mid;
  }
  // Rounding to 8-bit can undo the margin; step down until the check holds.
  let L = lo;
  let out = oklchToHex(L, c, h);
  while (!readable(out) && L > 0) {
    L = Math.max(0, L - 0.002);
    out = oklchToHex(L, c, h);
  }
  return out;
}

function scrimmed(hex: string, s: number): string {
  return toHex(parseHex(hex).map((c) => Math.round(c * (1 - s))) as RGB);
}

/** Black scrim strength, 0.25 up to 0.45, so white at 60% reaches 4.5:1. */
export function scrimFor(hex: string): number {
  for (let pct = 25; pct <= 45; pct++) {
    const bg = scrimmed(hex, pct / 100);
    if (contrastRatio(blendWhite(0.6, bg), bg) >= 4.5) return pct / 100;
  }
  return 0.45;
}

// ---------- deterministic SSR palette ----------

/**
 * Generates a deterministic, WCAG AA compliant 4-color mesh palette from a seed string
 * (such as a Jellyfin item ID). Produces 4 hue-varied hex colors with `adjustForText`
 * and `scrimFor` applied so SSR HTML renders an atmospheric background immediately before
 * the browser extracts the cover's exact palette on image load.
 */
export function deterministicPalette(seed: string): Palette {
  const hash = createHash("sha256").update(seed).digest();
  const baseHue = ((hash[0]! * 256 + hash[1]!) / 65536) * Math.PI * 2;
  const offsets = [0, 0.75, 2.35, -0.85];
  const lightnesses = [0.42, 0.56, 0.24, 0.36];
  const chromas = [0.11, 0.09, 0.06, 0.08];

  const mesh = offsets.map((offset, i) => {
    const byteA = hash[(i * 4 + 2) % hash.length]!;
    const byteB = hash[(i * 4 + 3) % hash.length]!;
    const hueJitter = ((byteA - 128) / 128) * 0.25;
    const chromaJitter = ((byteB - 128) / 128) * 0.025;
    const h = baseHue + offset + hueJitter;
    const l = lightnesses[i]!;
    const c = Math.max(0.02, chromas[i]! + chromaJitter);
    return adjustForText(oklchToHex(l, c, h));
  }) as Palette["mesh"];

  return { mesh, scrim: Math.max(...mesh.map(scrimFor)) };
}

/** Darkest of the palette colors (by luminance). */
export function darkest(colors: readonly string[]): string {
  return colors.reduce((a, b) => (luminance(parseHex(b)) < luminance(parseHex(a)) ? b : a));
}
