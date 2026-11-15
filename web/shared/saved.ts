import type { TrackSummary } from "../../shared/types.ts";
import { defaultStore, type KeyValueStore } from "./recents.ts";

/** A verse the listener saved, with a copy of its text and enough of the song to show it without the server. */
export type SavedLine = {
  trackId: string;
  title: string;
  artist: string;
  hasCover: boolean;
  /** Position in `track.lyrics.lines`. */
  index: number;
  /** Start of the line in ms; null for unsynced lyrics. */
  t: number | null;
  /** The line as it was when saved. */
  text: string;
  /** `track.lyricsLang` at save time. */
  lang: string | null;
  tr: { lang: string; text: string } | null;
  /** Epoch ms. */
  at: number;
};

export type SaveResult = "saved" | "full" | "blocked";

export type SavedSong = { trackId: string; title: string; artist: string; hasCover: boolean; latest: number; lines: SavedLine[] };

export const SAVED_KEY = "letra.saved.v1";
export const SAVED_HINT_KEY = "letra.saved.hint.v1";
export const SAVED_MAX = 1000;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A date a `Date` can hold (about 275,000 years either side of 1970). */
const isDate = (v: unknown): v is number => isNum(v) && !Number.isNaN(new Date(v).getTime());

const isSavedLine = (v: unknown): v is SavedLine => {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  if (typeof r.trackId !== "string" || typeof r.title !== "string" || typeof r.artist !== "string") return false;
  if (typeof r.hasCover !== "boolean" || typeof r.text !== "string" || !isDate(r.at)) return false;
  if (!Number.isInteger(r.index) || (r.index as number) < 0) return false;
  if (r.t !== null && !isNum(r.t)) return false;
  if (r.lang !== null && typeof r.lang !== "string") return false;
  if (r.tr === null) return true;
  if (typeof r.tr !== "object" || r.tr === undefined) return false;
  const tr = r.tr as Record<string, unknown>;
  return typeof tr.lang === "string" && typeof tr.text === "string";
};

const same = (l: SavedLine, trackId: string, index: number) => l.trackId === trackId && l.index === index;

/** Newest first; equal dates fall back to the track id, then the index, so storage order never shows. */
const byNewest = (a: SavedLine, b: SavedLine) =>
  b.at - a.at || (a.trackId < b.trackId ? -1 : a.trackId > b.trackId ? 1 : 0) || a.index - b.index;

