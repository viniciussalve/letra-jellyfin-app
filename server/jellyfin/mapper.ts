import { MIME_BY_EXT } from "../../shared/formats.ts";
import type { Lyrics, LyricsSource, Track, TrackDTO, TrackSummary } from "../../shared/types.ts";
import { deterministicPalette } from "../lib/palette.ts";
import type { JellyfinAudioItem, ParsedLyrics } from "./types.ts";

export function toTrack(
  item: JellyfinAudioItem,
  lyrics: ParsedLyrics,
  opts: { lyricsSource?: LyricsSource; lyricsLang?: string | null } = {},
): Track {
  const ext = (item.container ?? "mp3").toLowerCase();
  const mime = MIME_BY_EXT[ext] ?? "audio/mpeg";
  const lyricsSource: LyricsSource = opts.lyricsSource ?? (lyrics ? "embedded" : "none");

  return {
    id: item.id,
    title: item.title,
    artist: item.artist,
    album: item.album,
    durationMs: item.durationMs,
    mime,
    ext,
    sizeBytes: item.sizeBytes,
    hasCover: item.hasCover,
    palette: deterministicPalette(item.id),
    lyrics,
    lyricsSource,
    lyricsLang: opts.lyricsLang ?? null,
    createdAt: item.createdAt,
  };
}

export function toTrackDTO(track: Track, publicUrl: string): TrackDTO {
  return {
    ...track,
    shareUrl: `${publicUrl.replace(/\/+$/, "")}/t/${encodeURIComponent(track.id)}`,
  };
}

export function toTrackSummary(item: JellyfinAudioItem): TrackSummary {
  return {
    id: item.id,
    title: item.title,
    artist: item.artist,
    hasCover: item.hasCover,
    palette: deterministicPalette(item.id),
    durationMs: item.durationMs,
  };
}

function formatLrcTimestamp(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const minutes = Math.floor(clamped / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1000);
  const centis = Math.floor((clamped % 1000) / 10);
  return `[${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centis).padStart(2, "0")}]`;
}

export function lyricsToLrc(lyrics: Lyrics): string {
  if (!lyrics.synced) {
    return lyrics.lines.map((l) => l.text).join("\n");
  }
  return lyrics.lines
    .map((l) => (l.t !== null ? `${formatLrcTimestamp(l.t)}${l.text}` : l.text))
    .join("\n");
}
