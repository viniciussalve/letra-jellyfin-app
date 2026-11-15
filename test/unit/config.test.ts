import { expect, test } from "vitest";
import { loadConfig } from "../../server/config.ts";

const base = { JELLYFIN_URL: "https://jf.example.com" };

test("requires JELLYFIN_URL", () => expect(() => loadConfig({})).toThrow(/JELLYFIN_URL/));
test("treats an empty, blank, or invalid JELLYFIN_URL as invalid", () => {
  expect(() => loadConfig({ JELLYFIN_URL: "" })).toThrow(/JELLYFIN_URL/);
  expect(() => loadConfig({ JELLYFIN_URL: "   " })).toThrow(/JELLYFIN_URL/);
  expect(() => loadConfig({ JELLYFIN_URL: "jf.example.com" })).toThrow(/JELLYFIN_URL/);
  expect(() => loadConfig({ JELLYFIN_URL: "ftp://jf.example.com" })).toThrow(/JELLYFIN_URL/);
  expect(() => loadConfig({ JELLYFIN_URL: "https://user:pass@jf.example.com" })).toThrow(/JELLYFIN_URL/);
});

test("defaults", () => {
  const c = loadConfig(base);
  expect(c).toMatchObject({
    jellyfinUrl: "https://jf.example.com",
    jellyfinApiKey: null,
    jellyfinLibraryDir: null,
    publicUrl: "http://localhost:3000",
    dataDir: "/data",
    port: 3000,
    maxUploadBytes: 100 * 1048576,
    translator: "auto",
    anthropicModel: "claude-opus-5-5",
    lrclibUrl: "https://lrclib.net",
    sessionSecret: null,
    clientIpHeader: null,
  });
});

test("strips trailing slashes from JELLYFIN_URL and PUBLIC_URL and reads optional Jellyfin vars", () => {
  const c = loadConfig({
    JELLYFIN_URL: "https://jf.example.com///",
    JELLYFIN_API_KEY: " api-key-123 ",
    JELLYFIN_LIBRARY_DIR: " /music ",
    PUBLIC_URL: "https://a.b/",
  });
  expect(c.jellyfinUrl).toBe("https://jf.example.com");
  expect(c.jellyfinApiKey).toBe("api-key-123");
  expect(c.jellyfinLibraryDir).toBe("/music");
  expect(c.publicUrl).toBe("https://a.b");
});

test("rejects unknown TRANSLATOR", () =>
  expect(() => loadConfig({ ...base, TRANSLATOR: "gpt" })).toThrow(/TRANSLATOR/));

test("TRUST_PROXY parsing", () => {
  const t = (v?: string) => loadConfig({ ...base, TRUST_PROXY: v }).trustProxy;
  expect(t()).toBe(false);
  expect(t("")).toBe(false);
  expect(t("true")).toBe(true);
  expect(t("1")).toBe(1);
  expect(t("10.0.0.1, 10.0.0.2")).toEqual(["10.0.0.1", "10.0.0.2"]);
});

test("PUBLIC_URL falls back to the Railway domain", () => {
  const railway = { ...base, RAILWAY_PUBLIC_DOMAIN: "letra.up.railway.app" };
  expect(loadConfig(railway).publicUrl).toBe("https://letra.up.railway.app");
  expect(loadConfig({ ...railway, PUBLIC_URL: "https://musica.example.com" }).publicUrl).toBe("https://musica.example.com");
});

test("CLIENT_IP_HEADER parsing", () => {
  const c = (env: Record<string, string>) => loadConfig({ ...base, ...env }).clientIpHeader;
  expect(c({})).toBe(null);
  expect(c({ CLIENT_IP_HEADER: " X-Client-IP " })).toBe("x-client-ip");
  // Railway's edge sends the client address in X-Real-IP, not X-Forwarded-For.
  expect(c({ RAILWAY_PUBLIC_DOMAIN: "letra.up.railway.app" })).toBe("x-real-ip");
  expect(c({ RAILWAY_PUBLIC_DOMAIN: "letra.up.railway.app", CLIENT_IP_HEADER: "cf-connecting-ip" })).toBe("cf-connecting-ip");
  expect(() => c({ CLIENT_IP_HEADER: "not a header" })).toThrow(/CLIENT_IP_HEADER/);
});

