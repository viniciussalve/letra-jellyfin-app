import type { FastifyInstance } from "fastify";
import { LANGUAGES } from "../../shared/languages.ts";
import type { LineTranslationDTO, TranslationDTO } from "../../shared/types.ts";
import { getSession } from "../auth.ts";
import type { Config } from "../config.ts";
import { toTrack } from "../jellyfin/mapper.ts";
import { AppError } from "../lib/errors.ts";
import { TranslationError } from "../lib/translate/types.ts";

// Public, and each miss is a paid engine call: cap it per client IP.
const RATE_LIMIT = {
  max: 30,
  timeWindow: "1 minute",
  errorResponseBuilder: () => new AppError(429, "too_many_requests", "Muitas requisições. Espere um minuto e tente de novo."),
};

export function registerTranslation(app: FastifyInstance, config: Config): void {
  const resolveTrack = async (token: string | null, id: string) => {
    if (!token) throw new AppError(401, "unauthorized", "Entre para continuar.");
    const item = await app.jellyfin.getAudioItem(token, id);
    if (!item) throw new AppError(404, "not_found", "Música não encontrada.");
    const lyrics = await app.jellyfin.getLyrics(token, id);
    return toTrack(item, lyrics);
  };

  app.get<{ Params: { id: string }; Querystring: { lang?: string } }>(
    "/api/tracks/:id/translation",
    { config: { rateLimit: RATE_LIMIT } },
    async (req): Promise<TranslationDTO> => {
      if (!app.translation.enabled) throw new AppError(404, "translation_off", "Tradução desativada.");
      const lang = req.query.lang;
      if (typeof lang !== "string" || !LANGUAGES.some((l) => l.code === lang)) {
        throw new AppError(400, "bad_language", "Idioma não suportado.");
      }
      const token = getSession(req, app.sessionSecret)?.accessToken ?? config.jellyfinApiKey;
      const track = await resolveTrack(token, req.params.id);
      if (!track.lyrics || track.lyrics.instrumental || !track.lyrics.lines.some((l) => l.text.trim() !== "")) {
        throw new AppError(404, "no_lyrics", "Esta música não tem letra para traduzir.");
      }
      try {
        return await app.translation.translate(track, lang);
      } catch (err) {
        if (err instanceof TranslationError) throw new AppError(503, "translation_unavailable", "Tradução indisponível agora.");
        throw err;
      }
    },
  );

  // Its own count of requests (each miss is an engine call), same numbers as above.
  app.get<{ Params: { id: string }; Querystring: { index?: unknown; lang?: unknown; text?: unknown } }>(
    "/api/tracks/:id/translation/line",
    { config: { rateLimit: RATE_LIMIT } },
    async (req): Promise<LineTranslationDTO> => {
      if (!app.translation.enabled) throw new AppError(404, "translation_off", "Tradução desativada.");
      const { index: rawIndex, lang, text } = req.query;
      if (typeof lang !== "string" || !LANGUAGES.some((l) => l.code === lang)) {
        throw new AppError(400, "bad_language", "Idioma não suportado.");
      }
      if (typeof rawIndex !== "string" || !/^\d{1,6}$/.test(rawIndex) || typeof text !== "string" || text.trim() === "") {
        throw new AppError(400, "bad_request", "Pedido inválido. Confira os dados e tente de novo.");
      }
      const token = getSession(req, app.sessionSecret)?.accessToken ?? config.jellyfinApiKey;
      const track = await resolveTrack(token, req.params.id);
      // The line at `index` when its text matches; else the first line with this text.
      const lines = track.lyrics?.lines ?? [];
      const index = Number(rawIndex);
      const at = lines[index]?.text === text ? index : lines.findIndex((l) => l.text === text);
      if (at < 0) throw new AppError(404, "line_changed", "Esta linha mudou na música e não pode ser traduzida.");
      try {
        return await app.translation.translateLine(track, at, lang);
      } catch (err) {
        if (err instanceof TranslationError) throw new AppError(503, "translation_unavailable", "Tradução indisponível agora.");
        throw err;
      }
    },
  );
}
