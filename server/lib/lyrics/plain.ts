import type { Lyrics } from "../../../shared/types.ts";
import { trimBreaks } from "./trim.ts";

export function parsePlain(text: string): Lyrics {
  const lines = text.split(/\r?\n/).map((l) => ({ t: null, text: l.trim() }));
  return { synced: false, lines: trimBreaks(lines), instrumental: false };
}
