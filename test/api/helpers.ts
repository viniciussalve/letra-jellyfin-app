import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../../server/app.ts";
import { loadConfig } from "../../server/config.ts";
import type { Translator } from "../../server/lib/translate/types.ts";
import { startMockJellyfin, type MockJellyfinServer } from "../e2e-jellyfin/mock-jellyfin.ts";

export type TestApp = Awaited<ReturnType<typeof makeApp>>;

export type FetchStub = (url: string, init?: RequestInit) => Response | Promise<Response>;
export const notFound: FetchStub = () => new Response("{}", { status: 404 });

export async function makeApp(
  opts: {
    env?: Record<string, string | undefined>;
    fetch?: FetchStub;
    templates?: { upload: string; player: string };
    translators?: Translator[];
    withLibraryDir?: boolean;
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "letra-api-"));
  const libraryDir = mkdtempSync(join(tmpdir(), "letra-lib-"));
  const webDir = mkdtempSync(join(tmpdir(), "letra-web-"));
  mkdirSync(join(webDir, "upload"), { recursive: true });
  mkdirSync(join(webDir, "player"), { recursive: true });
  mkdirSync(join(webDir, "assets"), { recursive: true });
  writeFileSync(join(webDir, "upload", "index.html"), "<html><head><!--letra:head--></head><body></body></html>", "utf8");
  writeFileSync(join(webDir, "player", "index.html"), "<html><head><!--letra:head--></head><body><!--letra:data--></body></html>", "utf8");
  writeFileSync(join(webDir, "assets", "app.js"), "console.log('ok');", "utf8");

  const jf: MockJellyfinServer = await startMockJellyfin({ libraryDir });
  const stub = opts.fetch ?? notFound;
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(jf.url)) {
      return realFetch(input, init);
    }
    calls.push(url);
    return stub(url, init);
  }) as typeof fetch;

  const templates = opts.templates ?? {
    upload: "<html><head><!--letra:head--></head><body></body></html>",
    player: "<html><head><!--letra:head--></head><body><!--letra:data--></body></html>",
  };

  const env: Record<string, string | undefined> = {
    JELLYFIN_URL: jf.url,
    JELLYFIN_API_KEY: jf.apiKey,
    JELLYFIN_LIBRARY_DIR: opts.withLibraryDir === false ? "" : libraryDir,
    DATA_DIR: dir,
    WEB_DIR: webDir,
    SESSION_SECRET: "api-test-session-secret-32-chars!!",
    ...opts.env,
  };

  const app = await buildApp(loadConfig(env), {
    fetch: fetchImpl,
    templates,
    translators: opts.translators,
  });

  const login = await app.inject({
    method: "POST",
    url: "/api/session",
    payload: { username: "jelly", password: "jelly-pass" },
  });
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;

  const close = async () => {
    await app.close();
    await jf.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(libraryDir, { recursive: true, force: true });
    rmSync(webDir, { recursive: true, force: true });
  };

  return { app, dir, libraryDir, webDir, cookie, calls, jf, close };
}

export function multipartBody(filename: string, content: Buffer, field = "file") {
  const boundary = "----letratest";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, content, tail]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}