test("chat mode and its variables", () => {
  const c = (env: Record<string, string>) => loadConfig({ ...base, ...env });
  expect(c({ TRANSLATOR: "chat" }).translator).toBe("chat");
  const d = c({});
  expect(d.translateApiUrl).toBeNull();
  expect(d.translateApiKey).toBeNull();
  expect(d.translateModel).toBeNull();
  expect(d.translateDetectLanguage).toBe(true);
  expect(c({ TRANSLATE_API_URL: "https://x.test/v1/" }).translateApiUrl).toBe("https://x.test/v1");
  expect(c({ TRANSLATE_API_URL: "https://x.test/v1//" }).translateApiUrl).toBe("https://x.test/v1");
  expect(c({ TRANSLATE_API_KEY: "k", TRANSLATE_MODEL: "m" })).toMatchObject({ translateApiKey: "k", translateModel: "m" });
  expect(c({ TRANSLATE_API_KEY: " ", TRANSLATE_MODEL: "" })).toMatchObject({ translateApiKey: null, translateModel: null });
  expect(c({ TRANSLATE_DETECT_LANGUAGE: "true" }).translateDetectLanguage).toBe(true);
  expect(c({ TRANSLATE_DETECT_LANGUAGE: "false" }).translateDetectLanguage).toBe(false);
  expect(c({ TRANSLATE_DETECT_LANGUAGE: "" }).translateDetectLanguage).toBe(true);
  expect(() => c({ TRANSLATE_DETECT_LANGUAGE: "no" })).toThrow(/TRANSLATE_DETECT_LANGUAGE/);
});

test("the translation URLs and key are checked at startup", () => {
  const c = (env: Record<string, string>) => loadConfig({ ...base, ...env });
  const refused: Array<[string, string]> = [
    ["TRANSLATE_API_URL", "router.huggingface.co/v1"],
    ["TRANSLATE_API_URL", "ftp://x.test/v1"],
    ["TRANSLATE_API_URL", "https://ana:senha@x.test/v1"],
    ["TRANSLATE_API_URL", "https://x.test/v1/chat/completions"],
    ["LIBRETRANSLATE_URL", "https://ana:senha@x.test"],
    ["TRANSLATE_API_KEY", "hf_a\nb"],
    ["TRANSLATE_API_KEY", "hf_a b"],
  ];
  for (const [name, value] of refused) {
    let err: unknown;
    try {
      c({ [name]: value });
    } catch (e) {
      err = e;
    }
    expect(err, `${name}=${JSON.stringify(value)}`).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toContain(name);
    expect(message).not.toContain(value);
    if (value.includes("senha")) expect(message).not.toContain("senha");
  }
  expect(c({ TRANSLATE_API_URL: "https://x.test/v1/" }).translateApiUrl).toBe("https://x.test/v1");
  expect(c({ TRANSLATE_API_URL: "http://hymt:8080/v1" }).translateApiUrl).toBe("http://hymt:8080/v1");
  expect(c({ LIBRETRANSLATE_URL: "http://libretranslate:5000" }).libretranslateUrl).toBe("http://libretranslate:5000");
  expect(c({ TRANSLATE_API_KEY: "hf_AbC-123_xyz" }).translateApiKey).toBe("hf_AbC-123_xyz");
});

test("validates PUBLIC_URL, LRCLIB_URL, and PORT", () => {
  expect(() => loadConfig({ ...base, PUBLIC_URL: "javascript:alert(1)" })).toThrow(/PUBLIC_URL/);
  expect(() => loadConfig({ ...base, LRCLIB_URL: "ftp://user:pass@x.test" })).toThrow(/LRCLIB_URL/);
  expect(() => loadConfig({ ...base, PORT: "3000.5" })).toThrow(/PORT/);
  expect(() => loadConfig({ ...base, PORT: "70000" })).toThrow(/PORT/);
  expect(loadConfig({ ...base, PORT: "8080" }).port).toBe(8080);
});
