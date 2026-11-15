import { expect, test, vi } from "vitest";
import { loadConfig } from "../../server/config.ts";
import { createClaudeTranslator } from "../../server/lib/translate/claude.ts";
import { createEngines } from "../../server/lib/translate/engines.ts";
import { fakeTranslator } from "../../server/lib/translate/fake.ts";
import { createLibreTranslator } from "../../server/lib/translate/libretranslate.ts";
import { TranslationError } from "../../server/lib/translate/types.ts";
import { LANGUAGES } from "../../shared/languages.ts";

// The SDK client is replaced so the options createClaudeTranslator builds it with can be read.
const anthropicOptions = vi.hoisted(() => [] as unknown[]);
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    constructor(options: unknown) {
      anthropicOptions.push(options);
    }
  },
}));

const target = (code: string) => LANGUAGES.find((l) => l.code === code)!;
const input = (code: string) => ({ title: "Canção", artist: "Ana", lines: ["Olá", "Mundo"], target: target(code) });

function fakeClient(response: unknown) {
  const calls: any[] = [];
  const client = { beta: { messages: { create: async (p: unknown) => (calls.push(p), response) } } } as any;
  return { client, calls };
}

test("claude request shape", async () => {
  const { client, calls } = fakeClient({
    stop_reason: "end_turn",
    content: [{ type: "text", text: JSON.stringify({ source_lang: "pt-BR", lines: ["Hello", "World"] }) }],
  });
  const t = createClaudeTranslator({ apiKey: "k", model: "claude-opus-5-5", client });
  expect(await t.translate(input("en"))).toEqual({ sourceLang: "pt-BR", lines: ["Hello", "World"] });
  const p = calls[0];
  expect(p.model).toBe("claude-opus-5-5");
  expect(p.max_tokens).toBe(16000);
  expect(p.betas).toEqual(["server-side-fallback-2026-07-01"]);
  expect(p.fallbacks).toBe("default");
  expect(p.output_config.effort).toBe("medium");
  expect(p.output_config.format.type).toBe("json_schema");
  expect(p.output_config.format.schema.required).toEqual(["source_lang", "lines"]);
  expect(JSON.parse(p.messages[0].content)).toEqual({
    title: "Canção",
    artist: "Ana",
    target_language: "English (en)",
    lines: ["Olá", "Mundo"],
  });
  expect(JSON.parse(p.messages[0].content)).not.toHaveProperty("context");
});

test("claude passes the context and asks to translate only lines", async () => {
  const { client, calls } = fakeClient({
    stop_reason: "end_turn",
    content: [{ type: "text", text: JSON.stringify({ source_lang: "pt-BR", lines: ["Hello"] }) }],
  });
  const t = createClaudeTranslator({ apiKey: "k", model: "m", client });
  const context = { before: ["a"], after: ["b"] };
  await t.translate({ ...input("en"), lines: ["Olá"], context, sourceLang: "pt-BR" });
  expect(JSON.parse(calls[0].messages[0].content).context).toEqual(context);
  expect(calls[0].system).toContain('translate and return only "lines"');
});

test("claude refusal -> TranslationError refusal", async () => {
  const { client } = fakeClient({ stop_reason: "refusal", content: [] });
  const t = createClaudeTranslator({ apiKey: "k", model: "m", client });
  await expect(t.translate(input("en"))).rejects.toMatchObject({ kind: "refusal" });
});

test("claude API failure and bad JSON -> engine error", async () => {
  const boom = { beta: { messages: { create: async () => { throw new Error("x"); } } } } as any;
  await expect(createClaudeTranslator({ apiKey: "k", model: "m", client: boom }).translate(input("en"))).rejects.toMatchObject({ kind: "engine" });
  const { client } = fakeClient({ stop_reason: "end_turn", content: [{ type: "text", text: "nope" }] });
  await expect(createClaudeTranslator({ apiKey: "k", model: "m", client }).translate(input("en"))).rejects.toBeInstanceOf(TranslationError);
});

