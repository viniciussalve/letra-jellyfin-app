export const ALLOWED_EXTS = ["mp3", "m4a", "flac", "ogg", "wav"] as const;

export const MIME_BY_EXT: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  flac: "audio/flac",
  ogg: "audio/ogg",
  wav: "audio/wav",
};
