import type { Language } from "./types.ts";

/** The fixed list of translation targets, each named in its own language. */
export const LANGUAGES: Language[] = [
  { code: "pt-BR", name: "Português" },
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "it", name: "Italiano" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
  { code: "zh", name: "中文" },
  { code: "ru", name: "Русский" },
  { code: "tr", name: "Türkçe" },
  { code: "pl", name: "Polski" },
  { code: "nl", name: "Nederlands" },
  { code: "hi", name: "हिन्दी" },
];

const LANG_TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/i;

/**
 * A BCP-47-shaped language tag with its primary subtag in lowercase ("PT-BR" -> "pt-BR"),
 * or null for anything else: engines may answer free text such as "Portuguese", which
 * must not reach a `lang` attribute or the same-language check.
 */
export function normalizeLangTag(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const tag = raw.trim();
  if (!LANG_TAG.test(tag)) return null;
  const dash = tag.indexOf("-");
  return dash < 0 ? tag.toLowerCase() : tag.slice(0, dash).toLowerCase() + tag.slice(dash);
}
