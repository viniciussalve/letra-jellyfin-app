import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadSessionSecret,
  parseCookies,
  serializeCookie,
  signSession,
  verifySession,
  type SessionPayload,
} from "../../server/auth.ts";
import { loadConfig } from "../../server/config.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("auth", () => {
  const secret = "a".repeat(64);
  const payload: SessionPayload = {
    accessToken: "jf-token-123",
    userId: "user-1",
    username: "vinicius",
  };

  it("signs and verifies a valid session payload", () => {
    const token = signSession(payload, secret);
    expect(verifySession(token, secret)).toEqual(payload);
  });

  it("rejects tampered, wrong-secret, or malformed tokens", () => {
    const token = signSession(payload, secret);
    const [body, sig] = token.split(".");
    const tamperedBody = Buffer.from(
      JSON.stringify({ ...payload, userId: "admin" }),
      "utf8",
    ).toString("base64url");

    expect(verifySession(`${tamperedBody}.${sig}`, secret)).toBeNull();
    expect(verifySession(`${body}.${sig!.slice(0, -1)}X`, secret)).toBeNull();
    expect(verifySession(token, "b".repeat(64))).toBeNull();
    expect(verifySession("", secret)).toBeNull();
    expect(verifySession("nodot", secret)).toBeNull();
    expect(verifySession(`${body}.${sig}.extra`, secret)).toBeNull();
    expect(verifySession(token, "")).toBeNull();

    const incomplete = signSession({ accessToken: "", userId: "u", username: "a" }, secret);
    expect(verifySession(incomplete, secret)).toBeNull();
  });

  it("parses Cookie headers", () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies("")).toEqual({});
    expect(parseCookies('foo=bar; letra_session="abc%3D123"; empty=; bad=1=2')).toEqual({
      foo: "bar",
      letra_session: "abc=123",
      empty: "",
      bad: "1=2",
    });
  });

  it("serializes cookies with expected attributes", () => {
    expect(
      serializeCookie("letra_session", "a.b", {
        maxAge: 3600,
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
        secure: true,
      }),
    ).toBe("letra_session=a.b; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax; Secure");
  });

  it("loadSessionSecret uses config.sessionSecret or generates and persists one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "letra-auth-"));
    dirs.push(dir);

    const explicit = await loadSessionSecret(
      loadConfig({ JELLYFIN_URL: "https://jf.test", SESSION_SECRET: "my-secret", DATA_DIR: dir }),
    );
    expect(explicit).toBe("my-secret");

    const cfg = loadConfig({ JELLYFIN_URL: "https://jf.test", DATA_DIR: dir });
    const generated = await loadSessionSecret(cfg);
    expect(generated).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(join(dir, "session-secret"))).toBe(true);
    expect(readFileSync(join(dir, "session-secret"), "utf8").trim()).toBe(generated);

    const reloaded = await loadSessionSecret(cfg);
    expect(reloaded).toBe(generated);
  });
});
