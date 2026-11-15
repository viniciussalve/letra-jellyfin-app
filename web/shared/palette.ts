import type { Palette } from "../../shared/types.ts";

export const DEFAULT_PALETTE: Palette = {
  mesh: ["#2F3E57", "#738488", "#0F1014", "#424B51"],
  scrim: 0.25,
};

type RGB = [number, number, number];

function parseHex(hex: string): RGB {
  const raw = hex.trim().replace(/^#/, "");
  const h = /^[0-9a-f]{3}$/i.test(raw) ? raw.replace(/./g, (c) => c + c) : raw;
  if (!/^[0-9a-f]{6}$/i.test(h)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as RGB;
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

export function contrastRatio(fg: string, bg: string): number {
  const a = luminance(parseHex(fg));
  const b = luminance(parseHex(bg));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function blendWhite(alpha: number, bg: string): string {
  return toHex(parseHex(bg).map((c) => 255 * alpha + c * (1 - alpha)) as RGB);
}

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

function readable(hex: string): boolean {
  return contrastRatio("#FFFFFF", hex) >= 4.5 && contrastRatio(blendWhite(0.75, hex), hex) >= 3;
}

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

export function scrimFor(hex: string): number {
  for (let pct = 25; pct <= 45; pct++) {
    const bg = scrimmed(hex, pct / 100);
    if (contrastRatio(blendWhite(0.6, bg), bg) >= 4.5) return pct / 100;
  }
  return 0.45;
}

export function darkest(colors: readonly string[]): string {
  return colors.reduce((a, b) => (luminance(parseHex(b)) < luminance(parseHex(a)) ? b : a));
}

function kmeans(pixels: RGB[], k: number, iterations: number): { color: RGB; size: number }[] {
  const sorted = [...pixels].sort((a, b) => luminance(a) - luminance(b));
  let centers = Array.from({ length: k }, (_, i) => [...sorted[Math.floor(((i + 0.5) / k) * sorted.length)]!] as RGB);
  let sizes: number[] = new Array(k).fill(0);
  for (let it = 0; it < iterations; it++) {
    const sums = Array.from({ length: k }, () => [0, 0, 0]);
    sizes = new Array(k).fill(0);
    for (const p of pixels) {
      let best = 0;
      let bestD = Infinity;
      for (let j = 0; j < k; j++) {
        const c = centers[j]!;
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      sizes[best]!++;
      for (let ch = 0; ch < 3; ch++) sums[best]![ch]! += p[ch]!;
    }
    centers = centers.map((c, j) => (sizes[j]! > 0 ? (sums[j]!.map((v) => v / sizes[j]!) as RGB) : c));
  }
  return centers.map((color, j) => ({ color, size: sizes[j]! })).sort((a, b) => b.size - a.size);
}

/**
 * Extracts a 4-color WCAG AA compliant mesh palette from an HTMLImageElement
 * using an offscreen 64x64 Canvas, k-means clustering, and OKLCH lightness adjustment.
 */
export function extractPaletteFromImage(img: HTMLImageElement): Palette {
  if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) {
    return DEFAULT_PALETTE;
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (!ctx) return DEFAULT_PALETTE;
    ctx.drawImage(img, 0, 0, 64, 64);
    const { data } = ctx.getImageData(0, 0, 64, 64);
    const pixels: RGB[] = [];
    for (let i = 0; i + 3 < data.length; i += 4) {
      pixels.push([data[i]!, data[i + 1]!, data[i + 2]!]);
    }
    if (pixels.length === 0) return DEFAULT_PALETTE;
    const mesh = kmeans(pixels, 4, 10).map((c) => adjustForText(toHex(c.color))) as Palette["mesh"];
    return { mesh, scrim: Math.max(...mesh.map(scrimFor)) };
  } catch {
    return DEFAULT_PALETTE;
  }
}

/** Updates CSS custom properties `--mesh-1..4`, `--mesh-dark`, and `--scrim` on `:root`. */
export function applyPalette(palette: Palette): void {
  const root = document.documentElement.style;
  palette.mesh.forEach((hex, i) => {
    root.setProperty(`--mesh-${i + 1}`, hex);
  });
  root.setProperty("--mesh-dark", darkest(palette.mesh));
  root.setProperty("--scrim", String(palette.scrim));
}
