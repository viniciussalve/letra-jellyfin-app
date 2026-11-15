import { inflateSync } from "node:zlib";

export type PngImage = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

export function pngDimensions(buf: Buffer): { width: number; height: number; format: "png" } {
  const sig = buf.subarray(0, 8);
  if (!sig.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error("Not a PNG");
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    format: "png",
  };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Decodes an 8-bit RGB or RGBA PNG buffer (standard Playwright/Canvas PNG) to RGBA pixels. */
export function decodePngRgba(buf: Buffer): PngImage {
  const { width, height } = pngDimensions(buf);
  const colorType = buf[25];
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (channels === 0) throw new Error(`Unsupported PNG colorType ${colorType}`);

  const idatChunks: Buffer[] = [];
  let offset = 8;
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "IDAT") idatChunks.push(buf.subarray(offset + 8, offset + 8 + len));
    offset += 12 + len;
    if (type === "IEND") break;
  }

  const raw = inflateSync(Buffer.concat(idatChunks));
  const stride = width * channels;
  const recon = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const rowIn = y * (stride + 1) + 1;
    const rowOut = y * stride;
    for (let x = 0; x < stride; x++) {
      const val = raw[rowIn + x]!;
      const a = x >= channels ? recon[rowOut + x - channels]! : 0;
      const b = y > 0 ? recon[rowOut - stride + x]! : 0;
      const c = y > 0 && x >= channels ? recon[rowOut - stride + x - channels]! : 0;
      let decoded = val;
      if (filter === 1) decoded = (val + a) & 0xff;
      else if (filter === 2) decoded = (val + b) & 0xff;
      else if (filter === 3) decoded = (val + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) decoded = (val + paeth(a, b, c)) & 0xff;
      recon[rowOut + x] = decoded;
    }
  }

  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += channels) {
    rgba[i * 4] = recon[j]!;
    rgba[i * 4 + 1] = recon[j + 1]!;
    rgba[i * 4 + 2] = recon[j + 2]!;
    rgba[i * 4 + 3] = channels === 4 ? recon[j + 3]! : 255;
  }
  return { width, height, data: rgba };
}
