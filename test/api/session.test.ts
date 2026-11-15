import { describe, expect, test } from "vitest";
import { makeApp } from "./helpers.ts";

describe("session", () => {
  test("GET /api/session reports unauthenticated before login and authenticated after", async () => {
    const { app, cookie, close } = await makeApp();
    try {
      const anon = await app.inject({ method: "GET", url: "/api/session" });
      expect(anon.statusCode).toBe(200);
      expect(anon.json()).toMatchObject({
        authenticated: false,
        owner: false,
        userId: null,
        username: null,
        libraryUploadEnabled: true,
      });

      const authed = await app.inject({ method: "GET", url: "/api/session", headers: { cookie } });
      expect(authed.statusCode).toBe(200);
      expect(authed.json()).toMatchObject({
        authenticated: true,
        owner: true,
        userId: "user-1",
        username: "jelly",
        libraryUploadEnabled: true,
      });
    } finally {
      await close();
    }
  });

  test("POST /api/session validates Jellyfin credentials and sets HttpOnly signed cookie", async () => {
    const { app, close } = await makeApp();
    try {
      const missing = await app.inject({ method: "POST", url: "/api/session", payload: { username: "jelly" } });
      expect(missing.statusCode).toBe(400);

      const bad = await app.inject({
        method: "POST",
        url: "/api/session",
        payload: { username: "jelly", password: "wrong" },
      });
      expect(bad.statusCode).toBe(401);

      const ok = await app.inject({
        method: "POST",
        url: "/api/session",
        payload: { username: "jelly", password: "jelly-pass" },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ authenticated: true, owner: true, username: "jelly" });
      expect(String(ok.headers["set-cookie"])).toContain("HttpOnly");
      expect(String(ok.headers["set-cookie"])).toContain("letra_session=");
    } finally {
      await close();
    }
  });

  test("DELETE /api/session clears cookie", async () => {
    const { app, cookie, close } = await makeApp();
    try {
      const del = await app.inject({ method: "DELETE", url: "/api/session", headers: { cookie } });
      expect(del.statusCode).toBe(204);
      expect(String(del.headers["set-cookie"])).toContain("Max-Age=0");
    } finally {
      await close();
    }
  });

  test("POST /api/session is rate-limited after 5 attempts", async () => {
    const { app, close } = await makeApp();
    try {
      for (let i = 0; i < 4; i++) {
        await app.inject({
          method: "POST",
          url: "/api/session",
          payload: { username: "jelly", password: "wrong" },
        });
      }
      // 1 from makeApp + 4 above = 5; 6th hits rate limit
      const limited = await app.inject({
        method: "POST",
        url: "/api/session",
        payload: { username: "jelly", password: "wrong" },
      });
      expect(limited.statusCode).toBe(429);
    } finally {
      await close();
    }
  });
});
