import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { isWebDirAvailable, mimeTypeFor, serveStaticFile } from "../../server/lib/static.ts";

describe("static", () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "letra-static-"));
    outside = mkdtempSync(join(tmpdir(), "letra-outside-"));
    mkdirSync(join(root, "assets"), { recursive: true });
    writeFileSync(join(root, "assets", "app.js"), "console.log('hi');", "utf8");
    writeFileSync(join(root, "assets", "style.css"), "body{}", "utf8");
    writeFileSync(join(root, "assets", "logo.svg"), "<svg></svg>", "utf8");
    writeFileSync(join(root, "assets", "data.bin"), Buffer.from([1, 2, 3]));
    writeFileSync(join(outside, "secret.txt"), "top-secret", "utf8");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  test("mimeTypeFor maps standard extensions and falls back to application/octet-stream", () => {
    expect(mimeTypeFor("main.js")).toBe("application/javascript; charset=utf-8");
    expect(mimeTypeFor("mod.mjs")).toBe("application/javascript; charset=utf-8");
    expect(mimeTypeFor("app.css")).toBe("text/css; charset=utf-8");
    expect(mimeTypeFor("index.html")).toBe("text/html; charset=utf-8");
    expect(mimeTypeFor("icon.svg")).toBe("image/svg+xml");
    expect(mimeTypeFor("cover.png")).toBe("image/png");
    expect(mimeTypeFor("cover.jpg")).toBe("image/jpeg");
    expect(mimeTypeFor("cover.jpeg")).toBe("image/jpeg");
    expect(mimeTypeFor("cover.webp")).toBe("image/webp");
    expect(mimeTypeFor("font.woff2")).toBe("font/woff2");
    expect(mimeTypeFor("meta.json")).toBe("application/json; charset=utf-8");
    expect(mimeTypeFor("unknown.xyz")).toBe("application/octet-stream");
  });

  test("isWebDirAvailable detects existing vs missing directories", () => {
    expect(isWebDirAvailable(root)).toBe(true);
    expect(isWebDirAvailable(join(root, "missing"))).toBe(false);
    expect(isWebDirAvailable(join(root, "assets", "app.js"))).toBe(false);
  });

  test("serveStaticFile serves files with MIME types and immutable cache headers", async () => {
    const app = Fastify();
    app.get<{ Params: { "*": string } }>("/assets/*", (req, reply) =>
      serveStaticFile(reply, join(root, "assets"), req.params["*"] ?? "", { immutable: true }),
    );

    const js = await app.inject({ method: "GET", url: "/assets/app.js" });
    expect(js.statusCode).toBe(200);
    expect(js.headers["content-type"]).toBe("application/javascript; charset=utf-8");
    expect(js.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(js.body).toBe("console.log('hi');");

    const bin = await app.inject({ method: "GET", url: "/assets/data.bin" });
    expect(bin.statusCode).toBe(200);
    expect(bin.headers["content-type"]).toBe("application/octet-stream");

    const missing = await app.inject({ method: "GET", url: "/assets/missing.js" });
    expect(missing.statusCode).toBe(404);

    await app.close();
  });

  test("serveStaticFile rejects path traversal, null bytes, and escaping symlinks", async () => {
    symlinkSync(join(outside, "secret.txt"), join(root, "assets", "escape.txt"));

    const app = Fastify();
    app.get<{ Params: { "*": string } }>("/assets/*", (req, reply) =>
      serveStaticFile(reply, join(root, "assets"), req.params["*"] ?? "", { immutable: true }),
    );

    // Direct call verifies serveStaticFile's own traversal guard (Fastify normalizes .. before routing).
    let capturedCode = 0;
    const mockReply = {
      code(c: number) { capturedCode = c; return this; },
      type() { return this; },
      header() { return this; },
      send() { return this; },
    } as unknown as import("fastify").FastifyReply;
    serveStaticFile(mockReply, join(root, "assets"), "../secret.txt");
    expect(capturedCode).toBe(403);

    const nullByte = await app.inject({ method: "GET", url: "/assets/app.js%00.png" });
    expect(nullByte.statusCode).toBe(403);

    const symlink = await app.inject({ method: "GET", url: "/assets/escape.txt" });
    expect(symlink.statusCode).toBe(403);

    await app.close();
  });
});
