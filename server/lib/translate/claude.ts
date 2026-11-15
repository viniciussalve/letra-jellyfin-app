import Anthropic from "@anthropic-ai/sdk";
import { TranslationError, type Translator } from "./types.ts";

const SCHEMA = {
  type: "object",
  properties: { source_lang: { type: "string" }, lines: { type: "array", items: { type: "string" } } },
  required: ["source_lang", "lines"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = [
  "You translate song lyrics for a listener who speaks the target language.",
  "Keep meaning, tone and imagery rather than translating word for word.",
  "Return exactly one output line per input line, in the same order.",
  "Leave bracketed cues such as (instrumental) untranslated.",
  "Report source_lang as the BCP-47 code of the original lyrics.",
  'When "context" is given, it holds the lines around "lines" in the song: use it for meaning only, and translate and return only "lines".',
].join("\n");

// Each call holds one of the service's two permits: bound it well under the SDK's
// default (10 minutes, two retries) so a hung request cannot queue every listener.
const TIMEOUT_MS = 60_000;
const MAX_RETRIES = 1;

export function createClaudeTranslator(o: { apiKey: string; model: string; client?: Pick<Anthropic, "beta"> }): Translator {
  const client = o.client ?? new Anthropic({ apiKey: o.apiKey, timeout: TIMEOUT_MS, maxRetries: MAX_RETRIES });
  return {
    name: "claude",
    async translate({ title, artist, lines, target, context }) {
      let res;
      try {
        res = await client.beta.messages.create({
          model: o.model,
          max_tokens: 16000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: JSON.stringify({
                title,
                artist,
                target_language: `${target.name} (${target.code})`,
                lines,
                ...(context ? { context: { before: context.before, after: context.after } } : {}),
              }),
            },
          ],
        });
      } catch (err) {
        throw new TranslationError("engine", `Claude request failed: ${(err as Error).message}`);
      }
      if (res.stop_reason === "refusal") throw new TranslationError("refusal", "Claude refused the request");
      // With server-side fallback, content before the last fallback block came from the model that declined.
      const blocks = res.content as Array<{ type: string; text?: string }>;
      const afterFallback = blocks.slice(blocks.map((b) => b.type).lastIndexOf("fallback") + 1);
      const block = afterFallback.find((b) => b.type === "text");
      if (!block || typeof block.text !== "string") throw new TranslationError("engine", "Claude returned no text");
      let parsed: { source_lang?: unknown; lines?: unknown };
      try {
        parsed = JSON.parse(block.text);
      } catch {
        throw new TranslationError("engine", "Claude returned invalid JSON");
      }
      if (!Array.isArray(parsed.lines) || !parsed.lines.every((l) => typeof l === "string")) {
        throw new TranslationError("engine", "Claude returned malformed lines");
      }
      const src = typeof parsed.source_lang === "string" && parsed.source_lang.trim() !== "" ? parsed.source_lang : null;
      return { sourceLang: src, lines: parsed.lines as string[] };
    },
  };
}
