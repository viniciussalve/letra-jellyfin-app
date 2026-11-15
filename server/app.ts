import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { loadSessionSecret } from "./auth.ts";
import type { Config } from "./config.ts";
import { createJellyfinClient } from "./jellyfin/client.ts";
import { toTrack } from "./jellyfin/mapper.ts";
import type { JellyfinClient } from "./jellyfin/types.ts";
import { AppError, sendError } from "./lib/errors.ts";
import { createLrclibClient } from "./lib/lyrics/lrclib.ts";
import { blockRendering } from "./lib/render.ts";
import { createTranslationCache, type TranslationCache } from "./lib/translate/cache.ts";
import { createEngines } from "./lib/translate/engines.ts";
import { createTranslationService, type TranslationService } from "./lib/translate/service.ts";
import type { Translator } from "./lib/translate/types.ts";
import { registerHealth } from "./routes/health.ts";
import { registerLab } from "./routes/lab.ts";
import { registerMedia } from "./routes/media.ts";
import { registerPages, type Templates } from "./routes/pages.ts";
import { registerSession } from "./routes/session.ts";
import { registerTracks } from "./routes/tracks.ts";
import { registerTranslation } from "./routes/translation.ts";

declare module "fastify" {
  interface FastifyInstance {
    jellyfin: JellyfinClient;
    sessionSecret: string;
    translationCache: TranslationCache;
    translation: TranslationService;
  }
}

// Test seams. `logStream` receives the request log instead of stdout.
export type AppOverrides = {
  fetch?: typeof fetch;
  jellyfin?: JellyfinClient;
  translators?: Translator[];
  templates?: Templates;
  logStream?: { write(line: string): void };
};

function loadTemplates(webDir: string): Templates | null {
  const upload = join(webDir, "upload", "index.html");
  const player = join(webDir, "player", "index.html");
  if (!existsSync(upload) || !existsSync(player)) {
    console.warn("Front-end not built (missing upload/player index.html under WEB_DIR). Run npm run build.");
    return null;
  }
  return { upload: blockRendering(readFileSync(upload, "utf8")), player: blockRendering(readFileSync(player, "utf8")) };
}

export async function buildApp(config: Config, overrides: AppOverrides = {}): Promise<FastifyInstance> {
  mkdirSync(config.dataDir, { recursive: true });
  // Request log in production only, so tests stay quiet. Fastify's default serializers
  // log method, URL, host and remote address, and the status code: no headers, so no
  // session cookie and no Authorization.
  const logger = config.logRequests
    ? { level: "info", ...(overrides.logStream ? { stream: overrides.logStream } : {}) }
    : false;
  // Fastify accepts a hop count at runtime; its typings omit `number`.
  const app = Fastify({ logger, trustProxy: config.trustProxy as boolean });

  const fetchImpl = overrides.fetch ?? globalThis.fetch;
  const jellyfin = overrides.jellyfin ?? createJellyfinClient({ baseUrl: config.jellyfinUrl, fetchFn: fetchImpl });
  const sessionSecret = await loadSessionSecret(config);
  const translationCache = createTranslationCache(join(config.dataDir, "translations.json"));

  app.decorate("jellyfin", jellyfin);
  app.decorate("sessionSecret", sessionSecret);
  app.decorate("translationCache", translationCache);
  app.decorate(
    "translation",
    createTranslationService({
      engines: overrides.translators ?? createEngines(config, fetchImpl),
      cache: translationCache,
      verifyTrack: config.jellyfinApiKey
        ? async (trackId) => {
            const item = await jellyfin.getAudioItem(config.jellyfinApiKey!, trackId);
            if (!item) return null;
            const lyrics = await jellyfin.getLyrics(config.jellyfinApiKey!, trackId);
            return toTrack(item, lyrics);
          }
        : undefined,
    }),
  );

  // Rate limits key on the client IP: from config.clientIpHeader when a proxy sets one
  // (Railway sends X-Real-IP), otherwise Fastify's req.ip (socket, or X-Forwarded-For
  // with TRUST_PROXY). Route limits inherit this keyGenerator.
  const ipHeader = config.trustProxy !== false ? config.clientIpHeader : null;
  await app.register(rateLimit, {
    global: false,
    keyGenerator: (req) => {
      const raw = ipHeader ? req.headers[ipHeader] : undefined;
      const fromHeader = (Array.isArray(raw) ? raw[0] : raw)?.split(",")[0]?.trim();
      return fromHeader || req.ip;
    },
  });

  app.setErrorHandler((error, _req, reply) => {
    const err = error as Error & { statusCode?: number };
    const status = err.statusCode ?? 500;
    if (err instanceof AppError) return sendError(reply, status, err.code, err.message);
    if (status === 429) return sendError(reply, 429, "too_many_attempts", err.message);
    if (status >= 500 || status < 400) {
      console.error(err);
      return sendError(reply, status >= 500 ? status : 500, "internal", "Erro no servidor. Tente de novo em instantes.");
    }
    return sendError(reply, status, "bad_request", "Pedido inválido. Confira os dados e tente de novo.");
  });

  registerHealth(app, config, fetchImpl);
  registerSession(app, config);
  const lrclib = createLrclibClient({ baseUrl: config.lrclibUrl, fetch: fetchImpl });
  registerTracks(app, config, lrclib);
  registerMedia(app, config);
  registerTranslation(app, config);
  registerLab(app);
  registerPages(app, config, overrides.templates ?? loadTemplates(config.webDir));

  return app;
}
