import { expect, test } from "vitest";
import { createChatTranslator } from "../../server/lib/translate/chat.ts";
import { TranslationError } from "../../server/lib/translate/types.ts";
import { LANGUAGES } from "../../shared/languages.ts";

const target = (code: string) => LANGUAGES.find((l) => l.code === code)!;
const URL_ = "https://x.test/v1";

type Call = { url: string; init: RequestInit; body: any; content: string };
type Answer = string | Response | Error;

/** A stub fetch that records each call and answers from a queue. */
function stub(answers: Answer[]) {
  const calls: Call[] = [];
  const queue = [...answers];
  const f = (async (u: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    calls.push({ url: String(u), init: init!, body, content: body.messages[0].content });
    const next = queue.shift();
    if (next === undefined) throw new Error("unexpected request");
    if (next instanceof Error) throw next;
    if (next instanceof Response) return next;
    return new Response(JSON.stringify({ choices: [{ message: { content: next } }] }), { status: 200 });
  }) as typeof fetch;
  return { f, calls };
}

const make = (s: ReturnType<typeof stub>, o: Partial<Parameters<typeof createChatTranslator>[0]> = {}) =>
  createChatTranslator({ url: URL_, apiKey: null, model: "m", detectLanguage: false, fetch: s.f, ...o });

const base = { title: "Canção", artist: "Ana", lines: ["Olá", "Mundo"], target: target("pt-BR") };

const INSTRUCTION = (name: string) =>
  `Please translate the following song lyrics into ${name}, line by line, taking the provided background information into consideration. Keep the meaning and the tone rather than translating word for word. Keep exactly one output line per input line, in the same order, and output only the translated lines, without any additional explanation.`;