/** The stored lines, one per position; unreadable data reads as empty and a bad record is dropped alone. */
export function readSaved(store: KeyValueStore | null = defaultStore()): SavedLine[] {
  try {
    const raw = store?.getItem(SAVED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: SavedLine[] = [];
    for (const v of parsed) {
      if (isSavedLine(v) && !out.some((l) => same(l, v.trackId, v.index))) out.push(v);
    }
    return out;
  } catch {
    return [];
  }
}

/** Stores the list as it is; false when there is no store or it refuses the write. */
export function writeSaved(list: SavedLine[], store: KeyValueStore | null = defaultStore()): boolean {
  if (!store) return false;
  try {
    store.setItem(SAVED_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** True when the position holds a record with this very text (an edited line no longer counts). */
export function isSaved(list: SavedLine[], trackId: string, index: number, text: string): boolean {
  return list.some((l) => same(l, trackId, index) && l.text === text);
}

function put(line: SavedLine, store: KeyValueStore | null): SaveResult {
  if (!store) return "blocked";
  const list = readSaved(store);
  const isNew = !list.some((l) => same(l, line.trackId, line.index));
  if (isNew && list.length >= SAVED_MAX) return "full";
  const next = [...list.filter((l) => !same(l, line.trackId, line.index)), line];
  return writeSaved(next, store) ? "saved" : "blocked";
}

/** Saves a line at its position, replacing any record already there. */
export function saveLine(
  line: Omit<SavedLine, "at">,
  now: number = Date.now(),
  store: KeyValueStore | null = defaultStore(),
): SaveResult {
  return put({ ...line, at: now }, store);
}

/** Removes the position and returns what was there, or null when nothing was or the write failed. */
export function removeLine(trackId: string, index: number, store: KeyValueStore | null = defaultStore()): SavedLine | null {
  const list = readSaved(store);
  const found = list.find((l) => same(l, trackId, index));
  if (!found) return null;
  return writeSaved(
    list.filter((l) => l !== found),
    store,
  )
    ? found
    : null;
}

/** Puts a removed record back, with its own date, under the same limit as `saveLine`. */
export function restoreLine(line: SavedLine, store: KeyValueStore | null = defaultStore()): SaveResult {
  return put(line, store);
}

/** True for an id the server can have: 1 to 64 ASCII letters, digits, underscores, or hyphens. */
export function isTrackId(id: string): boolean {
  return /^[0-9A-Za-z_-]{1,64}$/.test(id);
}

/**
 * Changes the record of that song and position, if its text is still `text`. Keys absent from
 * `patch` are left as they are. True when the record was found and the write was kept.
 */
export function setLineTranslation(
  trackId: string,
  index: number,
  text: string,
  patch: { tr?: SavedLine["tr"]; lang?: string | null },
  store: KeyValueStore | null = defaultStore(),
): boolean {
  const list = readSaved(store);
  const found = list.find((l) => same(l, trackId, index));
  if (!found || found.text !== text) return false;
  const changes: Partial<SavedLine> = {};
  if ("tr" in patch && patch.tr !== undefined) changes.tr = patch.tr;
  if ("lang" in patch && patch.lang !== undefined) changes.lang = patch.lang;
  return writeSaved(list.map((l) => (l === found ? { ...l, ...changes } : l)), store);
}

/**
 * Copies title, artist and cover from the server's summaries; `gone` names each track the server
 * no longer has, and `changed` says whether any line's details changed (else there is nothing to write).
 */
export function mergeSummaries(list: SavedLine[], summaries: TrackSummary[]): { list: SavedLine[]; gone: string[]; changed: boolean } {
  const byId = new Map(summaries.map((s) => [s.id, s]));
  const gone = new Set<string>();
  let changed = false;
  const merged = list.map((l) => {
    const s = byId.get(l.trackId);
    if (!s) {
      gone.add(l.trackId);
      return l;
    }
    if (l.title === s.title && l.artist === s.artist && l.hasCover === s.hasCover) return l;
    changed = true;
    return { ...l, title: s.title, artist: s.artist, hasCover: s.hasCover };
  });
  return { list: merged, gone: [...gone], changed };
}

/** Songs by their most recent save, newest first; inside a song, lines by index. */
export function groupBySong(list: SavedLine[]): SavedSong[] {
  const songs = new Map<string, SavedSong>();
  for (const l of [...list].sort(byNewest)) {
    const song = songs.get(l.trackId);
    if (song) song.lines.push(l);
    else songs.set(l.trackId, { trackId: l.trackId, title: l.title, artist: l.artist, hasCover: l.hasCover, latest: l.at, lines: [l] });
  }
  const out = [...songs.values()];
  for (const s of out) s.lines.sort((a, b) => a.index - b.index);
  return out;
}

/** The `count` most recently saved lines, newest first. */
export function latest(list: SavedLine[], count: number): SavedLine[] {
  return [...list].sort(byNewest).slice(0, Math.max(0, count));
}

const MONTHS = ["jan.", "fev.", "mar.", "abr.", "mai.", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."];

/** When a line was saved, by local calendar day: today, yesterday, a date this year, or a date with its year. */
export function savedLabel(at: number, now: number, form: "page" | "card"): string {
  const d = new Date(at);
  const n = new Date(now);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const page = form === "page";
  if (day(d) === day(n)) return page ? "Salva hoje" : "Hoje";
  if (day(d) === new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1).getTime()) return page ? "Salva ontem" : "Ontem";
  const date = `${d.getDate()} de ${MONTHS[d.getMonth()]}${d.getFullYear() === n.getFullYear() ? "" : ` de ${d.getFullYear()}`}`;
  return page ? `Salva em ${date}` : date;
}

/** The player link for a line; the time is rounded up to a tenth of a second so the link lands on that line. */
export function lineHref(line: Pick<SavedLine, "trackId" | "t">): string {
  const base = `/t/${encodeURIComponent(line.trackId)}`;
  return line.t === null ? base : `${base}?t=${Math.ceil(line.t / 100) / 10}`;
}

export function linesLabel(lines: number): string {
  return `${lines} ${lines === 1 ? "linha" : "linhas"}`;
}

export function countLabel(lines: number, songs: number): string {
  return `${linesLabel(lines)} em ${songs} ${songs === 1 ? "música" : "músicas"}`;
}
