import { describe, expect, it } from "vitest";
import { parseJellyfinLyrics, ticksToMs } from "../../server/jellyfin/lyrics.ts";

describe("ticksToMs", () => {
  it("converts .NET ticks (10,000 ticks/ms) to rounded integer ms", () => {
    expect(ticksToMs(0)).toBe(0);
    expect(ticksToMs(10_000)).toBe(1);
    expect(ticksToMs(15_000)).toBe(2);
    expect(ticksToMs(12_345_000)).toBe(1235);
    expect(ticksToMs(1_500_000_000)).toBe(150_000);
  });

  it("clamps negative and non-finite values to 0", () => {
    expect(ticksToMs(-50_000)).toBe(0);
    expect(ticksToMs(Number.NaN)).toBe(0);
    expect(ticksToMs(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("parseJellyfinLyrics", () => {
  it("parses Jellyfin 10.9-10.11 Lyrics schema including Start === 0", () => {
    const parsed = parseJellyfinLyrics({
      Lyrics: [
        { Text: "   ", Start: 0 },
        { Text: "First line", Start: 0 },
        { Text: "", Start: 10_000_000 },
        { Text: "Second line", Start: 25_000_000 },
        { Text: "" },
      ],
    });
    expect(parsed).toEqual({
      synced: true,
      instrumental: false,
      lines: [
        { t: 0, text: "First line" },
        { t: 1000, text: "" },
        { t: 2500, text: "Second line" },
      ],
    });
  });

  it("parses Jellyfin 12+ Lines schema and camelCase variants", () => {
    expect(
      parseJellyfinLyrics({
        Lines: [
          { Text: "Line A", Start: 5_000_000 },
          { Text: "Line B", Start: 12_340_000 },
        ],
      }),
    ).toEqual({
      synced: true,
      instrumental: false,
      lines: [
        { t: 500, text: "Line A" },
        { t: 1234, text: "Line B" },
      ],
    });

    expect(
      parseJellyfinLyrics({
        lines: [{ text: "Camel", start: 30_000_000 }],
      }),
    ).toEqual({
      synced: true,
      instrumental: false,
      lines: [{ t: 3000, text: "Camel" }],
    });
  });

  it("handles unsynced lyrics when Start is absent, null, or non-finite", () => {
    const parsed = parseJellyfinLyrics({
      Lyrics: [
        { Text: "No timestamp" },
        { Text: "Null timestamp", Start: null },
        { Text: "NaN timestamp", Start: Number.NaN },
      ],
    });
    expect(parsed).toEqual({
      synced: false,
      instrumental: false,
      lines: [
        { t: null, text: "No timestamp" },
        { t: null, text: "Null timestamp" },
        { t: null, text: "NaN timestamp" },
      ],
    });
  });

  it("returns null for invalid, empty, or all-blank payloads", () => {
    expect(parseJellyfinLyrics(null)).toBeNull();
    expect(parseJellyfinLyrics(undefined)).toBeNull();
    expect(parseJellyfinLyrics("not an object")).toBeNull();
    expect(parseJellyfinLyrics({})).toBeNull();
    expect(parseJellyfinLyrics({ Lyrics: [] })).toBeNull();
    expect(parseJellyfinLyrics({ Lines: [{ Text: "   ", Start: 0 }] })).toBeNull();
  });
});
