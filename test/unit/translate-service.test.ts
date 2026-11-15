import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createTranslationCache, type TranslationCache } from "../../server/lib/translate/cache.ts";
import { createTranslationService } from "../../server/lib/translate/service.ts";
import { TranslationError, type Translator } from "../../server/lib/translate/types.ts";
import { LANGUAGES } from "../../shared/languages.ts";
import type { Track } from "../../shared/types.ts";

let cache: TranslationCache;
let tracksMap: Map<string, Track>;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

const lang = (code: string) => LANGUAGES.find((l) => l.code === code)!;

function makeTrack(id: string, texts = ["Um", "", "Dois"]): Track {
  return {
    id,
    title: "T",
    artist: "A",
    album: null,
    durationMs: 1000,
    mime: "audio/mpeg",
    ext: "mp3",
    sizeBytes: 1,
    hasCover: false,
    palette: { mesh: ["#000000", "#111111", "#222222", "#333333"], scrim: 0.5 },
    lyrics: { synced: false, lines: texts.map((text) => ({ t: null, text })), instrumental: false },
    lyricsSource: "manual",
    lyricsLang: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function setup(...ids: string[]) {
  cache = createTranslationCache(null);
  tracksMap = new Map();
  const tracks = ids.map((id) => makeTrack(id));
  for (const t of tracks) tracksMap.set(t.id, t);
  return tracks;
}

const verifyTrack = (id: string) => tracksMap.get(id) ?? null;

const upper = (sourceLang: string | null = "en") => ({
  name: "fake" as const,
  calls: [] as string[][],
  async translate(i: { lines: string[] }) {
    this.calls.push(i.lines);
    return { sourceLang, lines: i.lines.map((l) => l.toUpperCase()) };
  },
});

test("only non-empty lines are sent; output re-aligned with breaks as ''", async () => {
  const [t] = setup("a");
  const eng = upper();
  const svc = createTranslationService({ engines: [eng], cache, verifyTrack });
  const dto = await svc.translate(t!, "pt-BR");
  expect(eng.calls).toEqual([["Um", "Dois"]]);
  expect(dto).toEqual({ lang: "pt-BR", sourceLang: "en", sameLanguage: false, lines: ["UM", "", "DOIS"] });
});

test("line_count mismatch retries once, then falls to next engine", async () => {
  const [t] = setup("a");
  let bad = 0;
  let good = 0;
  const e1: Translator = { name: "claude", translate: async () => (bad++, { sourceLang: "en", lines: ["só um"] }) };
  const e2: Translator = { name: "libretranslate", translate: async (i) => (good++, { sourceLang: "en", lines: i.lines }) };
  const dto = await createTranslationService({ engines: [e1, e2], cache, verifyTrack }).translate(t!, "es");
  expect([bad, good]).toEqual([2, 1]);
  expect(dto.lines).toEqual(["Um", "", "Dois"]);
});

test("cached: second call does not hit the engine", async () => {
  const [t] = setup("a");
  const eng = upper();
  const svc = createTranslationService({ engines: [eng], cache, verifyTrack });
  const first = await svc.translate(t!, "es");
  const second = await svc.translate(t!, "es");
  expect(eng.calls).toHaveLength(1);
  expect(second).toEqual(first);
});

test("concurrent callers share one in-flight call", async () => {
  const [t] = setup("a");
  const eng = upper();
  const svc = createTranslationService({ engines: [eng], cache, verifyTrack });
  const [a, b] = await Promise.all([svc.translate(t!, "fr"), svc.translate(t!, "fr")]);
  expect(eng.calls).toHaveLength(1);
  expect(a).toEqual(b);
});

test("failure is not cached and is shared by waiters", async () => {
  const [t] = setup("a");
  let n = 0;
  const eng: Translator = { name: "claude", translate: async () => { n++; throw new TranslationError("engine", "down"); } };
  const svc = createTranslationService({ engines: [eng], cache, verifyTrack });
  const results = await Promise.allSettled([svc.translate(t!, "de"), svc.translate(t!, "de")]);
  expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
  expect(n).toBe(1);
  await expect(svc.translate(t!, "de")).rejects.toBeInstanceOf(TranslationError);
  expect(n).toBe(2);
  expect(cache.getTrackTranslation("a", "de")).toBeNull();
});

test("max 2 engine calls at once", async () => {
  const tracks = setup("a", "b", "c");
  let active = 0;
  let peak = 0;
  const eng: Translator = {
    name: "fake",
    async translate(i) {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      return { sourceLang: "en", lines: i.lines };
    },
  };
  const svc = createTranslationService({ engines: [eng], cache, verifyTrack });
  await Promise.all(tracks.map((t) => svc.translate(t, "it")));
  expect(peak).toBe(2);
});

test("sameLanguage when source primary subtag equals target", async () => {
  const [t] = setup("a");
  const svc = createTranslationService({ engines: [upper("pt")], cache, verifyTrack });
  expect(await svc.translate(t!, "pt-BR")).toEqual({ lang: "pt-BR", sourceLang: "pt", sameLanguage: true, lines: [] });
  expect(cache.getTrackTranslation("a", "pt-BR")?.sameLanguage).toBe(true);
});

test("no engines means disabled", () => {
  setup();
  expect(createTranslationService({ engines: [], cache }).enabled).toBe(false);
  expect(lang("zh").name).toBe("中文");
});

test("lyrics changed during a call: result returned, nothing stored, next call re-runs", async () => {
  const [t] = setup("a");
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let n = 0;
  const eng: Translator = {
    name: "fake",
    async translate(i) {
      n++;
      await gate;
      return { sourceLang: "en", lines: i.lines.map((l) => l.toUpperCase()) };
    },
  };
  const svc = createTranslationService({ engines: [eng], cache, verifyTrack });
  const pending = svc.translate(t!, "es");
  await new Promise((r) => setTimeout(r, 5));
  tracksMap.set("a", {
    ...t!,
    lyrics: { synced: false, lines: [{ t: null, text: "Novo" }], instrumental: false },
    lyricsLang: null,
  });
  cache.clearTrackTranslations("a");
  release();
  expect((await pending).lines).toEqual(["UM", "", "DOIS"]);
  expect(cache.getTrackTranslation("a", "es")).toBeNull();
  const again = await svc.translate(tracksMap.get("a")!, "es");
  expect(again.lines).toEqual(["NOVO"]);
  expect(n).toBe(2);
});

test("engine failures are logged, even when a fallback succeeds", async () => {
  const [t] = setup("a");
  const bad: Translator = { name: "claude", translate: async () => { throw new TranslationError("refusal", "nope"); } };
  const dto = await createTranslationService({ engines: [bad, upper()], cache, verifyTrack }).translate(t!, "es");
  expect(dto.lines).toEqual(["UM", "", "DOIS"]);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("claude"));
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("refusal"));
});

