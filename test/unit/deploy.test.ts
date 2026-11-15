import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const read = (name: string) => readFileSync(new URL(`../../${name}`, import.meta.url), "utf8");

test("Dockerfile declares no VOLUME (Railway rejects the instruction)", () => {
  expect(read("Dockerfile")).not.toMatch(/^\s*VOLUME\b/im);
});

test("railway.json builds the Dockerfile and checks /healthz", () => {
  const config = JSON.parse(read("railway.json"));
  expect(config.build.builder).toBe("DOCKERFILE");
  expect(config.build.watchPatterns).toEqual(["/**"]);
  expect(config.deploy.healthcheckPath).toBe("/healthz");
});

test("the hymt profile runs the pinned server with the model in a named volume", () => {
  const compose = read("docker-compose.yml");
  const start = compose.indexOf("\n  hymt:");
  expect(start).toBeGreaterThan(-1);
  const rest = compose.slice(start + 1);
  const end = rest.search(/\n(?:  )?\S/m);
  const block = rest.slice(0, end === -1 ? undefined : end + 1);
  expect(block).toContain('profiles: ["hymt"]');
  expect(block).toContain("image: ghcr.io/ggml-org/llama.cpp:server-b12242");
  expect(block).toContain(
    "https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF/resolve/main/Hy-MT2-1.8B-Q4_K_M.gguf",
  );
  expect(block).toMatch(/^\s+- hymt-models:\/models$/m);
  expect(compose).toMatch(/^volumes:\n(?:  .*\n)*?  hymt-models:/m);
});

test("the app service passes the chat engine's variables through", () => {
  const compose = read("docker-compose.yml");
  const start = compose.indexOf("\n  app:");
  const end = compose.indexOf("\n  libretranslate:");
  const app = compose.slice(start, end);
  for (const name of [
    "TRANSLATE_API_URL",
    "TRANSLATE_API_KEY",
    "TRANSLATE_MODEL",
    "TRANSLATE_DETECT_LANGUAGE",
  ]) {
    expect(app).toMatch(new RegExp(`^\\s+- ${name}$`, "m"));
  }
});

test(".env.example names every translation variable", () => {
  const env = read(".env.example");
  expect(env).toContain("# auto | claude | chat | libretranslate | fake | off");
  for (const name of [
    "TRANSLATE_API_URL",
    "TRANSLATE_API_KEY",
    "TRANSLATE_MODEL",
    "TRANSLATE_DETECT_LANGUAGE",
  ]) {
    expect(env).toMatch(new RegExp(`^${name}=`, "m"));
  }
});
