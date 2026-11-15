import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PlayerData } from "../../shared/types.ts";

const E2E_DIR = fileURLToPath(new URL(".", import.meta.url));
export const ROOT_DIR = resolve(E2E_DIR, "../..");
export const FIXTURES_DIR = join(ROOT_DIR, "test/fixtures");
export const DEFAULT_WEB_DIR = join(ROOT_DIR, "dist/web");

export type AppServerOptions = {
  jellyfinUrl: string;
  jellyfinApiKey?: string;
  jellyfinLibraryDir?: string;
  lrclibUrl?: string;
  webDir?: string;
  translator?: string;
  sessionSecret?: string;
  publicUrl?: string;
  env?: Record<string, string>;
};

export type AppServerHandle = {
  baseUrl: string;
  port: number;
  dataDir: string;
  libraryDir: string;
  stop: () => Promise<void>;
};

function getFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createNetServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close(() => reject(new Error("Could not allocate ephemeral port")));
        return;
      }
      const { port } = addr;
      srv.close((err) => (err ? reject(err) : resolvePort(port)));
    });
  });
}

async function waitForReady(baseUrl: string, proc: ChildProcess, logs: () => string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`server/index.ts exited early with code ${proc.exitCode}\n${logs()}`);
    }
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      if (res.status > 0) return;
    } catch {
      // Server not listening yet
    }
    await new Promise((r) => setTimeout(r, 80));
  }
  throw new Error(`Timed out waiting for ${baseUrl}/healthz\n${logs()}`);
}

export async function startAppServer(opts: AppServerOptions): Promise<AppServerHandle> {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const dataDir = mkdtempSync(join(tmpdir(), "letra-jf-data-"));
  const libraryDir = opts.jellyfinLibraryDir ?? mkdtempSync(join(tmpdir(), "letra-jf-lib-"));
  const createdLibDir = opts.jellyfinLibraryDir === undefined;

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(port),
    PUBLIC_URL: opts.publicUrl ?? baseUrl,
    JELLYFIN_URL: opts.jellyfinUrl,
    JELLYFIN_API_KEY: opts.jellyfinApiKey ?? "mock-jellyfin-api-key",
    JELLYFIN_LIBRARY_DIR: libraryDir,
    LRCLIB_URL: opts.lrclibUrl ?? "http://127.0.0.1:1",
    DATA_DIR: dataDir,
    WEB_DIR: opts.webDir ?? DEFAULT_WEB_DIR,
    TRANSLATOR: opts.translator ?? "fake",
    TRUST_PROXY: "true",
    SESSION_SECRET: opts.sessionSecret ?? "e2e-test-session-secret-32-chars!",
    ...opts.env,
  };

  let output = "";
  const proc = spawn(process.execPath, ["server/index.ts"], {
    cwd: ROOT_DIR,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
  });
  proc.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
  });

  try {
    await waitForReady(baseUrl, proc, () => output);
  } catch (err) {
    proc.kill("SIGKILL");
    rmSync(dataDir, { recursive: true, force: true });
    if (createdLibDir) rmSync(libraryDir, { recursive: true, force: true });
    throw err;
  }

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    if (proc.exitCode === null) {
      proc.kill("SIGTERM");
      await new Promise<void>((resolveExit) => {
        const timer = setTimeout(() => {
          proc.kill("SIGKILL");
          resolveExit();
        }, 3000);
        proc.once("exit", () => {
          clearTimeout(timer);
          resolveExit();
        });
      });
    }
    rmSync(dataDir, { recursive: true, force: true });
    if (createdLibDir) rmSync(libraryDir, { recursive: true, force: true });
  };

  return { baseUrl, port, dataDir, libraryDir, stop };
}

let ipCounter = 10;
export function nextClientIp(): string {
  ipCounter += 1;
  const a = (ipCounter >> 8) & 0xff;
  const b = ipCounter & 0xff;
  return `10.99.${a}.${b}`;
}

export async function loginAs(
  baseUrl: string,
  username: string,
  password: string,
  opts: { ip?: string } = {},
): Promise<{ response: Response; cookie: string | null; body: unknown }> {
  const ip = opts.ip ?? nextClientIp();
  const response = await fetch(`${baseUrl}/api/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify({ username, password }),
  });
  const setCookie = response.headers.get("set-cookie");
  const cookie = setCookie ? setCookie.split(";")[0] : null;
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { response, cookie, body };
}

export type MultipartFilePart = {
  field: string;
  filename: string;
  contentType: string;
  data: Buffer;
};

export function multipartBody(
  fields: Record<string, string>,
  files: MultipartFilePart[],
): { body: Uint8Array<ArrayBuffer>; contentType: string } {
  const boundary = `----LetraBoundary${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];

  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        "utf8",
      ),
    );
  }

  for (const file of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
        "utf8",
      ),
    );
    chunks.push(file.data);
    chunks.push(Buffer.from("\r\n", "utf8"));
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
  const merged = Buffer.concat(chunks);
  const body = new Uint8Array(new ArrayBuffer(merged.length));
  body.set(merged);
  return {
    body,
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

export function parsePlayerData(html: string): PlayerData {
  const match = /<script\s+id="letra-data"\s+type="application\/json">([\s\S]*?)<\/script>/i.exec(html);
  if (!match) {
    throw new Error("Missing <script id=\"letra-data\" type=\"application/json\"> in HTML");
  }
  const decoded = match[1].replace(/\\u003c/gi, "<");
  return JSON.parse(decoded) as PlayerData;
}

export function loadFixture(filename: string): Buffer {
  return readFileSync(join(FIXTURES_DIR, filename));
}

export function loadSampleLrc(): string {
  return readFileSync(join(FIXTURES_DIR, "sample.lrc"), "utf8");
}