test("request shape", async () => {
  const s = stub(["Olá\nMundo"]);
  const r = await make(s).translate({ ...base, target: target("pt-BR"), lines: ["Hello", "World"] });
  expect(r).toEqual({ sourceLang: null, lines: ["Olá", "Mundo"] });
  expect(s.calls).toHaveLength(1);
  const c = s.calls[0]!;
  expect(c.url).toBe("https://x.test/v1/chat/completions");
  expect(c.init.method).toBe("POST");
  expect((c.init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  expect(c.init.signal).toBeInstanceOf(AbortSignal);
  expect(c.body.model).toBe("m");
  expect(c.body.temperature).toBe(0);
  expect(c.body.stream).toBe(false);
  expect(c.body.messages).toHaveLength(1);
  expect(c.body.messages[0].role).toBe("user");
  expect(c.content).toBe(
    `[Background Information]\nSong: "Canção" by Ana\n\n${INSTRUCTION("Brazilian Portuguese (pt-BR)")}\n\n[Source Text]\nHello\nWorld`,
  );
});

test("the key goes in the Authorization header, and only when there is one", async () => {
  const withKey = stub(["a\nb"]);
  await make(withKey, { apiKey: "k" }).translate(base);
  expect((withKey.calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer k");
  const without = stub(["a\nb"]);
  await make(without).translate(base);
  expect(Object.keys(without.calls[0]!.init.headers as object).map((h) => h.toLowerCase())).not.toContain("authorization");
});

test("context lines go in the background, not in the source text", async () => {
  const s = stub(["x"]);
  await make(s).translate({ ...base, lines: ["Meio"], context: { before: ["Antes 1", "Antes 2"], after: ["Depois"] } });
  expect(s.calls[0]!.content).toBe(
    `[Background Information]\nSong: "Canção" by Ana\nLines before, for context only:\nAntes 1\nAntes 2\nLines after, for context only:\nDepois\n\n${INSTRUCTION("Brazilian Portuguese (pt-BR)")}\n\n[Source Text]\nMeio`,
  );
});

test("a blank artist and an unlisted language", async () => {
  const s = stub(["x"]);
  await make(s).translate({ ...base, artist: "  ", lines: ["Hej"], target: { code: "sv", name: "Svenska" } });
  expect(s.calls[0]!.content).toContain('Song: "Canção"\n');
  expect(s.calls[0]!.content).not.toContain("Song: \"Canção\" by");
  expect(s.calls[0]!.content).toContain("into Svenska (sv),");
});

test("lyrics go in chunks of 24, in order, one request at a time", async () => {
  const lines = Array.from({ length: 50 }, (_, i) => `L${i}`);
  let inFlight = 0;
  let maxInFlight = 0;
  const calls: string[] = [];
  const f = (async (_u: string, init?: RequestInit) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const content: string = JSON.parse(String(init?.body)).messages[0].content;
    calls.push(content);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    const src = content.split("[Source Text]\n")[1]!.split("\n");
    return new Response(JSON.stringify({ choices: [{ message: { content: src.map((l) => `T-${l}`).join("\n") } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const r = await createChatTranslator({ url: URL_, apiKey: null, model: "m", detectLanguage: false, fetch: f }).translate({ ...base, lines });
  expect(calls.map((c) => c.split("[Source Text]\n")[1]!.split("\n").length)).toEqual([24, 24, 2]);
  expect(maxInFlight).toBe(1);
  expect(r.lines).toEqual(lines.map((l) => `T-${l}`));
});

test("a chunk with the wrong number of lines is redone line by line", async () => {
  const s = stub(["one\ntwo", "A", "B", "C"]);
  const r = await make(s).translate({ ...base, lines: ["a", "b", "c"], context: { before: ["z"], after: [] } });
  expect(r.lines).toEqual(["A", "B", "C"]);
  expect(s.calls).toHaveLength(4);
  expect(s.calls.slice(1).map((c) => c.content.split("[Source Text]\n")[1])).toEqual(["a", "b", "c"]);
  expect(s.calls[1]!.content).toContain("Lines before, for context only:\nz\n");
});

test("a one-line answer in several lines is joined; an empty one fails", async () => {
  const joined = stub(["um\ndois"]);
  expect((await make(joined).translate({ ...base, lines: ["a"] })).lines).toEqual(["um dois"]);
  const empty = stub(["  \n "]);
  await expect(make(empty).translate({ ...base, lines: ["a"] })).rejects.toMatchObject({ kind: "engine" });
});

test("blank lines and a reasoning block are dropped from the answer", async () => {
  const s = stub(["<think>hm\nhm</think>\n\nUm\n\nDois\n"]);
  expect((await make(s).translate(base)).lines).toEqual(["Um", "Dois"]);
});

test("the language question comes first and reads a tag", async () => {
  const ctx = { before: ["b1", " ", "b2"], after: ["a1", "a2"] };
  const ask = async (answer: string) => {
    const s = stub([answer, "x\ny\nz\nw"]);
    // A target none of the answers below names, so that each answer is followed by the translation.
    const r = await make(s, { detectLanguage: true }).translate({ ...base, target: target("es"), lines: ["l1", "l2", "l3", "l4"], context: ctx });
    return { r, s };
  };
  const { r, s } = await ask("pt-BR");
  expect(s.calls).toHaveLength(2);
  expect(s.calls[0]!.content).toBe(
    "What language is the following text written in? Answer with its BCP-47 language code only (for example: en, pt-BR, ja), without any additional explanation:\n\nb1\nb2\nl1\nl2\nl3\nl4",
  );
  expect(r.sourceLang).toBe("pt-BR");
  expect((await ask("`en`.")).r.sourceLang).toBe("en");
  expect((await ask("PT")).r.sourceLang).toBe("pt");
  expect((await ask("Portuguese")).r.sourceLang).toBeNull();
  expect((await ask("español EN")).r.sourceLang).toBeNull();
  for (const notALanguage of ["und", "mul", "zxx"]) expect((await ask(notALanguage)).r.sourceLang).toBeNull();
});

test("no translation request when the lyrics are already in the target language", async () => {
  const given = stub([]);
  const r = await make(given, { detectLanguage: true }).translate({ ...base, sourceLang: "pt", target: target("pt-BR") });
  expect(given.calls).toHaveLength(0);
  expect(r).toEqual({ sourceLang: "pt", lines: ["Olá", "Mundo"] });
  const detected = stub(["pt-BR"]);
  const r2 = await make(detected, { detectLanguage: true }).translate({ ...base, target: target("pt-BR") });
  expect(detected.calls).toHaveLength(1);
  expect(r2).toEqual({ sourceLang: "pt-BR", lines: ["Olá", "Mundo"] });
});

test("a known language skips the question", async () => {
  const known = stub(["a\nb"]);
  const r = await make(known, { detectLanguage: true }).translate({ ...base, sourceLang: "en" });
  expect(known.calls).toHaveLength(1);
  expect(r.sourceLang).toBe("en");
  const unknown = stub(["en", "a\nb"]);
  const r2 = await make(unknown, { detectLanguage: true }).translate({ ...base, sourceLang: "English" });
  expect(unknown.calls).toHaveLength(2);
  expect(r2.sourceLang).toBe("en");
});

test("with detection off the engine asks nothing and reports what it was given", async () => {
  const s = stub(["a\nb", "a\nb"]);
  const t = make(s, { detectLanguage: false });
  expect((await t.translate(base)).sourceLang).toBeNull();
  expect((await t.translate({ ...base, sourceLang: "fr" })).sourceLang).toBe("fr");
  expect(s.calls).toHaveLength(2);
});

test("HTTP errors, a network error and a malformed body are engine errors", async () => {
  for (const status of [401, 402, 429, 500]) {
    const s = stub([new Response("nope", { status })]);
    const err = await make(s, { apiKey: "secret-key" }).translate(base).catch((e) => e);
    expect(err).toBeInstanceOf(TranslationError);
    expect(err.kind).toBe("engine");
    expect(err.message).toContain(String(status));
    expect(err.message).not.toContain("secret-key");
  }
  const net = stub([new TypeError("fetch failed")]);
  const e1 = await make(net, { apiKey: "secret-key" }).translate(base).catch((e) => e);
  expect(e1).toMatchObject({ kind: "engine" });
  expect(e1.message).toBe("The chat request failed (TypeError)");
  expect(e1.message).not.toContain("secret-key");
  const bodies: Array<[Response, string]> = [
    [new Response("{}", { status: 200 }), "The chat endpoint returned no text"],
    [new Response("not json", { status: 200 }), "The chat endpoint returned a body that is not JSON"],
  ];
  for (const [body, message] of bodies) {
    const err = await make(stub([body]), { apiKey: "secret-key" }).translate(base).catch((e) => e);
    expect(err).toBeInstanceOf(TranslationError);
    expect(err.kind).toBe("engine");
    expect(err.message).toBe(message);
    expect(err.message).not.toContain("secret-key");
  }
});

test("a fetch error's text never reaches the engine's message", async () => {
  const thrown = [
    new TypeError('Headers.append: "Bearer hf_SECRET\nTAIL" is an invalid header value.'),
    new TypeError("Request cannot be constructed from a URL that includes credentials: https://ana:senha@host/v1/chat/completions"),
  ];
  for (const e of thrown) {
    const err = await make(stub([e])).translate(base).catch((x) => x);
    expect(err).toBeInstanceOf(TranslationError);
    expect(err.kind).toBe("engine");
    for (const secret of ["hf_SECRET", "TAIL", "senha", "ana"]) expect(err.message).not.toContain(secret);
  }
});

test("a network failure names its code", async () => {
  const e = new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
  const err = await make(stub([e])).translate(base).catch((x) => x);
  expect(err).toMatchObject({ kind: "engine", message: "The chat request failed (ECONNREFUSED)" });
});

test("a request that does not answer in time is an engine error", async () => {
  const hung = ((_u: string, init?: RequestInit) =>
    new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener("abort", () => rej(init.signal!.reason));
    })) as unknown as typeof fetch;
  const t = createChatTranslator({ url: URL_, apiKey: null, model: "m", detectLanguage: false, fetch: hung, timeoutMs: 20 });
  await expect(t.translate(base)).rejects.toMatchObject({ kind: "engine", message: expect.stringContaining("20 ms") });
});
