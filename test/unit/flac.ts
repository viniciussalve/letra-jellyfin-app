/** A minimal FLAC: STREAMINFO (10 s, 44.1 kHz stereo 16-bit, no audio frames) and a Vorbis comment block. */
export function makeFlac(comments: Record<string, string>): Buffer {
  const block = (type: number, last: boolean, body: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt8((last ? 0x80 : 0) | type, 0);
    head.writeUIntBE(body.length, 1, 3);
    return Buffer.concat([head, body]);
  };
  const info = Buffer.alloc(34);
  info.writeUInt16BE(4096, 0);
  info.writeUInt16BE(4096, 2);
  const packed = (44100n << 44n) | (1n << 41n) | (15n << 36n) | 441000n; // rate, channels-1, bps-1, samples
  info.writeBigUInt64BE(packed, 10);
  const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  const str = (s: string) => { const b = Buffer.from(s, "utf8"); return Buffer.concat([u32(b.length), b]); };
  const entries = Object.entries(comments).map(([k, v]) => str(`${k}=${v}`));
  const vorbis = Buffer.concat([str("letra-test"), u32(entries.length), ...entries]);
  return Buffer.concat([Buffer.from("fLaC"), block(0, false, info), block(4, true, vorbis)]);
}
