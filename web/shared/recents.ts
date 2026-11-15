import type { TrackSummary } from "../../shared/types.ts";

/** One song the listener opened by a link, newest first in the stored list. */
export type Recent = { id: string; title: string; artist: string; hasCover: boolean; at: number };

export const RECENTS_KEY = "letra.recents.v1";
export const RECENTS_MAX = 50;

export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** `window.localStorage`, or null when there is no window or touching it throws (blocked storage). */
export function defaultStore(): KeyValueStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const isRecent = (v: unknown): v is Recent => {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.id === "string" && typeof r.title === "string" && typeof r.artist === "string" && typeof r.hasCover === "boolean" && typeof r.at === "number";
};

/** The stored history; anything unreadable or malformed reads as empty. */
export function readRecents(store: KeyValueStore | null = defaultStore()): Recent[] {
  try {
    const raw = store?.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRecent) : [];
  } catch {
    return [];
  }
}

export function saveRecents(list: Recent[], store: KeyValueStore | null = defaultStore()): void {
  try {
    store?.setItem(RECENTS_KEY, JSON.stringify(list));
  } catch {
    // Storage is full or blocked: the history is a convenience, so it just does not persist.
  }
}

export function clearRecents(store: KeyValueStore | null = defaultStore()): void {
  try {
    store?.removeItem(RECENTS_KEY);
  } catch {
    // Same as saveRecents.
  }
}

/** Puts a visit at the front (a repeat moves up and refreshes its details), keeps 50, saves, and returns the new list. */
export function recordVisit(
  track: Pick<Recent, "id" | "title" | "artist" | "hasCover">,
  now: number = Date.now(),
  store: KeyValueStore | null = defaultStore(),
): Recent[] {
  const entry: Recent = { id: track.id, title: track.title, artist: track.artist, hasCover: track.hasCover, at: now };
  const list = [entry, ...readRecents(store).filter((r) => r.id !== track.id)].slice(0, RECENTS_MAX);
  saveRecents(list, store);
  return list;
}

/** Brings the list up to date with the server: keeps order and `at`, drops deleted ids, refreshes the details. */
export function mergeSummaries(list: Recent[], summaries: TrackSummary[]): Recent[] {
  const byId = new Map(summaries.map((s) => [s.id, s]));
  return list.flatMap((r) => {
    const s = byId.get(r.id);
    return s ? [{ ...r, title: s.title, artist: s.artist, hasCover: s.hasCover }] : [];
  });
}
