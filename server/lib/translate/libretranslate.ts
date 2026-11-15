import { TranslationError, type Translator } from "./types.ts";

type Detected = { language?: string };

// Each call holds one of the service's two permits, so a hung server must not keep it.
const TIMEOUT_MS = 60_000;

export function createLibreTranslator(o: { url: string; apiKey: string | null; fetch: typeof fetch; timeoutMs?: number }): Translator {
  const base = o.url.replace(/\/+$/, "");
  const timeoutMs = o.timeoutMs ?? TIMEOUT_MS;
  let zhCode: Promise<string> | null = null;

  const chineseCode = (): Promise<string> => {
    zhCode ??= (async () => {
      try {
        const res = await o.fetch(`${base}/languages`, { signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) return "zh";
        const list = (await res.json()) as Array<{ code?: string }>;
        return list.some((l) => l.code === "zh-Hans") ? "zh-Hans" : "zh";
      } catch {
        return "zh";
      }
    })();
    return zhCode;
  };

  const mapTarget = async (code: string) => (code === "pt-BR" ? "pt" : code === "zh" ? chineseCode() : code);

  return {
    name: "libretranslate",
    async translate({ lines, target }) {
      const body: Record<string, unknown> = { q: lines, source: "auto", target: await mapTarget(target.code), format: "text" };
      if (o.apiKey) body.api_key = o.apiKey;
      let data: { translatedText?: unknown; detectedLanguage?: Detected | Detected[] };
      try {
        // The signal also bounds reading the body; an abort or timeout lands in the catch below.
        const res = await o.fetch(`${base}/translate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) throw new TranslationError("engine", `LibreTranslate returned ${res.status}`);
        data = (await res.json()) as typeof data;
      } catch (err) {
        if (err instanceof TranslationError) throw err;
        const name = (err as Error).name;
        if (name === "TimeoutError" || name === "AbortError") {
          throw new TranslationError("engine", `LibreTranslate did not answer within ${timeoutMs} ms`);
        }
        throw new TranslationError("engine", `LibreTranslate request failed: ${(err as Error).message}`);
      }
      const out = data.translatedText;
      if (!Array.isArray(out) || !out.every((l) => typeof l === "string")) {
        throw new TranslationError("engine", "LibreTranslate returned malformed lines");
      }
      const det = Array.isArray(data.detectedLanguage) ? data.detectedLanguage[0] : data.detectedLanguage;
      return { sourceLang: det?.language || null, lines: out as string[] };
    },
  };
}
