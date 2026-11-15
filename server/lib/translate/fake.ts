import type { Translator } from "./types.ts";

export const fakeTranslator: Translator = {
  name: "fake",
  async translate({ lines, target }) {
    const primary = target.code.split("-")[0]!.toLowerCase();
    const sourceLang = primary === "en" ? "pt" : "en";
    return { sourceLang, lines: lines.map((l) => `[${target.code}] ${l}`) };
  },
};
