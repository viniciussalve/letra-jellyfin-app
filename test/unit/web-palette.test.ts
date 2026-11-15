import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PALETTE,
  adjustForText,
  applyPalette,
  blendWhite,
  contrastRatio,
  darkest,
  extractPaletteFromImage,
  scrimFor,
} from "../../web/shared/palette.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("web/shared/palette", () => {
  it("supports 3-digit hex and rejects invalid hex cleanly", () => {
    expect(contrastRatio("#FFF", "#000000")).toBeCloseTo(21, 1);
    expect(adjustForText("#FFF")).toMatch(/^#[0-9A-F]{6}$/);
    expect(() => adjustForText("invalid")).toThrow(/Invalid hex color/);
    expect(() => contrastRatio("#GGGGGG", "#000000")).toThrow(/Invalid hex color/);
  });

  it("adjustForText, scrimFor, blendWhite, and darkest maintain WCAG AA", () => {
    const adjusted = adjustForText("#F0F0F0");
    expect(contrastRatio("#FFFFFF", adjusted)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(blendWhite(0.75, adjusted), adjusted)).toBeGreaterThanOrEqual(3);
    expect(scrimFor("#0F1014")).toBe(0.25);
    expect(scrimFor("#BBBBBB")).toBe(0.45);
    expect(darkest(["#334455", "#0F1014", "#2F3E57"])).toBe("#0F1014");
  });

  it("extractPaletteFromImage returns DEFAULT_PALETTE when image is incomplete or canvas unavailable", () => {
    expect(extractPaletteFromImage({ complete: false, naturalWidth: 0, naturalHeight: 0 } as HTMLImageElement)).toEqual(
      DEFAULT_PALETTE,
    );
    expect(extractPaletteFromImage({ complete: true, naturalWidth: 100, naturalHeight: 100 } as HTMLImageElement)).toEqual(
      DEFAULT_PALETTE,
    );
  });

  it("extractPaletteFromImage clusters pixels via k-means and returns 4 WCAG AA colors", () => {
    const data = new Uint8ClampedArray(64 * 64 * 4);
    for (let i = 0; i < 64 * 64; i++) {
      const q = i % 4;
      data[i * 4] = q === 0 ? 200 : q === 1 ? 30 : q === 2 ? 220 : 15;
      data[i * 4 + 1] = q === 0 ? 40 : q === 1 ? 150 : q === 2 ? 220 : 20;
      data[i * 4 + 2] = q === 0 ? 60 : q === 1 ? 200 : q === 2 ? 230 : 35;
      data[i * 4 + 3] = 255;
    }

    vi.stubGlobal("document", {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: () => {},
          getImageData: () => ({ data }),
        }),
      }),
    });

    const palette = extractPaletteFromImage({ complete: true, naturalWidth: 200, naturalHeight: 200 } as HTMLImageElement);
    expect(palette.mesh).toHaveLength(4);
    for (const hex of palette.mesh) {
      expect(hex).toMatch(/^#[0-9A-F]{6}$/);
      expect(contrastRatio("#FFFFFF", hex)).toBeGreaterThanOrEqual(4.5);
    }
    expect(palette.scrim).toBeGreaterThanOrEqual(0.25);
    expect(palette.scrim).toBeLessThanOrEqual(0.45);
  });

  it("applyPalette writes --mesh-1..4, --mesh-dark, and --scrim to documentElement.style", () => {
    const props = new Map<string, string>();
    vi.stubGlobal("document", {
      documentElement: {
        style: {
          setProperty: (k: string, v: string) => props.set(k, v),
        },
      },
    });

    applyPalette(DEFAULT_PALETTE);
    expect(props.get("--mesh-1")).toBe(DEFAULT_PALETTE.mesh[0]);
    expect(props.get("--mesh-2")).toBe(DEFAULT_PALETTE.mesh[1]);
    expect(props.get("--mesh-3")).toBe(DEFAULT_PALETTE.mesh[2]);
    expect(props.get("--mesh-4")).toBe(DEFAULT_PALETTE.mesh[3]);
    expect(props.get("--mesh-dark")).toBe("#0F1014");
    expect(props.get("--scrim")).toBe("0.25");
  });
});
