import type { Translator } from "./types.ts";

export const fakeTranslator: Translator = {
  name: "fake",
  async translate({ lines, target }) {
    return { sourceLang: "en", lines: lines.map((l) => `[${target.code}] ${l}`) };
  },
};
