// E2E server: an LRCLIB stub plus the app on a fresh temp DATA_DIR, serving the
// built front end (dist/web). Started by playwright.config.ts; removes its data on exit.
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../../server/app.ts";
import { loadConfig } from "../../server/config.ts";
import type { LrclibRecord } from "../../server/lib/lyrics/lrclib.ts";
import { startMockJellyfin } from "../e2e-jellyfin/mock-jellyfin.ts";

const PORT = Number(process.env.E2E_PORT ?? "4321");
const BASE_URL = `http://127.0.0.1:${PORT}`;

const record = (trackName: string, fields: Partial<LrclibRecord>): LrclibRecord => ({
  id: 1,
  trackName,
  artistName: "Letra Fixtures",
  albumName: null,
  duration: 8,
  instrumental: false,
  plainLyrics: null,
  syncedLyrics: null,
  ...fields,
});

// Keyed on the track title, which comes from the uploaded file name when tags are missing.
const RECORDS: Record<string, LrclibRecord> = {
  "Sem Tags": record("Sem Tags", {
    syncedLyrics: ["[00:00.50]Verso do LRCLIB um", "[00:03.00]Verso do LRCLIB dois", "[00:05.50]Verso do LRCLIB três"].join("\n"),
    plainLyrics: ["Verso do LRCLIB um", "Verso do LRCLIB dois", "Verso do LRCLIB três"].join("\n"),
  }),
  "Intro Longa": record("Intro Longa", {
    syncedLyrics: ["[00:04.00]Primeiro verso depois da introdução", "[00:06.00]Segundo verso"].join("\n"),
  }),
  "Instrumental Teste": record("Instrumental Teste", { instrumental: true }),
};

function startLrclibStub(): Promise<Server> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://stub");
    const rawName = url.searchParams.get("track_name") ?? "";
    const found = RECORDS[rawName] ?? RECORDS[rawName.replace(/-[0-9A-Za-z_-]{6}$/, "")];
    res.setHeader("content-type", "application/json");
    if (url.pathname === "/api/search") {
      res.end(JSON.stringify(found ? [found] : []));
    } else if (url.pathname === "/api/get" && found) {
      res.end(JSON.stringify(found));
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ code: 404, name: "TrackNotFound" }));
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const dataDir = mkdtempSync(join(tmpdir(), "letra-e2e-"));
const removeData = () => rmSync(dataDir, { recursive: true, force: true });
process.on("exit", removeData);

const stub = await startLrclibStub();
const stubAddress = stub.address();
if (stubAddress === null || typeof stubAddress === "string") throw new Error("LRCLIB stub has no port");

const mockJellyfin = process.env.JELLYFIN_URL ? null : await startMockJellyfin({ libraryDir: dataDir });
const jellyfinUrl = process.env.JELLYFIN_URL ?? mockJellyfin!.url;

// Only these variables reach the app, so a developer's own keys never leak in.
const config = loadConfig({
  JELLYFIN_URL: jellyfinUrl,
  JELLYFIN_API_KEY: process.env.JELLYFIN_API_KEY ?? mockJellyfin?.apiKey,
  JELLYFIN_LIBRARY_DIR: process.env.JELLYFIN_LIBRARY_DIR ?? dataDir,
  DATA_DIR: dataDir,
  TRANSLATOR: process.env.E2E_TRANSLATOR ?? "fake",
  LRCLIB_URL: `http://127.0.0.1:${stubAddress.port}`,
  // An https:// address here makes the session cookie Secure (insecure-origin.spec.ts).
  PUBLIC_URL: process.env.E2E_PUBLIC_URL ?? BASE_URL,
  WEB_DIR: fileURLToPath(new URL("../../dist/web", import.meta.url)),
  // The login limit is 5/min per IP. Trusting X-Forwarded-For from loopback lets
  // test/e2e/helpers.ts give every API login its own address; browser logins
  // (no header) still share 127.0.0.1.
  TRUST_PROXY: "loopback",
});
const app = await buildApp(config);
await app.listen({ host: "127.0.0.1", port: PORT });

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  await app.close().catch(() => {});
  await mockJellyfin?.close().catch(() => {});
  stub.close();
  process.exit(0); // the exit handler removes the data dir
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
