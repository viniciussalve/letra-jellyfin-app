import type { Palette } from "../../shared/types.ts";
import { withEllipsis, wrapLines } from "../shared/wrap.ts";

export type StoryData = {
  title: string;
  artist: string;
  palette: Palette;
  coverUrl: string | null;
  verse: string | null;
  translation: string | null;
};

/** Spec §6, in canvas pixels. Fonts are "weight size"; the family is added when drawing. */
export const STORY = Object.freeze({
  width: 1080,
  height: 1920,
  safeTop: 220,
  safeBottom: 1700,
  cover: 680,
  coverTop: 260,
  titleY: 1010,
  titleFont: "700 56px",
  titleLine: 64,
  artistFont: "500 44px",
  artistLine: 52,
  artistColor: "#D0D0D6",
  verseY: 1170,
  verseFont: "700 64px",
  verseLine: 76,
  verseMax: 4,
  transFont: "700 44px",
  transLine: 56,
  transMax: 3,
  transAlpha: 0.75,
  wordmarkY: 1640,
  wordmarkFont: "700 36px",
  wordmarkAlpha: 0.6,
  veil: 0.45,
  textWidth: 920,
});

const FAMILY = '"Inter Variable", sans-serif';
const fontOf = (spec: string) => `${spec} ${FAMILY}`;
/** The last translation baseline must stay this far above the wordmark. */
const TRANS_BOTTOM_GAP = 60;

export type StoryLayout = {
  title: string;
  artist: string;
  verseLines: string[];
  translationLines: string[];
};

/** One line, cut by characters with an ellipsis when it does not fit. */
function fitOneLine(text: string, font: string, measure: (text: string, font: string) => number): string {
  const t = text.replace(/\s+/g, " ").trim();
  const m = (s: string) => measure(s, font);
  return m(t) <= STORY.textWidth ? t : withEllipsis(t, STORY.textWidth, m);
}

/**
 * Pure layout: the text of each block after fitting. The translation starts one
 * verse-line gap below the last verse line and loses lines (ellipsis on the last
 * kept one) until it stays above the wordmark.
 */
