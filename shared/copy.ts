// User-facing copy shared by the server and the browser.
/** The artist when tags have none and the file name has no " - ". */
export const UNKNOWN_ARTIST = "Artista desconhecido";

export const NOT_AUDIO = "Esse arquivo não é um áudio que dá para tocar. Envie MP3, M4A, FLAC, OGG ou WAV.";

const MB = 1048576;

export function tooLarge(bytes: number, limitBytes: number): string {
  const limit = limitBytes / MB;
  const size = Math.max(limit + 1, Math.round(bytes / MB));
  return `O arquivo tem ${size} MB. O limite é ${limit} MB.`;
}