function libre(handler: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; body: any }[] = [];
  const f = (async (u: string | URL | Request, init?: RequestInit) => {
    const url = String(u);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    return handler(url, init);
  }) as typeof fetch;
  return { f, calls };
}
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });

test("libretranslate maps pt-BR->pt and reads detectedLanguage object or array", async () => {
  const obj = libre(() => json({ translatedText: ["a", "b"], detectedLanguage: { language: "en", confidence: 90 } }));
  const t1 = createLibreTranslator({ url: "http://lt", apiKey: "secret", fetch: obj.f });
  expect(await t1.translate(input("pt-BR"))).toEqual({ sourceLang: "en", lines: ["a", "b"] });
  expect(obj.calls[0]).toEqual({
    url: "http://lt/translate",
    body: { q: ["Olá", "Mundo"], source: "auto", target: "pt", format: "text", api_key: "secret" },
  });
  const arr = libre(() => json({ translatedText: ["a", "b"], detectedLanguage: [{ language: "fr", confidence: 80 }] }));
  expect((await createLibreTranslator({ url: "http://lt", apiKey: null, fetch: arr.f }).translate(input("de"))).sourceLang).toBe("fr");
  expect("api_key" in arr.calls[0]!.body).toBe(false);
});

test("libretranslate uses zh-Hans when listed, once", async () => {
  const l = libre((url) => (url.endsWith("/languages") ? json([{ code: "zh-Hans" }]) : json({ translatedText: ["a", "b"] })));
  const t = createLibreTranslator({ url: "http://lt/", apiKey: null, fetch: l.f });
  const r = await t.translate(input("zh"));
  await t.translate(input("zh"));
  expect(r.sourceLang).toBeNull();
  expect(l.calls.filter((c) => c.url.endsWith("/languages"))).toHaveLength(1);
  expect(l.calls.filter((c) => c.url.endsWith("/translate"))[0]!.body.target).toBe("zh-Hans");
  const none = libre((url) => (url.endsWith("/languages") ? json([{ code: "zh" }]) : json({ translatedText: ["a", "b"] })));
  await createLibreTranslator({ url: "http://lt", apiKey: null, fetch: none.f }).translate(input("zh"));
  expect(none.calls.at(-1)!.body.target).toBe("zh");
});

test("libretranslate non-ok -> engine error", async () => {
  const l = libre(() => new Response("no", { status: 500 }));
  await expect(createLibreTranslator({ url: "http://lt", apiKey: null, fetch: l.f }).translate(input("en"))).rejects.toMatchObject({ kind: "engine" });
});

test("fake translator", async () => {
  expect(await fakeTranslator.translate(input("pt-BR"))).toEqual({ sourceLang: "en", lines: ["[pt-BR] Olá", "[pt-BR] Mundo"] });
});

test("createEngines chains by mode", () => {
  const env = { JELLYFIN_URL: "https://jf.example.com" };
  const names = (e: Record<string, string>) => createEngines(loadConfig({ ...env, ...e }), fetch).map((x) => x.name);
  expect(names({ TRANSLATOR: "fake" })).toEqual(["fake"]);
  expect(names({ TRANSLATOR: "off" })).toEqual([]);
  expect(names({})).toEqual([]);
  expect(names({ ANTHROPIC_API_KEY: "k", LIBRETRANSLATE_URL: "http://lt" })).toEqual(["claude", "libretranslate"]);
  expect(names({ LIBRETRANSLATE_URL: "http://lt" })).toEqual(["libretranslate"]);
  expect(() => names({ TRANSLATOR: "claude" })).toThrow();
  expect(() => names({ TRANSLATOR: "libretranslate" })).toThrow();
});