export function layoutStoryCard(data: StoryData, measure: (text: string, font: string) => number): StoryLayout {
  const title = fitOneLine(data.title, fontOf(STORY.titleFont), measure);
  const artist = fitOneLine(data.artist, fontOf(STORY.artistFont), measure);

  const verse = data.verse?.trim() ?? "";
  if (verse === "") return { title, artist, verseLines: [], translationLines: [] };

  const verseFont = fontOf(STORY.verseFont);
  const verseLines = wrapLines(verse, STORY.textWidth, (s) => measure(s, verseFont), STORY.verseMax);

  const translation = data.translation?.trim() ?? "";
  let translationLines: string[] = [];
  if (translation !== "") {
    const transFont = fontOf(STORY.transFont);
    const m = (s: string) => measure(s, transFont);
    const start = STORY.verseY + verseLines.length * STORY.verseLine;
    const limit = STORY.wordmarkY - TRANS_BOTTOM_GAP;
    const room = start > limit ? 0 : Math.floor((limit - start) / STORY.transLine) + 1;
    const allowed = Math.min(STORY.transMax, room);
    translationLines = wrapLines(translation, STORY.textWidth, m, allowed);
  }
  return { title, artist, verseLines, translationLines };
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? Number.parseInt(m[1]!, 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The page's field (background.css) without drift or blur: ellipses sized against the 160% field. */
const BLOBS = [
  { rx: 0.42, ry: 0.46, x: 0.3, y: 0.36 },
  { rx: 0.44, ry: 0.48, x: 0.72, y: 0.3 },
  { rx: 0.4, ry: 0.4, x: 0.28, y: 0.78 },
  { rx: 0.4, ry: 0.44, x: 0.64, y: 0.7 },
] as const;

function drawBackground(ctx: CanvasRenderingContext2D, palette: Palette): void {
  const { width: W, height: H } = STORY;
  const mesh = palette.mesh;
  const darkest = mesh.reduce((a, b) => (luminance(b) < luminance(a) ? b : a));
  ctx.fillStyle = darkest;
  ctx.fillRect(0, 0, W, H);
  const fw = W * 1.6;
  const fh = H * 1.6;
  BLOBS.forEach((b, i) => {
    const [r, g, bl] = rgb(mesh[i]!);
    const cx = -0.3 * W + b.x * fw;
    const cy = -0.3 * H + b.y * fh;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(b.rx * fw, b.ry * fh);
    const g1 = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g1.addColorStop(0, `rgba(${r},${g},${bl},1)`);
    g1.addColorStop(1, `rgba(${r},${g},${bl},0)`);
    ctx.fillStyle = g1;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  });
  ctx.fillStyle = `rgba(0,0,0,${STORY.veil})`;
  ctx.fillRect(0, 0, W, H);
}

/**
 * The no-cover tile: a square (like covers, --radius-cover is 0) in the first mesh
 * color, carrying the cover's shadow itself so nothing else sits behind it, with a
 * drawn music note.
 */
function drawNoteTile(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 80;
  ctx.shadowOffsetY = 30;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, size, size);
  ctx.restore();
  const u = size / 100;
  const ox = x + size / 2;
  const oy = y + size / 2;
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillRect(ox + 4 * u, oy - 26 * u, 6 * u, 46 * u); // stem
  ctx.beginPath();
  ctx.ellipse(ox - 4 * u, oy + 20 * u, 14 * u, 10 * u, -0.35, 0, Math.PI * 2); // head
  ctx.fill();
  ctx.beginPath(); // flag
  ctx.moveTo(ox + 10 * u, oy - 26 * u);
  ctx.bezierCurveTo(ox + 12 * u, oy - 14 * u, ox + 30 * u, oy - 16 * u, ox + 28 * u, oy + 2 * u);
  ctx.bezierCurveTo(ox + 24 * u, oy - 8 * u, ox + 16 * u, oy - 8 * u, ox + 10 * u, oy - 6 * u);
  ctx.closePath();
  ctx.fill();
}

function sourceSize(img: CanvasImageSource): { w: number; h: number } {
  const i = img as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
  return { w: i.naturalWidth ?? i.width ?? 0, h: i.naturalHeight ?? i.height ?? 0 };
}

/** Paints the whole card: background, cover (or note tile), texts, wordmark. */
export function drawStoryCard(ctx: CanvasRenderingContext2D, data: StoryData, cover: CanvasImageSource | null): void {
  const { width: W } = STORY;
  const cx = W / 2;
  drawBackground(ctx, data.palette);

  // Cover with its shadow (0 30px 80px rgb(0 0 0 / .5)); the note tile brings its own.
  const cxl = (W - STORY.cover) / 2;
  if (cover) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 80;
    ctx.shadowOffsetY = 30;
    ctx.fillStyle = "#000";
    ctx.fillRect(cxl, STORY.coverTop, STORY.cover, STORY.cover);
    ctx.restore();
    const { w, h } = sourceSize(cover);
    const side = Math.min(w, h);
    if (side > 0) {
      ctx.drawImage(cover, (w - side) / 2, (h - side) / 2, side, side, cxl, STORY.coverTop, STORY.cover, STORY.cover);
    } else {
      ctx.drawImage(cover, cxl, STORY.coverTop, STORY.cover, STORY.cover);
    }
  } else {
    drawNoteTile(ctx, cxl, STORY.coverTop, STORY.cover, data.palette.mesh[0]);
  }

  const layout = layoutStoryCard(data, (text, font) => {
    ctx.font = font;
    return ctx.measureText(text).width;
  });

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#fff";
  ctx.font = fontOf(STORY.titleFont);
  ctx.fillText(layout.title, cx, STORY.titleY);
  ctx.fillStyle = STORY.artistColor;
  ctx.font = fontOf(STORY.artistFont);
  ctx.fillText(layout.artist, cx, STORY.titleY + STORY.titleLine);

  ctx.fillStyle = "#fff";
  ctx.font = fontOf(STORY.verseFont);
  layout.verseLines.forEach((line, i) => ctx.fillText(line, cx, STORY.verseY + i * STORY.verseLine));

  if (layout.translationLines.length > 0) {
    const start = STORY.verseY + layout.verseLines.length * STORY.verseLine;
    ctx.fillStyle = `rgba(255,255,255,${STORY.transAlpha})`;
    ctx.font = fontOf(STORY.transFont);
    layout.translationLines.forEach((line, i) => ctx.fillText(line, cx, start + i * STORY.transLine));
  }

  ctx.fillStyle = `rgba(255,255,255,${STORY.wordmarkAlpha})`;
  ctx.font = fontOf(STORY.wordmarkFont);
  ctx.fillText("letra", cx, STORY.wordmarkY);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("cover failed to load"));
    img.src = url;
  });
}

/** Renders the card to a PNG File. Rejects when the cover cannot load or the blob is null. */
export async function makeStoryCard(data: StoryData, fileName: string): Promise<File> {
  await Promise.all([
    document.fonts.load(`500 44px "Inter Variable"`),
    document.fonts.load(`700 64px "Inter Variable"`),
  ]).catch(() => undefined); // fall back to the system font rather than fail the card
  const cover = data.coverUrl ? await loadImage(data.coverUrl) : null;

  const canvas = document.createElement("canvas");
  canvas.width = STORY.width;
  canvas.height = STORY.height;
  let blob: Blob | null;
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    drawStoryCard(ctx, data, cover);
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  } finally {
    // iOS Safari caps total canvas memory and frees a canvas's 8 MB late: zero it now, card or not.
    canvas.width = canvas.height = 0;
  }
  if (!blob) throw new Error("could not encode the card");
  return new File([blob], fileName, { type: "image/png" });
}
