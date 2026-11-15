import { fileURLToPath } from "node:url";

export type TranslatorMode = "auto" | "claude" | "chat" | "libretranslate" | "fake" | "off";

export type Config = {
  jellyfinUrl: string;
  jellyfinApiKey: string | null;
  jellyfinLibraryDir: string | null;
  publicUrl: string;
  sessionSecret: string | null;
  dataDir: string;
  port: number;
  maxUploadBytes: number;
  translator: TranslatorMode;
  anthropicApiKey: string | null;
  anthropicModel: string;
  /** Base URL of an OpenAI-compatible endpoint, ending in /v1, without a trailing slash. */
  translateApiUrl: string | null;
  translateApiKey: string | null;
  translateModel: string | null;
  /** Whether the chat engine may ask the model for the lyrics' language. */
  translateDetectLanguage: boolean;
  libretranslateUrl: string | null;
  libretranslateApiKey: string | null;
  lrclibUrl: string;
  webDir: string;
  trustProxy: boolean | number | string[];
  /** Lowercase request header holding the client IP for rate limits, or null to use the socket/X-Forwarded-For address. */
  clientIpHeader: string | null;
  /** One log line per request and response (NODE_ENV=production, which the Docker image sets). */
  logRequests: boolean;
};

const TRANSLATORS: readonly TranslatorMode[] = ["auto", "claude", "chat", "libretranslate", "fake", "off"];

function opt(v: string | undefined): string | null {
  return v === undefined || v.trim() === "" ? null : v;
}

function positiveNumber(name: string, raw: string | undefined, fallback: number): number {
  if (opt(raw) === null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number`);
  return n;
}

function positiveInt(name: string, raw: string | undefined): number | null {
  if (opt(raw) === null) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

function parseTrustProxy(raw: string | undefined): boolean | number | string[] {
  const v = opt(raw)?.trim();
  if (v === undefined || v === "") return false;
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v.split(",").map((x) => x.trim()).filter((x) => x !== "");
}

function parseClientIpHeader(raw: string | undefined, onRailway: boolean): string | null {
  const v = opt(raw)?.trim().toLowerCase();
  // Railway's edge proxy sends the client address in X-Real-IP and no X-Forwarded-For.
  if (v === undefined) return onRailway ? "x-real-ip" : null;
  if (!/^[a-z0-9-]+$/.test(v)) throw new Error(`CLIENT_IP_HEADER must be a header name (got "${raw}")`);
  return v;
}

function parseBoolean(name: string, raw: string | undefined, fallback: boolean): boolean {
  const v = opt(raw)?.trim();
  if (v === undefined) return fallback;
  if (v === "true") return true;
  if (v === "false") return false;
  throw new Error(`${name} must be "true" or "false" (got "${raw}")`);
}

/** An http(s) URL with no user or password; the message names the variable, never the value. */
function httpUrl(name: string, raw: string | undefined): string | null {
  const v = opt(raw)?.trim();
  if (v === undefined) return null;
  let url: URL | null = null;
  try {
    url = new URL(v);
  } catch {
    url = null;
  }
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:") || url.username !== "" || url.password !== "") {
    throw new Error(`${name} must be an http(s) URL with no user or password`);
  }
  return v;
}

function translateApiUrl(raw: string | undefined): string | null {
  const v = httpUrl("TRANSLATE_API_URL", raw)?.replace(/\/+$/, "") ?? null;
  if (v !== null && /\/chat\/completions$/.test(v)) {
    throw new Error("TRANSLATE_API_URL must be the base URL (ending in /v1), not the chat completions address");
  }
  return v;
}

function translateApiKey(raw: string | undefined): string | null {
  // Outer whitespace is dropped, as the request header would drop it.
  const v = opt(raw)?.trim();
  if (v === undefined) return null;
  if (!/^[\x21-\x7E]+$/.test(v)) {
    throw new Error("TRANSLATE_API_KEY has a character a key can not have (a space or a line break, perhaps)");
  }
  return v;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const rawJellyfinUrl = httpUrl("JELLYFIN_URL", env.JELLYFIN_URL);
  if (rawJellyfinUrl === null) throw new Error("JELLYFIN_URL is required");
  const jellyfinUrl = rawJellyfinUrl.replace(/\/+$/, "");

  const translator = (opt(env.TRANSLATOR) ?? "auto") as TranslatorMode;
  if (!TRANSLATORS.includes(translator)) {
    throw new Error(`TRANSLATOR must be one of ${TRANSLATORS.join(", ")} (got "${translator}")`);
  }

  // On Railway, RAILWAY_PUBLIC_DOMAIN holds the service's public domain (no scheme).
  const railwayDomain = opt(env.RAILWAY_PUBLIC_DOMAIN)?.trim() ?? null;
  const defaultPublicUrl = railwayDomain ? `https://${railwayDomain}` : "http://localhost:3000";
  const publicUrl = (httpUrl("PUBLIC_URL", env.PUBLIC_URL) ?? defaultPublicUrl).replace(/\/+$/, "");
  const lrclibUrl = (httpUrl("LRCLIB_URL", env.LRCLIB_URL) ?? "https://lrclib.net").replace(/\/+$/, "");
  const port = positiveInt("PORT", env.PORT) ?? 3000;
  if (port > 65535) throw new Error("PORT must be <= 65535");

  return {
    jellyfinUrl,
    jellyfinApiKey: opt(env.JELLYFIN_API_KEY)?.trim() ?? null,
    jellyfinLibraryDir: opt(env.JELLYFIN_LIBRARY_DIR)?.trim() ?? null,
    publicUrl,
    sessionSecret: opt(env.SESSION_SECRET),
    dataDir: opt(env.DATA_DIR) ?? "/data",
    port,
    maxUploadBytes: positiveInt("MAX_UPLOAD_BYTES", env.MAX_UPLOAD_BYTES) ?? Math.floor(positiveNumber("MAX_UPLOAD_MB", env.MAX_UPLOAD_MB, 100) * 1048576),
    translator,
    anthropicApiKey: opt(env.ANTHROPIC_API_KEY),
    anthropicModel: opt(env.ANTHROPIC_MODEL) ?? "claude-opus-5-5",
    translateApiUrl: translateApiUrl(env.TRANSLATE_API_URL),
    translateApiKey: translateApiKey(env.TRANSLATE_API_KEY),
    translateModel: opt(env.TRANSLATE_MODEL),
    translateDetectLanguage: parseBoolean("TRANSLATE_DETECT_LANGUAGE", env.TRANSLATE_DETECT_LANGUAGE, true),
    libretranslateUrl: httpUrl("LIBRETRANSLATE_URL", env.LIBRETRANSLATE_URL),
    libretranslateApiKey: opt(env.LIBRETRANSLATE_API_KEY),
    lrclibUrl,
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    clientIpHeader: parseClientIpHeader(env.CLIENT_IP_HEADER, railwayDomain !== null),
    webDir: opt(env.WEB_DIR) ?? fileURLToPath(new URL("../dist/web", import.meta.url)),
    logRequests: env.NODE_ENV === "production",
  };
}
