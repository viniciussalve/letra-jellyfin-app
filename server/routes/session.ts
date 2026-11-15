import type { FastifyInstance } from "fastify";
import { clearSessionCookie, getSession, setSessionCookie } from "../auth.ts";
import type { Config } from "../config.ts";
import { sendError } from "../lib/errors.ts";

export function registerSession(app: FastifyInstance, config: Config): void {
  const secure = config.publicUrl.startsWith("https://");
  const libraryUploadEnabled = config.jellyfinLibraryDir !== null;

  app.get("/api/session", async (req) => {
    const session = getSession(req, app.sessionSecret);
    if (!session) {
      return {
        authenticated: false,
        owner: false,
        userId: null,
        username: null,
        maxUploadBytes: config.maxUploadBytes,
        libraryUploadEnabled,
      };
    }
    return {
      authenticated: true,
      owner: true,
      userId: session.userId,
      username: session.username,
      maxUploadBytes: config.maxUploadBytes,
      libraryUploadEnabled,
    };
  });

  app.post(
    "/api/session",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
          errorResponseBuilder: () => {
            const err = new Error("Muitas tentativas. Espere um minuto e tente de novo.") as Error & { statusCode: number };
            err.statusCode = 429;
            return err;
          },
        },
      },
    },
    async (req, reply) => {
      const body = req.body as { username?: unknown; password?: unknown } | null | undefined;
      const username = typeof body?.username === "string" ? body.username.trim() : "";
      const password = typeof body?.password === "string" ? body.password : "";
      if (username === "" || password === "") {
        return sendError(reply, 400, "bad_request", "Informe usuário e senha do Jellyfin.");
      }

      const session = await app.jellyfin.authenticateByName(username, password);
      setSessionCookie(
        reply,
        { accessToken: session.accessToken, userId: session.userId, username: session.username },
        app.sessionSecret,
        secure,
      );
      return {
        authenticated: true,
        owner: true,
        userId: session.userId,
        username: session.username,
        maxUploadBytes: config.maxUploadBytes,
        libraryUploadEnabled,
      };
    },
  );

  app.delete("/api/session", async (_req, reply) => {
    clearSessionCookie(reply, secure);
    return reply.code(204).send();
  });
}
