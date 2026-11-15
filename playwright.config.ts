import { defineConfig, devices } from "@playwright/test";

// The E2E server (test/e2e/server.ts) serves the built front end from dist/web,
// so run `vite build` first; the test:e2e script does. Three servers run side by side:
// the main one with the fake translator, one with translation switched off, and one
// whose PUBLIC_URL is https:// while the browser reaches it over plain http.
const MAIN_PORT = 4321;
const OFF_PORT = 4322;
const INSECURE_PORT = 4323;
const url = (port: number) => `http://127.0.0.1:${port}`;
// Chromium keeps Secure cookies on loopback over http; under this name it does not.
const INSECURE_HOST = "letra.test";

const server = (port: number, translator: string, env: Record<string, string> = {}) => ({
  command: "node test/e2e/server.ts",
  url: `${url(port)}/healthz`,
  env: { E2E_PORT: String(port), E2E_TRANSLATOR: translator, ...env },
  reuseExistingServer: false,
  stdout: "ignore" as const,
  stderr: "pipe" as const,
  gracefulShutdown: { signal: "SIGTERM" as const, timeout: 5000 },
});

export default defineConfig({
  testDir: "test/e2e",
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: { trace: "off" },
  projects: [
    {
      name: "chromium",
      testIgnore: /(translation-off|insecure-origin)\.spec/,
      use: { ...devices["Desktop Chrome"], baseURL: url(MAIN_PORT) },
    },
    {
      name: "translation-off",
      testMatch: /translation-off\.spec/,
      use: { ...devices["Desktop Chrome"], baseURL: url(OFF_PORT) },
    },
    {
      name: "insecure-origin",
      testMatch: /insecure-origin\.spec/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://${INSECURE_HOST}:${INSECURE_PORT}`,
        launchOptions: { args: [`--host-resolver-rules=MAP ${INSECURE_HOST} 127.0.0.1`] },
      },
    },
  ],
  webServer: [
    server(MAIN_PORT, "fake"),
    server(OFF_PORT, "off"),
    server(INSECURE_PORT, "fake", { E2E_PUBLIC_URL: "https://letra.example.com" }),
  ],
});
