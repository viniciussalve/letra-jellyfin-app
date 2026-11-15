import { join } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { LANGUAGES } from "../../shared/languages.ts";
import type { PlayerData } from "../../shared/types.ts";
import { getSession } from "../auth.ts";
import type { Config } from "../config.ts";
import { toTrack, toTrackDTO } from "../jellyfin/mapper.ts";
import { renderPlayerPage, renderUploadPage } from "../lib/render.ts";
import { isWebDirAvailable, serveStaticFile } from "../lib/static.ts";

export type Templates = { upload: string; player: string };

const HTML = "text/html; charset=utf-8";

export function registerPages(app: FastifyInstance, config: Config, templates: Templates | null): void {
  const assetsDir = join(config.webDir, "assets");
  app.get<{ Params: { "*": string } }>("/assets/*", async (req, reply) => {
    const relPath = req.params["*"] ?? "";
    return serveStaticFile(reply, assetsDir, relPath, { immutable: true });
  });

  const notBuilt = (_req: unknown, reply: FastifyReply) =>
    reply.code(503).type("text/plain; charset=utf-8").send("Front-end not built. Run npm run build.");

  const hasWeb = (reply: FastifyReply): boolean => {
    if (templates === null || !isWebDirAvailable(config.webDir)) {
      notBuilt(null, reply);
      return false;
    }
    return true;
  };

  app.get("/", async (_req, reply) => {
    if (!hasWeb(reply)) return reply;
    return reply.type(HTML).send(renderUploadPage(templates!.upload));
  });

  // With or without the trailing slash, as the page's own router accepts both.
  const savedPage = async (_req: unknown, reply: FastifyReply) => {
    if (!hasWeb(reply)) return reply;
    return reply.type(HTML).send(renderUploadPage(templates!.upload, "Linhas salvas — letra"));
  };
  app.get("/salvas", savedPage);
  app.get("/salvas/", savedPage);

  app.get<{ Params: { id: string } }>("/t/:id", async (req, reply) => {
    if (!hasWeb(reply)) return reply;
    const token = getSession(req, app.sessionSecret)?.accessToken ?? config.jellyfinApiKey;
    let data: PlayerData = null;
    if (token) {
      try {
        const item = await app.jellyfin.getAudioItem(token, req.params.id);
        if (item) {
          let lyrics = null;
          try {
            lyrics = await app.jellyfin.getLyrics(token, req.params.id);
          } catch {
            // Degrade gracefully: render player without lyrics if upstream /Lyrics fails.
          }
          data = {
            track: toTrackDTO(toTrack(item, lyrics), config.publicUrl),
            translationEnabled: app.translation.enabled,
            languages: LANGUAGES,
          };
        }
      } catch {
        // Degrade gracefully on HTML route instead of leaking JSON error.
      }
    }
    return reply.code(data ? 200 : 404).type(HTML).send(renderPlayerPage(templates!.player, data, config));
  });
}
