import { describe, expect, it } from "vitest";
import type { Config } from "../../server/config.ts";
import { blockRendering, escapeHtml, renderPlayerPage, renderUploadPage, safeJson } from "../../server/lib/render.ts";

describe("blockRendering", () => {
  const tag = '<script type="module" crossorigin src="/assets/player-abc.js"></script>';
  it("marks the page's module script render-blocking", () => {
    expect(blockRendering(`<head>${tag}</head>`)).toBe('<head><script type="module" blocking="render" crossorigin src="/assets/player-abc.js"></script></head>');
  });
  it("is idempotent and leaves other scripts alone", () => {
    const data = '<script id="letra-data" type="application/json">{}</script>';
    const once = blockRendering(`${data}${tag}`);
    expect(blockRendering(once)).toBe(once);
    expect(once).toContain(data);
  });
  it("marks a module script whatever the order of its attributes", () => {
    expect(blockRendering('<script crossorigin type="module" src="/a.js"></script>')).toContain('blocking="render"');
    expect(blockRendering('<script src="/a.js"></script>')).toBe('<script src="/a.js"></script>');
    const once = blockRendering('<script type="module" src="/a.js"></script>');
    expect(blockRendering(once)).toBe(once);
  });
});

describe("escapeHtml & safeJson", () => {
  it("escapes HTML special characters", () => {
    expect(escapeHtml(`<script>"a" & 'b'</script>`)).toBe("&lt;script&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/script&gt;");
  });

  it("safeJson escapes < and line separators and handles undefined", () => {
    expect(safeJson(undefined)).toBe("null");
    expect(safeJson({ text: "</script>\u2028\u2029" })).toBe('{"text":"\\u003c/script>\\u2028\\u2029"}');
  });
});

describe("renderUploadPage & renderPlayerPage", () => {
  const template = "<html><head><!--letra:head--></head><body><!--letra:data--></body></html>";

  it("renderUploadPage escapes title and inserts robots meta", () => {
    const html = renderUploadPage(template, 'Title <script> $& $1');
    expect(html).toContain("<title>Title &lt;script&gt; $&amp; $1</title>");
    expect(html).toContain('name="robots"');
  });

  it("renderPlayerPage handles null data (404 state)", () => {
    const html = renderPlayerPage(template, null, { publicUrl: "https://example.com" } as Config);
    expect(html).toContain("<title>Música não encontrada — letra</title>");
    expect(html).toContain('<script id="letra-data" type="application/json">null</script>');
  });

  it("renderPlayerPage escapes </script>, HTML attributes, CSS injection, and preserves $&/$1", () => {
    const html = renderPlayerPage(
      template,
      {
        track: {
          id: "4f9b2e1c8a3d4b5e9f0a1b2c3d4e5f60",
          title: 'Title </script><script>alert(1)</script> $& $1',
          artist: 'Artist "quoted" & <tag>',
          album: null,
          durationMs: 1000,
          mime: "audio/mpeg",
          ext: "mp3",
          sizeBytes: 100,
          hasCover: false,
          palette: { mesh: ["#112233", "#223344", "#334455", "#445566;}</style><script>"], scrim: 0.25 },
          lyrics: null,
          lyricsSource: "none",
          lyricsLang: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          shareUrl: "https://example.com/t/4f9b2e1c8a3d4b5e9f0a1b2c3d4e5f60",
        },
        translationEnabled: false,
        languages: [],
      },
      { publicUrl: "https://example.com" } as Config,
    );
    expect(html).not.toContain("</script><script>");
    expect(html).toContain("\\u003c/script>");
    expect(html).toContain("$& $1");
    expect(html).not.toContain("}</style><script>");
  });
});
