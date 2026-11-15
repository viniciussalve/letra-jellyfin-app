import type { Config } from "../../config.ts";
import { createChatTranslator } from "./chat.ts";
import { createClaudeTranslator } from "./claude.ts";
import { fakeTranslator } from "./fake.ts";
import { createLibreTranslator } from "./libretranslate.ts";
import type { Translator } from "./types.ts";

export function createEngines(config: Config, fetch: typeof globalThis.fetch): Translator[] {
  const claude = (): Translator => {
    if (!config.anthropicApiKey) throw new Error("TRANSLATOR=claude requires ANTHROPIC_API_KEY");
    return createClaudeTranslator({ apiKey: config.anthropicApiKey, model: config.anthropicModel });
  };
  const chat = (url: string, model: string): Translator =>
    createChatTranslator({
      url,
      apiKey: config.translateApiKey,
      model,
      detectLanguage: config.translateDetectLanguage,
      fetch,
    });
  const libre = (): Translator => {
    if (!config.libretranslateUrl) throw new Error("TRANSLATOR=libretranslate requires LIBRETRANSLATE_URL");
    return createLibreTranslator({ url: config.libretranslateUrl, apiKey: config.libretranslateApiKey, fetch });
  };
  switch (config.translator) {
    case "fake":
      return [fakeTranslator];
    case "off":
      return [];
    case "claude":
      return [claude()];
    case "chat":
      if (!config.translateApiUrl || !config.translateModel) {
        throw new Error("TRANSLATOR=chat requires TRANSLATE_API_URL and TRANSLATE_MODEL");
      }
      return [chat(config.translateApiUrl, config.translateModel)];
    case "libretranslate":
      return [libre()];
    case "auto": {
      const engines: Translator[] = [];
      if (config.anthropicApiKey) engines.push(claude());
      if (config.translateApiUrl && config.translateModel) {
        engines.push(chat(config.translateApiUrl, config.translateModel));
      } else if (config.translateApiUrl || config.translateModel || config.translateApiKey) {
        console.warn("TRANSLATE_API_URL and TRANSLATE_MODEL must both be set; the chat engine is off");
      }
      if (config.libretranslateUrl) engines.push(libre());
      return engines;
    }
  }
}
