import type { Lyrics } from "../../../shared/types.ts";
import { isLrc, parseLrc } from "./lrc.ts";
import { parsePlain } from "./plain.ts";

/** LRC when at least 1 line starts with a time tag, otherwise plain; null when blank. */
export function parseLyricsText(text: string): Lyrics | null {
  if (text.trim() === "") return null;
  return isLrc(text, 1) ? parseLrc(text) : parsePlain(text);
}
