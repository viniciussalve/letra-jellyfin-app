import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "./config.ts";
import { sendError } from "./lib/errors.ts";

export const SESSION_COOKIE = "letra_session";
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

export type SessionPayload = {
  accessToken: string;
  userId: string;
  username: string;
};

export type CookieSerializeOptions = {
  maxAge?: number;
  path?: string;
  httpOnly?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
  secure?: boolean;
};

export async function loadSessionSecret(config: Config): Promise<string> {
  if (config.sessionSecret !== null) return config.sessionSecret;
  const file = join(config.dataDir, "session-secret");
  if (existsSync(file)) {
    const saved = readFileSync(file, "utf8").trim();
    if (saved !== "") return saved;
  }
  mkdirSync(config.dataDir, { recursive: true });
  const secret = randomBytes(32).toString("hex");
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export function signSession(payload: SessionPayload, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

export function verifySession(token: string, secret: string): SessionPayload | null {
  if (typeof token !== "string" || typeof secret !== "string" || secret === "") return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || token.indexOf(".", dot + 1) !== -1) return null;

  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (encoded === "" || sig === "") return null;

  const expectedSig = createHmac("sha256", secret).update(encoded).digest("base64url");
  const sigBuf = Buffer.from(sig, "utf8");
  const expectedBuf = Buffer.from(expectedSig, "utf8");
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
    if (parsed === null || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    if (
      typeof obj.accessToken !== "string" ||
      obj.accessToken === "" ||
      typeof obj.userId !== "string" ||
      obj.userId === "" ||
      typeof obj.username !== "string" ||
      obj.username === ""
    ) {
      return null;
    }
    return {
      accessToken: obj.accessToken,
      userId: obj.userId,
      username: obj.username,
    };
  } catch {
    return null;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    if (key === "") continue;
    let raw = part.slice(eq + 1).trim();
    if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
      raw = raw.slice(1, -1);
    }
    try {
      out[key] = decodeURIComponent(raw);
    } catch {
      out[key] = raw;
    }
  }
  return out;
}

export function serializeCookie(name: string, value: string, opts: CookieSerializeOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path ?? "/"}`];
  if (opts.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.floor(opts.maxAge)}`);
  }
  if (opts.httpOnly !== false) {
    parts.push("HttpOnly");
  }
  parts.push(`SameSite=${opts.sameSite ?? "Lax"}`);
  if (opts.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function setSessionCookie(reply: FastifyReply, payload: SessionPayload, secret: string, secure = false): void {
  const token = signSession(payload, secret);
  reply.header(
    "set-cookie",
    serializeCookie(SESSION_COOKIE, token, {
      maxAge: SESSION_MAX_AGE,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure,
    }),
  );
}

export function clearSessionCookie(reply: FastifyReply, secure = false): void {
  reply.header(
    "set-cookie",
    serializeCookie(SESSION_COOKIE, "", {
      maxAge: 0,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure,
    }),
  );
}

export function getSession(req: FastifyRequest, secret: string): SessionPayload | null {
  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies[SESSION_COOKIE];
  if (!raw) return null;
  return verifySession(raw, secret);
}

export function requireSession(secret: string) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> => {
    const session = getSession(req, secret);
    if (session) return undefined;
    return sendError(reply, 401, "unauthorized", "Entre para continuar.");
  };
}
