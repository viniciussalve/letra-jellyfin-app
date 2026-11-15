import type { FastifyInstance } from "fastify";
import type { Config } from "../config.ts";

export function registerHealth(
  app: FastifyInstance,
  config: Config,
  fetchFn: typeof fetch = globalThis.fetch,
): void {
  app.get("/healthz", async (_req, reply) => {
    let ok = false;
    try {
      const res = await fetchFn(`${config.jellyfinUrl}/System/Info/Public`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
    return reply.code(ok ? 200 : 503).type("text/plain").send(ok ? "ok" : "unavailable");
  });
}