test("claude parses the first text block after the last fallback block", async () => {
  const { client } = fakeClient({
    stop_reason: "end_turn",
    content: [
      { type: "text", text: "partial {" },
      { type: "fallback" },
      { type: "text", text: JSON.stringify({ source_lang: "pt", lines: ["a", "b"] }) },
    ],
  });
  expect(await createClaudeTranslator({ apiKey: "k", model: "m", client }).translate(input("en"))).toEqual({ sourceLang: "pt", lines: ["a", "b"] });
});

test("claude client: 60 s timeout and one retry", () => {
  createClaudeTranslator({ apiKey: "k", model: "m" });
  expect(anthropicOptions.at(-1)).toEqual({ apiKey: "k", timeout: 60_000, maxRetries: 1 });
});

test("libretranslate: a hung server times out into an engine error", async () => {
  // Never answers, but honours the abort signal the way fetch does.
  const signals: (AbortSignal | undefined)[] = [];
  const hung = ((_u: string | URL | Request, init?: RequestInit) => {
    signals.push(init?.signal ?? undefined);
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
    });
  }) as typeof fetch;
  const t = createLibreTranslator({ url: "http://lt", apiKey: null, fetch: hung, timeoutMs: 20 });
  // zh first asks /languages (which falls back to "zh" on failure), then /translate.
  await expect(t.translate(input("zh"))).rejects.toMatchObject({ kind: "engine", message: "LibreTranslate did not answer within 20 ms" });
  expect(signals).toHaveLength(2);
  expect(signals.every((s) => s instanceof AbortSignal)).toBe(true);
});

test("chat mode needs its URL and its model", () => {
  const make = (e: Record<string, string>) => createEngines(loadConfig({ JELLYFIN_URL: "https://jf.example.com", TRANSLATOR: "chat", ...e }), fetch);
  const msg = "TRANSLATOR=chat requires TRANSLATE_API_URL and TRANSLATE_MODEL";
  expect(() => make({})).toThrow(msg);
  expect(() => make({ TRANSLATE_API_URL: "https://x.test/v1" })).toThrow(msg);
  expect(() => make({ TRANSLATE_MODEL: "m" })).toThrow(msg);
  expect(make({ TRANSLATE_API_URL: "https://x.test/v1", TRANSLATE_MODEL: "m" }).map((x) => x.name)).toEqual(["chat"]);
});

test("auto order is claude, chat, libretranslate", () => {
  const config = loadConfig({
    JELLYFIN_URL: "https://jf.example.com",
    ANTHROPIC_API_KEY: "k",
    TRANSLATE_API_URL: "https://x.test/v1",
    TRANSLATE_MODEL: "m",
    LIBRETRANSLATE_URL: "http://lt",
  });
  expect(createEngines(config, fetch).map((x) => x.name)).toEqual(["claude", "chat", "libretranslate"]);
});

test("auto skips a half set up chat engine and warns once", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    for (const e of [{ TRANSLATE_API_URL: "https://x.test/v1" }, { TRANSLATE_MODEL: "m" }]) {
      warn.mockClear();
      const config = loadConfig({ JELLYFIN_URL: "https://jf.example.com", LIBRETRANSLATE_URL: "http://lt", ...e });
      expect(createEngines(config, fetch).map((x) => x.name)).toEqual(["libretranslate"]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith("TRANSLATE_API_URL and TRANSLATE_MODEL must both be set; the chat engine is off");
    }
    warn.mockClear();
    createEngines(loadConfig({ JELLYFIN_URL: "https://jf.example.com" }), fetch);
    expect(warn).not.toHaveBeenCalled();
  } finally {
    warn.mockRestore();
  }
});

test("auto warns when only the chat key is set", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const config = loadConfig({ JELLYFIN_URL: "https://jf.example.com", LIBRETRANSLATE_URL: "http://lt", TRANSLATE_API_KEY: "k" });
    expect(createEngines(config, fetch).map((x) => x.name)).toEqual(["libretranslate"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("TRANSLATE_API_URL and TRANSLATE_MODEL must both be set; the chat engine is off");
  } finally {
    warn.mockRestore();
  }
});
