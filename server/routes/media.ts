import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getSession } from "../auth.ts";
import type { Config } from "../config.ts";
import { sendError } from "../lib/errors.ts";

const NOT_FOUND = "Música não encontrada.";

function resolveToken(app: FastifyInstance, req: FastifyRequest, config: Config): string | null {
  return getSession(req, app.sessionSecret)?.accessToken ?? config.jellyfinApiKey;
}

async function sendUpstreamBody(reply: FastifyReply, upstream: Response): Promise<FastifyReply> {
  if (!upstream.body) {
    return reply.send(Buffer.alloc(0));
  }
  const stream = Readable.fromWeb(upstream.body as unknown as import("node:stream/web").ReadableStream);
  return reply.send(stream);
}

export function registerMedia(app: FastifyInstance, config: Config): void {
  app.get<{ Params: { id: string } }>("/media/:id/audio", async (req, reply) => {
    const token = resolveToken(app, req, config);
    if (!token) return sendError(reply, 401, "unauthorized", "Entre para continuar.");

    const range = typeof req.headers.range === "string" ? req.headers.range : undefined;
    const upstream = await app.jellyfin.streamAudio(token, req.params.id, range);

    if (upstream.status === 404) {
      void upstream.body?.cancel();
      return sendError(reply, 404, "not_found", NOT_FOUND);
    }

    reply.code(upstream.status);
    for (const header of ["content-type", "content-length", "content-range", "accept-ranges", "cache-control"]) {
      const val = upstream.headers.get(header);
      if (val !== null) reply.header(header, val);
    }
    if (!upstream.headers.has("accept-ranges")) {
      reply.header("accept-ranges", "bytes");
    }
    return sendUpstreamBody(reply, upstream);
  });

  const handleImage = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const token = resolveToken(app, req, config);
    if (!token) return sendError(reply, 401, "unauthorized", "Entre para continuar.");

    const upstream = await app.jellyfin.getPrimaryImage(token, req.params.id, 1200);
    if (upstream.status === 404 || !upstream.ok) {
      void upstream.body?.cancel();
      return sendError(reply, 404, "not_found", NOT_FOUND);
    }

    reply.code(upstream.status);
    for (const header of ["content-type", "content-length", "cache-control"]) {
      const val = upstream.headers.get(header);
      if (val !== null) reply.header(header, val);
    }
    if (!upstream.headers.has("cache-control")) {
      const scope = config.jellyfinApiKey === null ? "private" : "public";
      reply.header("cache-control", `${scope}, max-age=86400`);
    }
    return sendUpstreamBody(reply, upstream);
  };

  app.get<{ Params: { id: string } }>("/media/:id/cover.jpg", handleImage);
  app.get<{ Params: { id: string } }>("/media/:id/og.jpg", handleImage);
}