test("source language: BCP-47 tags are kept with a lowercase primary subtag; free text becomes null", async () => {
  const [t] = setup("a");
  const named = await createTranslationService({ engines: [upper("Portuguese")], cache, verifyTrack }).translate(t!, "pt-BR");
  expect(named).toEqual({ lang: "pt-BR", sourceLang: null, sameLanguage: false, lines: ["UM", "", "DOIS"] });
  expect(cache.getTrackTranslation("a", "pt-BR")?.sourceLang).toBeNull();

  const shouted = await createTranslationService({ engines: [upper("PT-BR")], cache, verifyTrack }).translate(t!, "es");
  expect(shouted.sourceLang).toBe("pt-BR");
  cache.clearTrackTranslations("a");
  const same = await createTranslationService({ engines: [upper("PT")], cache, verifyTrack }).translate(t!, "pt-BR");
  expect(same).toMatchObject({ sourceLang: "pt", sameLanguage: true });
});

test("normalizeLangTag", async () => {
  const { normalizeLangTag } = await import("../../shared/languages.ts");
  expect(normalizeLangTag("en")).toBe("en");
  expect(normalizeLangTag("EN-gb")).toBe("en-gb");
  expect(normalizeLangTag("zh-Hans-CN")).toBe("zh-Hans-CN");
  expect(normalizeLangTag(" fil ")).toBe("fil");
  for (const bad of ["Portuguese", "pt_BR", "", "e", "english", "pt-", "pt-BR!", null, undefined]) {
    expect(normalizeLangTag(bad)).toBeNull();
  }
});

// ---- translateLine ----

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

function setupLine(texts: string[], lyricsLang: string | null = null): Track {
  setup("a");
  const updated: Track = {
    ...tracksMap.get("a")!,
    lyrics: { synced: false, lines: texts.map((text) => ({ t: null, text })), instrumental: false },
    lyricsLang,
  };
  tracksMap.set("a", updated);
  return updated;
}

type LineCall = { lines: string[]; context?: { before: string[]; after: string[] }; sourceLang?: string | null };
const lineEngine = (sourceLang: string | null = "en") => ({
  name: "fake" as const,
  calls: [] as LineCall[],
  async translate(i: LineCall) {
    this.calls.push({ lines: i.lines, context: i.context, sourceLang: i.sourceLang });
    return { sourceLang, lines: i.lines.map((l) => `[x] ${l}`) };
  },
});

test("translateLine: the song's own language answers sameLanguage with no engine call", async () => {
  for (const known of ["pt-BR", "pt"]) {
    const t = setupLine(["Um", "Dois"], known);
    const eng = lineEngine();
    const svc = createTranslationService({ engines: [eng], cache, verifyTrack });
    expect(await svc.translateLine(t, 0, "pt-BR")).toEqual({ lang: "pt-BR", sourceLang: known, sameLanguage: true, text: "" });
    expect(eng.calls).toHaveLength(0);
    expect(cache.getLineTranslation("a", "pt-BR", sha1("Um"))).toBeNull();
  }
});

