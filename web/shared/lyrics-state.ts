import type { TrackDTO } from "../../shared/types.ts";

export type LyricsState = "none" | "instrumental" | "unsynced" | "synced";

/** What a track's lyrics amount to; blank-only lines count as none. */
export function lyricsState(track: Pick<TrackDTO, "lyrics">): LyricsState {
  const lyrics = track.lyrics;
  if (lyrics?.instrumental) return "instrumental";
  if (!lyrics || lyrics.lines.every((line) => line.text.trim() === "")) return "none";
  return lyrics.synced ? "synced" : "unsynced";
}
