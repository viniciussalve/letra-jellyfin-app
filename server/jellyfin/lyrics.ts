import type { Line } from "../../shared/types.ts";
import { trimBreaks } from "../lib/lyrics/trim.ts";
import type { ParsedLyrics } from "./types.ts";

const TICKS_PER_MS = 10_000;

/** Convert .NET ticks (10,000 ticks/ms) to integer milliseconds, clamping negative/non-finite to 0. */
export function ticksToMs(ticks: number): number {
  if (!Number.isFinite(ticks) || ticks <= 0) return 0;
  return Math.round(ticks / TICKS_PER_MS);
}

/**
 * Parse a Jellyfin `/Audio/{id}/Lyrics` JSON payload into our `Lyrics` shape.
 * Supports both Jellyfin 10.9–10.11 `Lyrics` and Jellyfin 12+ `Lines` arrays
 * (as well as camelCase `lyrics`/`lines`/`text`/`start`).
 */
export function parseJellyfinLyrics(dto: unknown): ParsedLyrics {
  if (dto === null || typeof dto !== "object") return null;
  const obj = dto as Record<string, unknown>;
  const rawLines = Array.isArray(obj.Lyrics)
    ? obj.Lyrics
    : Array.isArray(obj.Lines)
      ? obj.Lines
      : Array.isArray(obj.lyrics)
        ? obj.lyrics
        : Array.isArray(obj.lines)
          ? obj.lines
          : null;

  if (!rawLines) return null;

  const parsed: Line[] = [];
  for (const entry of rawLines) {
    if (entry === null || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const rawText = item.Text ?? item.text;
    const text = typeof rawText === "string" ? rawText.trim() : "";
    const rawStart = item.Start ?? item.start;
    const t = typeof rawStart === "number" && Number.isFinite(rawStart) ? ticksToMs(rawStart) : null;
    parsed.push({ t, text });
  }

  const lines = trimBreaks(parsed);
  if (lines.length === 0) return null;

  const synced = lines.some((l) => l.t !== null);
  return { synced, lines, instrumental: false };
}