test("translateLine: a cached whole-lyrics translation gives its line", async () => {
  const t = setupLine(["Um", "", "Dois"]);
  const eng = lineEngine();
  const svc = createTranslationService({ engines: [eng], cache, verifyTrack });
  cache.saveTrackTranslation({
    trackId: "a",
    lang: "es",
    engine: "fake",
    sourceLang: "pt",
    sameLanguage: false,
    lines: ["UNO", "", "DOS"],
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  expect(await svc.translateLine(t, 2, "es")).toEqual({ lang: "es", sourceLang: "pt", sameLanguage: false, text: "DOS" });
  expect(eng.calls).toHaveLength(0);

  cache.saveTrackTranslation({
    trackId: "a",
    lang: "pt-BR",
    engine: "fake",
    sourceLang: "pt",
    sameLanguage: true,
    lines: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  expect(await svc.translateLine(t, 0, "pt-BR")).toEqual({ lang: "pt-BR", sourceLang: "pt", sameLanguage: true, text: "" });
  expect(eng.calls).toHaveLength(0);
});

test("translateLine: the second call comes from the line cache", async () => {
  const t = setupLine(["Um", "Dois", "Um"]);
  const eng = lineEngine();
  const svc = createTranslationService({ engines: [eng], cache, verifyTrack });
  const first = await svc.translateLine(t, 0, "es");
  expect(first).toEqual({ lang: "es", sourceLang: "en", sameLanguage: false, text: "[x] Um" });
  expect(await svc.translateLine(t, 0, "es")).toEqual(first);
  expect(await svc.translateLine(t, 2, "es")).toEqual(first);
  expect(eng.calls).toHaveLength(1);
  expect(cache.getLineTranslation("a", "es", sha1("Um"))).toMatchObject({
    text: "[x] Um",
    engine: "fake",
    sourceLang: "en",
    sameLanguage: false,
  });
});

test("translateLine: the engine gets the line, its context and the known language", async () => {
  const t = setupLine(["a1", "a2", "", "a3", "L", "", "b1", "b2", "b3"], "pt");
  const eng = lineEngine("pt");
  const svc = createTranslationService({ engines: [eng], cache, verifyTrack });
  await svc.translateLine(t, 4, "es");
  expect(eng.calls).toEqual([{ lines: ["L"], context: { before: ["a2", "a3"], after: ["b1", "b2"] }, sourceLang: "pt" }]);

  const first = setupLine(["L0", "", "n1", "n2", "n3"], null);
  const eng2 = lineEngine("pt");
  await createTranslationService({ engines: [eng2], cache, verifyTrack }).translateLine(first, 0, "es");
  expect(eng2.calls).toEqual([{ lines: ["L0"], context: { before: [], after: ["n1", "n2"] }, sourceLang: null }]);
});

test("translateLine: an engine saying it is the same language is cached with no text and leaves the song's language unknown", async () => {
  const t = setupLine(["Um", "Dois"]);
  const eng = lineEngine("PT");
  const svc = createTranslationService({ engines: [eng], cache, verifyTrack });
  expect(await svc.translateLine(t, 0, "pt-BR")).toEqual({ lang: "pt-BR", sourceLang: "pt", sameLanguage: true, text: "" });
  expect(cache.getLineTranslation("a", "pt-BR", sha1("Um"))).toMatchObject({ text: "", sameLanguage: true, sourceLang: "pt" });
  await svc.translateLine(t, 0, "pt-BR");
  expect(eng.calls).toHaveLength(1);
});

test("translateLine: falls to the next engine; when all fail it rejects and caches nothing", async () => {
  const t = setupLine(["Um", "Dois"]);
  let bad = 0;
  const e1: Translator = { name: "claude", translate: async () => (bad++, { sourceLang: "en", lines: ["a", "b"] }) };
  const e2 = lineEngine();
  const ok = await createTranslationService({ engines: [e1, e2], cache, verifyTrack }).translateLine(t, 1, "es");
  expect(ok.text).toBe("[x] Dois");
  expect(bad).toBe(2);
  expect(e2.calls).toHaveLength(1);

  let n = 0;
  const down = (name: "claude" | "chat"): Translator => ({ name, translate: async () => (n++, Promise.reject(new TranslationError("engine", `${name} down`))) });
  const svc = createTranslationService({ engines: [down("claude"), down("chat")], cache, verifyTrack });
  await expect(svc.translateLine(t, 0, "de")).rejects.toThrow("chat down");
  expect(n).toBe(2);
  expect(cache.getLineTranslation("a", "de", sha1("Um"))).toBeNull();
});

test("translateLine: an empty answer is a failure", async () => {
  const t = setupLine(["Um", "Dois"]);
  const blank: Translator = { name: "claude", translate: async () => ({ sourceLang: "en", lines: ["  "] }) };
  await expect(createTranslationService({ engines: [blank], cache, verifyTrack }).translateLine(t, 0, "es")).rejects.toBeInstanceOf(TranslationError);
  expect(cache.getLineTranslation("a", "es", sha1("Um"))).toBeNull();
  const next = lineEngine();
  const dto = await createTranslationService({ engines: [blank, next], cache, verifyTrack }).translateLine(t, 0, "es");
  expect(dto.text).toBe("[x] Um");
});

test("translateLine: callers share one call, and a failure is shared and not kept", async () => {
  const t = setupLine(["Um", "Dois", "Um"]);
  const eng = lineEngine();
  const svc = createTranslationService({ engines: [eng], cache, verifyTrack });
  const [a, b] = await Promise.all([svc.translateLine(t, 0, "fr"), svc.translateLine(t, 2, "fr")]);
  expect(eng.calls).toHaveLength(1);
  expect(a).toEqual(b);

  let n = 0;
  const down: Translator = { name: "claude", translate: async () => { n++; throw new TranslationError("engine", "down"); } };
  const failing = createTranslationService({ engines: [down], cache, verifyTrack });
  const results = await Promise.allSettled([failing.translateLine(t, 1, "de"), failing.translateLine(t, 1, "de")]);
  expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
  expect(n).toBe(1);
  await expect(failing.translateLine(t, 1, "de")).rejects.toBeInstanceOf(TranslationError);
  expect(n).toBe(2);
});

test("translateLine: line calls and whole-lyrics calls share the limit of 2", async () => {
  const [b, c] = setup("b", "c");
  const a = makeTrack("a", ["Solo"]);
  tracksMap.set("a", a);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const started: number[] = [];
  const eng: Translator = {
    name: "fake",
    async translate(i) {
      started.push(i.lines.length);
      if (i.lines.length > 1) await gate;
      return { sourceLang: "en", lines: i.lines };
    },
  };
  const svc = createTranslationService({ engines: [eng], cache, verifyTrack });
  const whole = [svc.translate(b!, "it"), svc.translate(c!, "it")];
  await vi.waitFor(() => expect(started).toEqual([2, 2]));
  const line = svc.translateLine(a, 0, "it");
  await new Promise((r) => setImmediate(r));
  expect(started).toEqual([2, 2]);
  release();
  await Promise.all([...whole, line]);
  expect(started).toEqual([2, 2, 1]);
});

test("translateLine: lyrics that changed during the call: answered, not stored", async () => {
  const t = setupLine(["Um", "Dois"]);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let n = 0;
  const eng: Translator = {
    name: "fake",
    async translate(i) {
      n++;
      await gate;
      return { sourceLang: "en", lines: i.lines.map((l) => l.toUpperCase()) };
    },
  };
  const svc = createTranslationService({ engines: [eng], cache, verifyTrack });
  const pending = svc.translateLine(t, 0, "es");
  await vi.waitFor(() => expect(n).toBe(1));
  tracksMap.set("a", {
    ...t,
    lyrics: { synced: false, lines: [{ t: null, text: "Novo" }], instrumental: false },
  });
  release();
  expect((await pending).text).toBe("UM");
  expect(cache.getLineTranslation("a", "es", sha1("Um"))).toBeNull();
});

test("the whole-lyrics call passes the song's known language to the engine", async () => {
  const t = setupLine(["Um", "Dois"], "pt");
  const seen: Array<string | null | undefined> = [];
  const eng: Translator = { name: "fake", translate: async (i) => (seen.push(i.sourceLang), { sourceLang: "pt", lines: i.lines }) };
  await createTranslationService({ engines: [eng], cache, verifyTrack }).translate(t, "es");
  expect(seen).toEqual(["pt"]);
});

test("invalidates cached whole-lyrics translation when lyrics fingerprint changes externally", async () => {
  const tV1 = setupLine(["Old line one", "Old line two"]);
  const eng = upper("en");
  const svc = createTranslationService({ engines: [eng], cache, verifyTrack });

  const res1 = await svc.translate(tV1, "pt-BR");
  expect(res1.lines).toEqual(["OLD LINE ONE", "OLD LINE TWO"]);
  expect(eng.calls).toHaveLength(1);

  const tV2 = makeTrack("a", ["New line one", "New line two"]);
  tracksMap.set("a", tV2);
  const res2 = await svc.translate(tV2, "pt-BR");
  expect(res2.lines).toEqual(["NEW LINE ONE", "NEW LINE TWO"]);
  expect(eng.calls).toHaveLength(2);
});
