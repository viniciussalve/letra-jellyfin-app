import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type CachedTranslation = {
  trackId: string;
  lang: string;
  fingerprint?: string;
  engine: string;
  sourceLang: string | null;
  sameLanguage: boolean;
  lines: string[];
  createdAt: string;
};

export type CachedLineTranslation = {
  trackId: string;
  lang: string;
  lineHash: string;
  text: string;
  engine: string;
  sourceLang: string | null;
  sameLanguage: boolean;
  createdAt: string;
};

export type TranslationCache = {
  getTrackTranslation(trackId: string, lang: string): CachedTranslation | null;
  saveTrackTranslation(entry: CachedTranslation): void;
  getLineTranslation(trackId: string, lang: string, lineHash: string): CachedLineTranslation | null;
  saveLineTranslation(entry: CachedLineTranslation): void;
  clearTrackTranslations(trackId: string): void;
};

type SerializedCache = {
  tracks?: Record<string, CachedTranslation>;
  lines?: Record<string, CachedLineTranslation>;
};

const MAX_TRACK_ENTRIES = 5_000;
const MAX_LINE_ENTRIES = 20_000;

const trackKey = (trackId: string, lang: string) => `${trackId}\0${lang}`;
const lineKey = (trackId: string, lang: string, lineHash: string) => `${trackId}\0${lang}\0${lineHash}`;

export function createTranslationCache(filePath: string | null): TranslationCache {
  const tracks = new Map<string, CachedTranslation>();
  const lines = new Map<string, CachedLineTranslation>();

  if (filePath !== null && existsSync(filePath)) {
    try {
      const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
      if (raw !== null && typeof raw === "object") {
        const data = raw as SerializedCache;
        if (data.tracks && typeof data.tracks === "object") {
          for (const [k, v] of Object.entries(data.tracks)) {
            if (v && typeof v === "object" && typeof v.trackId === "string" && typeof v.lang === "string") {
              tracks.set(k, v);
            }
          }
        }
        if (data.lines && typeof data.lines === "object") {
          for (const [k, v] of Object.entries(data.lines)) {
            if (
              v &&
              typeof v === "object" &&
              typeof v.trackId === "string" &&
              typeof v.lang === "string" &&
              typeof v.lineHash === "string"
            ) {
              lines.set(k, v);
            }
          }
        }
      }
    } catch {
      // Corrupt or unreadable cache file: start fresh in memory.
    }
  }

  function persist(): void {
    if (filePath === null) return;
    mkdirSync(dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    const payload: SerializedCache = {
      tracks: Object.fromEntries(tracks),
      lines: Object.fromEntries(lines),
    };
    writeFileSync(tmp, JSON.stringify(payload), "utf8");
    renameSync(tmp, filePath);
  }

  return {
    getTrackTranslation(trackId, lang) {
      return tracks.get(trackKey(trackId, lang)) ?? null;
    },
    saveTrackTranslation(entry) {
      const key = trackKey(entry.trackId, entry.lang);
      tracks.delete(key);
      tracks.set(key, entry);
      if (tracks.size > MAX_TRACK_ENTRIES) {
        const oldest = tracks.keys().next().value;
        if (oldest !== undefined) tracks.delete(oldest);
      }
      persist();
    },
    getLineTranslation(trackId, lang, lineHash) {
      return lines.get(lineKey(trackId, lang, lineHash)) ?? null;
    },
    saveLineTranslation(entry) {
      const key = lineKey(entry.trackId, entry.lang, entry.lineHash);
      lines.delete(key);
      lines.set(key, entry);
      if (lines.size > MAX_LINE_ENTRIES) {
        const oldest = lines.keys().next().value;
        if (oldest !== undefined) lines.delete(oldest);
      }
      persist();
    },
    clearTrackTranslations(trackId) {
      let changed = false;
      for (const [k, v] of tracks) {
        if (v.trackId === trackId) {
          tracks.delete(k);
          changed = true;
        }
      }
      for (const [k, v] of lines) {
        if (v.trackId === trackId) {
          lines.delete(k);
          changed = true;
        }
      }
      if (changed) persist();
    },
  };
}
