import { encode, QrCodeDataType } from "uqr";

const DEFAULT_SIZE = 240;
const DEFAULT_CENTER_FRACTION = 0.22;
const DEFAULT_CENTER_MARGIN_PX = 6;
const DOT_RADIUS = 0.41; // of a module: dots fill 82% of it
const FINDER_MODULES = 7;

const encodeH = (text: string) => encode(text, { ecc: "H", border: 0 });

export function qrMatrix(text: string): boolean[][] {
  return encodeH(text).data;
}

/** The cleared square, in SVG units, where the dialog lays the cover. */
export function qrCenterBox(
  size: number,
  centerFraction = DEFAULT_CENTER_FRACTION,
  centerMarginPx = DEFAULT_CENTER_MARGIN_PX,
): { x: number; y: number; width: number } {
  const width = centerFraction * size + 2 * centerMarginPx;
  const x = (size - width) / 2;
  return { x, y: x, width };
}

const num = (v: number): string => String(Math.round(v * 1e8) / 1e8);

/** Centers of the alignment patterns: a dark module ringed by light ones, all of alignment type. */
function alignmentCenters(matrix: boolean[][], types: QrCodeDataType[][]): Array<[number, number]> {
  const centers: Array<[number, number]> = [];
  const isAlign = (r: number, c: number) => types[r]?.[c] === QrCodeDataType.Alignment;
  for (let r = 2; r < matrix.length - 2; r++) {
    for (let c = 2; c < matrix.length - 2; c++) {
      if (!isAlign(r, c) || !matrix[r][c]) continue;
      let ringed = true;
      for (let dr = -1; dr <= 1 && ringed; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if ((dr !== 0 || dc !== 0) && (!isAlign(r + dr, c + dc) || matrix[r + dr][c + dc])) ringed = false;
        }
      }
      if (ringed) centers.push([r, c]);
    }
  }
  return centers;
}

export function qrSvg(
  text: string,
  opts: { size?: number; centerFraction?: number; centerMarginPx?: number } = {},
): string {
  const size = opts.size ?? DEFAULT_SIZE;
  const { data: matrix, types } = encodeH(text);
  const n = matrix.length;
  const m = size / n;
  const box = qrCenterBox(size, opts.centerFraction, opts.centerMarginPx);
  const inBox = (x: number, y: number): boolean => x > box.x && x < box.x + box.width && y > box.y && y < box.y + box.width;

  const inFinder = (r: number, c: number): boolean =>
    (r < FINDER_MODULES && c < FINDER_MODULES) ||
    (r < FINDER_MODULES && c >= n - FINDER_MODULES) ||
    (r >= n - FINDER_MODULES && c < FINDER_MODULES);

  // Alignment patterns are drawn whole, like small finders: as loose dots, decoders
  // (jsQR among them) miss them. One the center box touches stays ordinary modules.
  const aligns = alignmentCenters(matrix, types).filter(([r, c]) => {
    const lo = (c - 2) * m;
    const hi = (c + 3) * m;
    const top = (r - 2) * m;
    const bottom = (r + 3) * m;
    return hi <= box.x || lo >= box.x + box.width || bottom <= box.y || top >= box.y + box.width;
  });
  const inAlign = (r: number, c: number): boolean => aligns.some(([ar, ac]) => Math.abs(r - ar) <= 2 && Math.abs(c - ac) <= 2);

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(size)} ${num(size)}" width="${num(size)}" height="${num(size)}" role="img">`,
    `<rect width="${num(size)}" height="${num(size)}" fill="#fff"/>`,
  ];

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!matrix[r][c] || inFinder(r, c) || inAlign(r, c)) continue;
      const cx = (c + 0.5) * m;
      const cy = (r + 0.5) * m;
      if (inBox(cx, cy)) continue;
      parts.push(`<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(DOT_RADIUS * m)}" fill="#000"/>`);
    }
  }

  for (const [r, c] of aligns) {
    const ringSide = 4 * m; // stroke centerline of the 5x5 ring
    parts.push(
      `<rect data-align="ring" x="${num((c - 1.5) * m)}" y="${num((r - 1.5) * m)}" width="${num(ringSide)}" height="${num(ringSide)}" rx="${num(0.3 * ringSide)}" fill="none" stroke="#000" stroke-width="${num(m)}"/>`,
      `<rect data-align="eye" x="${num(c * m)}" y="${num(r * m)}" width="${num(m)}" height="${num(m)}" rx="${num(0.3 * m)}" fill="#000"/>`,
    );
  }

  const origins: Array<[number, number]> = [
    [0, 0],
    [n - FINDER_MODULES, 0],
    [0, n - FINDER_MODULES],
  ];
  for (const [col, row] of origins) {
    const x = col * m;
    const y = row * m;
    const ringSide = 6 * m; // stroke centerline of the 7x7 ring
    const innerSide = 3 * m;
    parts.push(
      `<rect data-finder="ring" x="${num(x + m / 2)}" y="${num(y + m / 2)}" width="${num(ringSide)}" height="${num(ringSide)}" rx="${num(0.3 * ringSide)}" fill="none" stroke="#000" stroke-width="${num(m)}"/>`,
      `<rect data-finder="eye" x="${num(x + 2 * m)}" y="${num(y + 2 * m)}" width="${num(innerSide)}" height="${num(innerSide)}" rx="${num(0.3 * innerSide)}" fill="#000"/>`,
    );
  }

  parts.push("</svg>");
  return parts.join("");
}
