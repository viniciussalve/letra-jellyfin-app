import type { Line } from "../../shared/types.ts";

const LAST_LINE_MS = 6000;

/** A first verse this late (or later) gets a dots row before it. */
export const INTRO_MIN_MS = 3000;

/**
 * The shown active verse runs this far ahead of the audio clock: the verse takes about half
 * a second to light up and scroll into place, so without a lead it looks ready after the
 * voice has started. The wipe keeps real time.
 */
export const LYRICS_LEAD_MS = 300;

/** Index of the first timed line with text, or -1. */
export function firstVerseIndex(lines: Line[]): number {
  return lines.findIndex((l) => l.t !== null && l.text.trim() !== "");
}

/** True when the first timed, non-blank line starts at INTRO_MIN_MS or later. */
export function hasIntro(lines: Line[]): boolean {
  const i = firstVerseIndex(lines);
  return i >= 0 && lines[i]!.t! >= INTRO_MIN_MS;
}

/** Start of the last timed line before index j whose start is strictly smaller than its own; null if none. */
function previousStart(lines: Line[], j: number): number | null {
  const t = lines[j].t as number;
  for (let k = j - 1; k >= 0; k--) {
    const u = lines[k].t;
    if (u !== null && u < t) return u;
  }
  return null;
}

/**
 * How much earlier than its start line j lights: `leadMs`, but at most half the gap from the
 * previous start (strictly earlier, so lines that share a start light together and the last
 * one wins). A verse therefore never lights before the previous one has started: a seek to a
 * verse's start still shows that verse.
 */
function leadFor(lines: Line[], j: number, leadMs: number): number {
  const prev = previousStart(lines, j);
  return prev === null ? leadMs : Math.min(leadMs, ((lines[j].t as number) - prev) / 2);
}

/**
 * Index of the last timed line that has lit at ms; -1 before the first timed line. A line
 * lights at its start minus the lead (`leadMs`, default none).
 */
export function activeIndex(lines: Line[], ms: number, leadMs = 0): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].t;
    if (t !== null && t - leadFor(lines, i, leadMs) <= ms) return i;
  }
  return -1;
}

/**
 * End of line i: when the next timed line lights (its start minus the lead, see activeIndex),
 * or min(start + 6 s, duration) for the last one.
 */
export function lineEnd(lines: Line[], i: number, durationMs: number, leadMs = 0): number {
  for (let j = i + 1; j < lines.length; j++) {
    const t = lines[j].t;
    if (t !== null) return t - leadFor(lines, j, leadMs);
  }
  const start = lines[i]?.t ?? 0;
  return Math.min(start + LAST_LINE_MS, durationMs);
}

/** Wipe progress of line i at ms, clamped to 0..1. With a lead the wipe ends as the next verse lights. */
export function wipeProgress(lines: Line[], i: number, ms: number, durationMs: number, leadMs = 0): number {
  const start = lines[i]?.t;
  if (start === null || start === undefined) return 0;
  const end = lineEnd(lines, i, durationMs, leadMs);
  if (end <= start) return ms >= start ? 1 : 0;
  return Math.min(1, Math.max(0, (ms - start) / (end - start)));
}

/**
 * Blur level of a row: 1, 2 or 3 steps by distance from `anchor` (an inactive row at
 * distance 0 still gets 1), 0 beyond `reach`. The caller gives the active row no blur.
 */
export function blurLevel(index: number, anchor: number, reach: number): 0 | 1 | 2 | 3 {
  const d = Math.abs(index - anchor);
  return d > reach ? 0 : (Math.min(Math.max(d, 1), 3) as 1 | 2 | 3);
}

/**
 * The active verse's text and shown translation. Nulls unless the lyrics are synced and a
 * real verse (not the intro row, a break or nothing yet) is active.
 */
export function currentVerse(
  state: string,
  lines: Line[],
  active: number,
  translation: string | null,
): { verse: string | null; translation: string | null } {
  const text = state === "synced" ? lines[active]?.text : undefined;
  if (text === undefined || text.trim() === "") return { verse: null, translation: null };
  return { verse: text, translation: translation?.trim() || null };
}

/**
 * The position in ms a link asks for with `?t=<seconds>` (whole seconds or one decimal), or
 * null when the first `t` is missing, malformed or not inside the song.
 */
export function startAt(search: string, durationMs: number): number | null {
  const value = new URLSearchParams(search).get("t");
  if (value === null || !/^\d+(\.\d)?$/.test(value)) return null;
  const ms = Math.round(Number(value) * 1000);
  return ms < durationMs ? ms : null;
}
