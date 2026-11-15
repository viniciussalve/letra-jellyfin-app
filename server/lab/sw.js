// Throwaway test worker for /teste/: answers /teste/play by decrypting, chunk by chunk, the
// ciphertext the page left in Cache Storage. Nothing here is used by the real player.
const CHUNK = 65536, TAG = 16, CACHE = "letra-teste";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
const iv = (i) => { const b = new Uint8Array(12); new DataView(b.buffer).setUint32(8, i); return b; };
async function load() {
  const cache = await caches.open(CACHE);
  const [cipher, meta] = await Promise.all([cache.match("/teste/cipher"), cache.match("/teste/meta")]);
  if (!cipher || !meta) return null;
  const { raw, size } = await meta.json();
  const key = await crypto.subtle.importKey("raw", new Uint8Array(raw), "AES-GCM", false, ["decrypt"]);
  return { key, size, blob: await cipher.blob() };
}
self.addEventListener("fetch", (e) => {
  if (new URL(e.request.url).pathname !== "/teste/play") return;
  e.respondWith((async () => {
    const t = await load();
    if (!t) return new Response("not prepared", { status: 404 });
    const r = /bytes=(\d+)-(\d*)/.exec(e.request.headers.get("range") ?? "");
    const start = r ? Number(r[1]) : 0;
    const end = Math.min(r && r[2] ? Number(r[2]) : start + 16 * CHUNK - 1, t.size - 1);
    const c0 = Math.floor(start / CHUNK), c1 = Math.floor(end / CHUNK);
    const enc = await t.blob.slice(c0 * (CHUNK + TAG), (c1 + 1) * (CHUNK + TAG)).arrayBuffer();
    const parts = [];
    for (let i = c0; i <= c1; i++) {
      const off = (i - c0) * (CHUNK + TAG);
      parts.push(await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv(i) }, t.key, enc.slice(off, Math.min(off + CHUNK + TAG, enc.byteLength))));
    }
    const plain = new Uint8Array(await new Blob(parts).arrayBuffer()).subarray(start - c0 * CHUNK, end - c0 * CHUNK + 1);
    return new Response(plain, {
      status: 206,
      headers: {
        "content-type": "audio/wav",
        "content-range": `bytes ${start}-${end}/${t.size}`,
        "content-length": String(plain.length),
        "accept-ranges": "bytes",
        "cache-control": "no-store",
      },
    });
  })());
});
