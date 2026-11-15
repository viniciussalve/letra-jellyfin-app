import type { PlayerData } from "../../shared/types.ts";
import type { Config } from "../config.ts";

const HEAD_MARKER = "<!--letra:head-->";
const DATA_MARKER = "<!--letra:data-->";
const ROBOTS = '<meta name="robots" content="noindex, nofollow">';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** JSON that is safe inside a <script> element: `<` and the JS line separators are escaped. */
export function safeJson(value: unknown): string {
  return (JSON.stringify(value) ?? "null").replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** Palette values are server-made hex strings; strip anything that could end the style block. */
function cssValue(v: string): string {
  return v.replace(/[^#\w.%(),\s-]/g, "");
}

function fill(template: string, head: string, data: string): string {
  // Function replacers keep `$` sequences in the values literal.
  return template.replace(HEAD_MARKER, () => head).replace(DATA_MARKER, () => data);
}

/**
 * Marks the page's module script render-blocking, so the first frame already holds what the
 * script draws (the cover, the tiles): the browser needs it to pair a cross-document view transition.
 */
export function blockRendering(template: string): string {
  return template.replace(/<script\b[^>]*>/g, (tag) =>
    /\btype="module"/.test(tag) && !/\bblocking=/.test(tag) ? tag.replace('type="module"', 'type="module" blocking="render"') : tag,
  );
}

export function renderUploadPage(template: string, title = "letra"): string {
  return fill(template, `<title>${escapeHtml(title)}</title>\n${ROBOTS}`, "");
}

export function renderPlayerPage(template: string, data: PlayerData, config: Config): string {
  if (data === null) {
    return fill(template, `<title>Música não encontrada — letra</title>\n${ROBOTS}`, scriptTag(null));
  }
  const { track, translationEnabled } = data;
  const { mesh, scrim } = track.palette;
  const description = `${track.artist}. Ouça com a letra${translationEnabled ? " e a tradução" : ""}.`;
  const tag = (key: string, content: string) => `<meta property="${key}" content="${escapeHtml(content)}">`;
  const head = [
    `<title>${escapeHtml(`${track.title} — ${track.artist}`)}</title>`,
    ROBOTS,
    `<meta name="theme-color" content="${escapeHtml(mesh[0])}">`,
    `<style>:root{${mesh.map((hex, i) => `--mesh-${i + 1}:${cssValue(hex)}`).join(";")};--scrim:${Number(scrim)}}</style>`,
    tag("og:title", track.title),
    tag("og:description", description),
    tag("og:image", `${config.publicUrl}/media/${encodeURIComponent(track.id)}/og.jpg`),
    tag("og:image:width", "1200"),
    tag("og:image:height", "630"),
    tag("og:type", "music.song"),
    tag("og:url", track.shareUrl),
    '<meta name="twitter:card" content="summary_large_image">',
  ].join("\n");
  return fill(template, head, scriptTag(data));
}

function scriptTag(data: PlayerData): string {
  return `<script id="letra-data" type="application/json">${safeJson(data)}</script>`;
}
