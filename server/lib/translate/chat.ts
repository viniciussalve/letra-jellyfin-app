import { normalizeLangTag } from "../../../shared/languages.ts";
import { TranslationError, type TranslateInput, type Translator } from "./types.ts";

// Each call holds one of the service's permits, so a hung server must not keep it.
const TIMEOUT_MS = 60_000;
const CHUNK_SIZE = 24;
const DETECT_SAMPLE_LINES = 6;
const NOT_A_LANGUAGE = new Set(["und", "mul", "zxx"]);

const primary = (tag: string) => tag.split("-")[0]!.toLowerCase();

// Names the model is told, which are not the menu's own-language names.
const LANGUAGE_NAMES: Record<string, string> = {
  "pt-BR": "Brazilian Portuguese",
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  zh: "Simplified Chinese",
  ru: "Russian",
  tr: "Turkish",
  pl: "Polish",
  nl: "Dutch",
  hi: "Hindi",
};

/** Splits an answer into trimmed, non-blank lines, without any reasoning block. */
function answerLines(text: string): string[] {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

function translationMessage(i: TranslateInput, lines: string[]): string {
  const name = LANGUAGE_NAMES[i.target.code] ?? i.target.name;
  const artist = i.artist.trim();
  const background = [`Song: "${i.title}"${artist ? ` by ${artist}` : ""}`];
  if (i.context?.before.length) background.push("Lines before, for context only:", ...i.context.before);
  if (i.context?.after.length) background.push("Lines after, for context only:", ...i.context.after);
  return [
    "[Background Information]",
    ...background,
    "",
    `Please translate the following song lyrics into ${name} (${i.target.code}), line by line, taking the provided background information into consideration. Keep the meaning and the tone rather than translating word for word. Keep exactly one output line per input line, in the same order, and output only the translated lines, without any additional explanation.`,
    "",
    "[Source Text]",
    ...lines,
  ].join("\n");
}

function languageQuestion(i: TranslateInput): string {
  const sample = [...(i.context?.before ?? []), ...i.lines, ...(i.context?.after ?? [])]
    .filter((l) => l.trim() !== "")
    .slice(0, DETECT_SAMPLE_LINES);
  return `What language is the following text written in? Answer with its BCP-47 language code only (for example: en, pt-BR, ja), without any additional explanation:\n\n${sample.join("\n")}`;
}

/**
 * A short name for a failed request, such as " (ECONNREFUSED)". Never the error's message:
 * fetch quotes its input there, which can hold the key or a password in the URL.
 */
function failureCode(err: unknown): string {
  const code = (err as { cause?: { code?: unknown } } | null)?.cause?.code;
  if (typeof code === "string" && /^[A-Z0-9_]+$/.test(code)) return ` (${code})`;
  const name = (err as { name?: unknown } | null)?.name;
  if (typeof name === "string" && /^[A-Za-z]+$/.test(name)) return ` (${name})`;
  return "";
}

/** A translator for any endpoint that implements OpenAI's chat completions. */
export function createChatTranslator(o: {
  url: string;
  apiKey: string | null;
  model: string;
  detectLanguage: boolean;
  fetch: typeof fetch;
  timeoutMs?: number;
}): Translator {
  const endpoint = `${o.url.replace(/\/+$/, "")}/chat/completions`;
  const timeoutMs = o.timeoutMs ?? TIMEOUT_MS;

  async function ask(content: string): Promise<string> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (o.apiKey) headers.authorization = `Bearer ${o.apiKey}`;
    let data: { choices?: Array<{ message?: { content?: unknown } }> };
    try {
      // The signal also bounds reading the body; an abort or timeout lands in the catch below.
      const res = await o.fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: o.model, messages: [{ role: "user", content }], temperature: 0, stream: false }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new TranslationError("engine", `The chat endpoint returned ${res.status}`);
      const body = await res.text();
      try {
        data = JSON.parse(body) as typeof data;
      } catch {
        throw new TranslationError("engine", "The chat endpoint returned a body that is not JSON");
      }
    } catch (err) {
      if (err instanceof TranslationError) throw err;
      const name = (err as Error).name;
      if (name === "TimeoutError" || name === "AbortError") {
        throw new TranslationError("engine", `The chat endpoint did not answer within ${timeoutMs} ms`);
      }
      throw new TranslationError("engine", `The chat request failed${failureCode(err)}`);
    }
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new TranslationError("engine", "The chat endpoint returned no text");
    return text;
  }

  /** One input line must give one output line: several are joined, none is a failure. */
  function joinedLine(out: string[]): string {
    if (out.length === 0) throw new TranslationError("engine", "The chat endpoint returned an empty translation");
    return out.join(" ");
  }

  async function detect(i: TranslateInput): Promise<string | null> {
    const answer = answerLines(await ask(languageQuestion(i))).join(" ");
    const bare = answer.replace(/\.$/, "").replace(/^["'`]+|["'`]+$/g, "");
    const tag = normalizeLangTag(bare);
    // Undetermined, several, or no linguistic content: valid tags, but not a language.
    return tag !== null && NOT_A_LANGUAGE.has(primary(tag)) ? null : tag;
  }

  return {
    name: "chat",
    async translate(i) {
      const known = normalizeLangTag(i.sourceLang);
      const sourceLang = o.detectLanguage && known === null ? await detect(i) : known;
      // The service throws the lines away when the lyrics are already in the target language.
      if (sourceLang !== null && primary(sourceLang) === primary(i.target.code)) return { sourceLang, lines: i.lines };
      const lines: string[] = [];
      for (let at = 0; at < i.lines.length; at += CHUNK_SIZE) {
        const chunk = i.lines.slice(at, at + CHUNK_SIZE);
        const out = answerLines(await ask(translationMessage(i, chunk)));
        if (chunk.length === 1) {
          lines.push(joinedLine(out));
        } else if (out.length === chunk.length) {
          lines.push(...out);
        } else {
          // The model merged or split lines: redo the chunk one line per request.
          for (const line of chunk) lines.push(joinedLine(answerLines(await ask(translationMessage(i, [line])))));
        }
      }
      return { sourceLang, lines };
    },
  };
}
