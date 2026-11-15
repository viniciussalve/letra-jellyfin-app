import { afterEach, describe, expect, test, vi } from "vitest";
import { LANGUAGES } from "../../shared/languages.ts";
import { defaultLanguage, loadPrefs, savePrefs } from "../../web/player/translation.ts";

test("first supported navigator language, else pt-BR", () => {
  expect(defaultLanguage(["de-AT", "en"], LANGUAGES)).toBe("de"); // de-AT matches de by primary subtag
  expect(defaultLanguage(["sv", "en-GB"], LANGUAGES)).toBe("en");
  expect(defaultLanguage(["pt-BR"], LANGUAGES)).toBe("pt-BR");
  expect(defaultLanguage(["pt-PT"], LANGUAGES)).toBe("pt-BR");
  expect(defaultLanguage(["xx"], LANGUAGES)).toBe("pt-BR");
  expect(defaultLanguage([], LANGUAGES)).toBe("pt-BR");
});

describe("prefs", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("round-trip through localStorage under letra:translation", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    expect(loadPrefs()).toBeNull();
    savePrefs({ on: true, lang: "es" });
    expect(JSON.parse(store.get("letra:translation")!)).toEqual({ on: true, lang: "es" });
    expect(loadPrefs()).toEqual({ on: true, lang: "es" });
    store.set("letra:translation", "{not json");
    expect(loadPrefs()).toBeNull();
  });

  test("a throwing localStorage is tolerated", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(loadPrefs()).toBeNull();
    expect(() => savePrefs({ on: true, lang: "en" })).not.toThrow();
  });
});
