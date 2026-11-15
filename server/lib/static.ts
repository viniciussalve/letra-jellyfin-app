import { createReadStream, realpathSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import type { FastifyReply } from "fastify";

const MIME_TYPES: Record<string, string> = {
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
};

export function mimeTypeFor(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

export function isWebDirAvailable(webDir: string): boolean {
  try {
    return statSync(webDir).isDirectory();
  } catch {
    return false;
  }
}

export type ServeStaticOptions = {
  immutable?: boolean;
  cacheControl?: string;
};

function hasTraversalOrNull(relPath: string): boolean {
  if (relPath.includes("\0")) return true;
  const decoded = (() => {
    try {
      return decodeURIComponent(relPath);
    } catch {
      return relPath;
    }
  })();
  if (decoded.includes("\0")) return true;
  const segments = decoded.replace(/\\/g, "/").split("/");
  return segments.some((s) => s === "..");
}

function isWithinRoot(realRoot: string, realTarget: string): boolean {
  if (realTarget === realRoot) return false;
  const prefix = realRoot.endsWith(sep) ? realRoot : `${realRoot}${sep}`;
  return realTarget.startsWith(prefix);
}

/**
 * Serves a static file under `rootDir` using `node:fs`.
 * Rejects path traversal (`..`, null bytes, symlinks escaping `rootDir`) with 403/404.
 */
export function serveStaticFile(
  reply: FastifyReply,
  rootDir: string,
  relPath: string,
  opts: ServeStaticOptions = {},
): FastifyReply {
  const cleaned = relPath.replace(/^\/+/, "");
  if (cleaned === "" || hasTraversalOrNull(cleaned)) {
    return reply.code(403).type("text/plain; charset=utf-8").send("Forbidden");
  }

  let realRoot: string;
  try {
    realRoot = realpathSync(rootDir);
  } catch {
    return reply.code(404).type("text/plain; charset=utf-8").send("Not Found");
  }

  const candidate = resolve(realRoot, cleaned);
  if (!isWithinRoot(realRoot, candidate)) {
    return reply.code(403).type("text/plain; charset=utf-8").send("Forbidden");
  }

  let realFile: string;
  try {
    realFile = realpathSync(candidate);
  } catch {
    return reply.code(404).type("text/plain; charset=utf-8").send("Not Found");
  }

  if (!isWithinRoot(realRoot, realFile)) {
    return reply.code(403).type("text/plain; charset=utf-8").send("Forbidden");
  }

  let size: number;
  try {
    const st = statSync(realFile);
    if (!st.isFile()) {
      return reply.code(404).type("text/plain; charset=utf-8").send("Not Found");
    }
    size = st.size;
  } catch {
    return reply.code(404).type("text/plain; charset=utf-8").send("Not Found");
  }

  const cacheControl =
    opts.cacheControl ??
    (opts.immutable ? "public, max-age=31536000, immutable" : "public, max-age=3600");

  return reply
    .code(200)
    .header("Content-Type", mimeTypeFor(realFile))
    .header("Content-Length", String(size))
    .header("Cache-Control", cacheControl)
    .send(createReadStream(realFile));
}
