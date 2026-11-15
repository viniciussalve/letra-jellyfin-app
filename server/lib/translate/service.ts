import { createHash } from "node:crypto";
import { LANGUAGES, normalizeLangTag } from "../../../shared/languages.ts";
import type { LineTranslationDTO, Track, TranslationDTO } from "../../../shared/types.ts";
import type { TranslationCache } from "./cache.ts";
import { TranslationError, type TranslateInput, type Translator } from "./types.ts";

const primary = (code: string) => code.split("-")[0]!.toLowerCase();

const sha1 = (text: string) => createHash("sha1").update(text).digest("hex");

const fingerprint = (track: Track) =>
  createHash("sha1").update(JSON.stringify((track.lyrics?.lines ?? []).map((l) => l.text))).digest("hex");

function createSemaphore(max: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next) next(); // hand the slot over
      else active--;
    }
  };
}

export function createTranslationService(o: {
  engines: Translator[];
  cache: TranslationCache;
  maxConcurrent?: number;
  verifyTrack?: (trackId: string) => Promise<Track | null> | Track | null;
}) {
  const limit = createSemaphore(o.maxConcurrent ?? 2);
  const inflight = new Map<string, Promise<TranslationDTO>>();
  const lineInflight = new Map<string, Promise<LineTranslationDTO>>();

  async function callEngine(engine: Translator, track: Track, lang: string, lines: string[], context?: TranslateInput["context"]) {
    const target = LANGUAGES.find((l) => l.code === lang)!;
    // One retry when the engine returns the wrong number of lines.
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await limit(() =>
        engine.translate({ title: track.title, artist: track.artist, lines, target, context, sourceLang: track.lyricsLang }),
      );
      if (res.lines.length === lines.length) return res;
    }
    throw new TranslationError("line_count", `${engine.name} returned the wrong number of lines`);
  }

  async function run(track: Track, lang: string, fp: string): Promise<TranslationDTO> {
    const source = track.lyrics?.lines ?? [];
    const lines = source.map((l) => l.text).filter((t) => t.trim() !== "");
    let lastErr: unknown = new TranslationError("engine", "No translation engine configured");
    let result: { engine: Translator; sourceLang: string | null; lines: string[] } | null = null;
    for (const engine of o.engines) {
      try {
        const res = await callEngine(engine, track, lang, lines);
        result = { engine, sourceLang: res.sourceLang, lines: res.lines };
        break;
      } catch (err) {
        lastErr = err;
        const kind = err instanceof TranslationError ? err.kind : "engine";
        console.warn(`[translate] ${engine.name} failed (${kind}): ${(err as Error).message}`);
      }
    }
    if (!result) throw lastErr;

    const sourceLang = normalizeLangTag(result.sourceLang);
    const sameLanguage = sourceLang !== null && primary(sourceLang) === primary(lang);
    let out: string[] = [];
    if (!sameLanguage) {
      let i = 0;
      out = source.map((l) => (l.text.trim() === "" ? "" : result.lines[i++]!));
    }
    // Store only if the lyrics did not change while the engine was working.
    const current = o.verifyTrack ? await o.verifyTrack(track.id) : track;
    if (current && fingerprint(current) === fp) {
      o.cache.saveTrackTranslation({
        trackId: track.id,
        lang,
        fingerprint: fp,
        engine: result.engine.name,
        sourceLang,
        sameLanguage,
        lines: out,
        createdAt: new Date().toISOString(),
      });
    }
    return { lang, sourceLang, sameLanguage, lines: out };
  }

  /** The two nearest lines with text on each side of `index`, in song order. */
  function contextAround(track: Track, index: number) {
    const lines = track.lyrics?.lines ?? [];
    const withText = (i: number) => lines[i]!.text.trim() !== "";
    const before: string[] = [];
    for (let i = index - 1; i >= 0 && before.length < 2; i--) if (withText(i)) before.unshift(lines[i]!.text);
    const after: string[] = [];
    for (let i = index + 1; i < lines.length && after.length < 2; i++) if (withText(i)) after.push(lines[i]!.text);
    return { before, after };
  }

  async function runLine(track: Track, index: number, lang: string, text: string, hash: string): Promise<LineTranslationDTO> {
    const context = contextAround(track, index);
    let lastErr: unknown = new TranslationError("engine", "No translation engine configured");
    let result: { engine: Translator; sourceLang: string | null; sameLanguage: boolean; text: string } | null = null;
    for (const engine of o.engines) {
      try {
        const res = await callEngine(engine, track, lang, [text], context);
        const sourceLang = normalizeLangTag(res.sourceLang);
        const sameLanguage = sourceLang !== null && primary(sourceLang) === primary(lang);
        const out = res.lines[0]!;
        if (!sameLanguage && out.trim() === "") throw new TranslationError("engine", `${engine.name} returned an empty line`);
        result = { engine, sourceLang, sameLanguage, text: sameLanguage ? "" : out };
        break;
      } catch (err) {
        lastErr = err;
        const kind = err instanceof TranslationError ? err.kind : "engine";
        console.warn(`[translate] ${engine.name} failed (${kind}): ${(err as Error).message}`);
      }
    }
    if (!result) throw lastErr;

    // Store only if the song still has a line with this text. The line's language is not the
    // song's (a song can mix languages): only the whole-lyrics call sets lyricsLang.
    const current = o.verifyTrack ? await o.verifyTrack(track.id) : track;
    if (current?.lyrics?.lines.some((l) => l.text === text)) {
      o.cache.saveLineTranslation({
        trackId: track.id,
        lang,
        lineHash: hash,
        text: result.text,
        engine: result.engine.name,
        sourceLang: result.sourceLang,
        sameLanguage: result.sameLanguage,
        createdAt: new Date().toISOString(),
      });
    }
    return { lang, sourceLang: result.sourceLang, sameLanguage: result.sameLanguage, text: result.text };
  }

  return {
    enabled: o.engines.length > 0,
    translate(track: Track, lang: string): Promise<TranslationDTO> {
      const fp = fingerprint(track);
      const cached = o.cache.getTrackTranslation(track.id, lang);
      if (cached && (cached.fingerprint === undefined || cached.fingerprint === fp)) {
        return Promise.resolve({ lang, sourceLang: cached.sourceLang, sameLanguage: cached.sameLanguage, lines: cached.lines });
      }
      const key = `${track.id}:${lang}:${fp}`;
      let p = inflight.get(key);
      if (!p) {
        p = run(track, lang, fp).finally(() => inflight.delete(key));
        inflight.set(key, p);
      }
      return p;
    },
    /** `track.lyrics.lines[index]` must exist and have text: the caller checks. */
    translateLine(track: Track, index: number, lang: string): Promise<LineTranslationDTO> {
      if (track.lyricsLang && primary(track.lyricsLang) === primary(lang)) {
        return Promise.resolve({ lang, sourceLang: track.lyricsLang, sameLanguage: true, text: "" });
      }
      const fp = fingerprint(track);
      const whole = o.cache.getTrackTranslation(track.id, lang);
      if (whole && (whole.fingerprint === undefined || whole.fingerprint === fp)) {
        if (whole.sameLanguage) return Promise.resolve({ lang, sourceLang: whole.sourceLang, sameLanguage: true, text: "" });
        const cachedText = whole.lines[index];
        if (cachedText && cachedText.trim() !== "") {
          return Promise.resolve({ lang, sourceLang: whole.sourceLang, sameLanguage: false, text: cachedText });
        }
      }
      const text = track.lyrics!.lines[index]!.text;
      const hash = sha1(text);
      const cached = o.cache.getLineTranslation(track.id, lang, hash);
      if (cached) return Promise.resolve({ lang, sourceLang: cached.sourceLang, sameLanguage: cached.sameLanguage, text: cached.text });
      const key = `${track.id}:${lang}:${hash}`;
      let p = lineInflight.get(key);
      if (!p) {
        p = runLine(track, index, lang, text, hash).finally(() => lineInflight.delete(key));
        lineInflight.set(key, p);
      }
      return p;
    },
  };
}

export type TranslationService = ReturnType<typeof createTranslationService>;
