import type { Line, Lyrics } from "../../../shared/types.ts";
import { trimBreaks } from "./trim.ts";

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/y;
const LEADING_TAGS = /^(?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+/;
const WORD_TAG = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g;
const OFFSET = /^\s*\[offset:\s*([+-]?\d+)\s*\]\s*$/i;

function toMs(min: string, sec: string, frac: string | undefined): number {
  const f = frac ? Number(frac.padEnd(3, "0")) : 0;
  return Number(min) * 60000 + Number(sec) * 1000 + f;
}

export function isLrc(text: string, minLines = 3): boolean {
  let n = 0;
  for (const raw of text.split(/\r?\n/)) {
    if (LEADING_TAGS.test(raw.trimStart())) n++;
    if (n >= minLines) return true;
  }
  return false;
}

export function parseLrc(text: string): Lyrics {
  let offset = 0;
  const lines: Line[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const off = OFFSET.exec(line);
    if (off) {
      offset = Number(off[1]);
      continue;
    }
    const times: number[] = [];
    let pos = 0;
    for (;;) {
      TIME_TAG.lastIndex = pos;
      const m = TIME_TAG.exec(line);
      if (!m) break;
      times.push(toMs(m[1], m[2], m[3]));
      pos = TIME_TAG.lastIndex;
    }
    if (times.length === 0) continue; // ID tags, junk
    const content = line.slice(pos).replace(WORD_TAG, "").replace(/\s+/g, " ").trim();
    for (const t of times) lines.push({ t: Math.max(0, t - offset), text: content });
  }
  lines.sort((a, b) => (a.t as number) - (b.t as number)); // stable
  return { synced: true, lines: trimBreaks(lines), instrumental: false };
}
