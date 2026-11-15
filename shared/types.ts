export type Line = { t: number | null; text: string }; // t in ms
export type Lyrics = { synced: boolean; lines: Line[]; instrumental: boolean };
export type LyricsSource = "embedded" | "lrclib" | "manual" | "none";
export type Palette = { mesh: [string, string, string, string]; scrim: number };
export type Track = {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number;
  mime: string;
  ext: string;
  sizeBytes: number;
  hasCover: boolean;
  palette: Palette;
  lyrics: Lyrics | null;
  lyricsSource: LyricsSource;
  lyricsLang: string | null;
  createdAt: string;
};
/** What the listener home needs to draw a row: no lyrics, no file details. */
export type TrackSummary = { id: string; title: string; artist: string; hasCover: boolean; palette: Palette; durationMs: number };
export type TrackDTO = Track & { shareUrl: string };
export type Language = { code: string; name: string };
export type TranslationDTO = {
  lang: string;
  sourceLang: string | null;
  sameLanguage: boolean;
  lines: string[];
};
export type SummaryResponse = { tracks: TrackSummary[]; translationEnabled: boolean };
export type LineTranslationDTO = { lang: string; sourceLang: string | null; sameLanguage: boolean; text: string };
export type PlayerData = { track: TrackDTO; translationEnabled: boolean; languages: Language[] } | null;
export type ApiError = { error: { code: string; message: string } };
