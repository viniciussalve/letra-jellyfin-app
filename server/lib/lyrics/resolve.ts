import type { Lyrics, LyricsSource } from "../../../shared/types.ts";
import { pickBest, type LrclibClient, type LrclibRecord } from "./lrclib.ts";
import { parseLrc } from "./lrc.ts";
import { parsePlain } from "./plain.ts";

export type LyricsResolveMeta = {
  title: string;
  artist: string;
  album: string | null;
  durationMs: number;
  embedded?: { synced: Lyrics | null; plain: Lyrics | null };
};

type Resolved = { lyrics: Lyrics | null; source: LyricsSource };

const INSTRUMENTAL: Resolved = {
  lyrics: { synced: false, lines: [], instrumental: true },
  source: "lrclib",
};

function syncedOf(r: LrclibRecord | null): Lyrics | null {
  if (!r?.syncedLyrics?.trim()) return null;
  const l = parseLrc(r.syncedLyrics);
  return l.lines.length > 0 ? l : null;
}

function plainOf(r: LrclibRecord | null): Lyrics | null {
  if (!r?.plainLyrics?.trim()) return null;
  const l = parsePlain(r.plainLyrics);
  return l.lines.length > 0 ? l : null;
}

export async function resolveLyrics(
  meta: LyricsResolveMeta,
  lrclib: LrclibClient,
): Promise<Resolved> {
  if (meta.embedded?.synced) return { lyrics: meta.embedded.synced, source: "embedded" };

  const durationSec = Math.round(meta.durationMs / 1000);
  const got = await lrclib.get({ artist: meta.artist, title: meta.title, album: meta.album, durationSec });
  const gotSynced = syncedOf(got);
  if (gotSynced) return { lyrics: gotSynced, source: "lrclib" };

  const found = pickBest(await lrclib.search({ artist: meta.artist, title: meta.title }), durationSec);
  const foundSynced = syncedOf(found);
  if (foundSynced) return { lyrics: foundSynced, source: "lrclib" };

  if (meta.embedded?.plain) return { lyrics: meta.embedded.plain, source: "embedded" };

  if (got?.instrumental || found?.instrumental) return INSTRUMENTAL;

  const plain = plainOf(got) ?? plainOf(found);
  if (plain) return { lyrics: plain, source: "lrclib" };
  return { lyrics: null, source: "none" };
}

