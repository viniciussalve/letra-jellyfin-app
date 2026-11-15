import type { Language } from "../../../shared/types.ts";

export type TranslateInput = {
  title: string;
  artist: string;
  lines: string[];
  target: Language;
  /** Lines around `lines` in the song, for meaning only. Never translated, never returned. */
  context?: { before: string[]; after: string[] };
  /** The lyrics' language when the caller knows it (a BCP-47 tag). An engine may skip working it out. */
  sourceLang?: string | null;
};

export type Translator = {
  name: "claude" | "chat" | "libretranslate" | "fake";
  translate(i: TranslateInput): Promise<{ sourceLang: string | null; lines: string[] }>;
};

export class TranslationError extends Error {
  readonly kind: "line_count" | "refusal" | "engine";
  constructor(kind: TranslationError["kind"], msg: string) {
    super(msg);
    this.kind = kind;
  }
}
