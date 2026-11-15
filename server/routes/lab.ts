import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";

/**
 * A temporary self-check page at /teste/: it measures, on the visitor's own device, key
 * derivation, encrypted audio played through a service worker, and a passkey with the PRF
 * extension. Everything runs in the browser; the server only hands out two static files.
 * It goes away once the accounts design is settled.
 */
export function registerLab(app: FastifyInstance): void {
  const page = readFileSync(new URL("../lab/teste.html", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../lab/sw.js", import.meta.url), "utf8");

  app.get("/teste", async (_req, reply) => reply.redirect("/teste/"));
  app.get("/teste/", async (_req, reply) =>
    reply.type("text/html; charset=utf-8").header("cache-control", "no-store").send(page),
  );
  app.get("/teste/sw.js", async (_req, reply) =>
    reply.type("text/javascript; charset=utf-8").header("cache-control", "no-store").send(worker),
  );
}
