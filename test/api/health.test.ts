import { describe, expect, test } from "vitest";
import { makeApp } from "./helpers.ts";

describe("health", () => {
  test("GET /healthz returns 200 ok when Jellyfin is reachable", async () => {
    const { app, close } = await makeApp();
    try {
      const res = await app.inject({ method: "GET", url: "/healthz" });
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe("ok");
      expect(res.headers["content-type"]).toContain("text/plain");
    } finally {
      await close();
    }
  });

  test("GET /healthz returns 503 unavailable when Jellyfin is unreachable", async () => {
    const { app, close } = await makeApp({ env: { JELLYFIN_URL: "http://127.0.0.1:1" } });
    try {
      const res = await app.inject({ method: "GET", url: "/healthz" });
      expect(res.statusCode).toBe(503);
      expect(res.body).toBe("unavailable");
    } finally {
      await close();
    }
  });
});
