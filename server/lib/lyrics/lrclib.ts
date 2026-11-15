export type LrclibRecord = {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string | null;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
};

export type LrclibClient = {
  get(q: { artist: string; title: string; album: string | null; durationSec: number }): Promise<LrclibRecord | null>;
  search(q: { artist: string; title: string }): Promise<LrclibRecord[]>;
};

const USER_AGENT = "letra (https://github.com/viniciussalve/letra)";

export function createLrclibClient(o: {
  baseUrl: string;
  fetch: typeof fetch;
  timeoutMs?: number;
  onError?: (err: unknown, url: string) => void;
}): LrclibClient {
  const report =
    o.onError ??
    ((err: unknown, url: string) => console.warn(`LRCLIB request failed: ${url} (${err instanceof Error ? err.message : String(err)})`));
  const base = o.baseUrl.replace(/\/+$/, "");

  // Resolves to parsed JSON, or null on any HTTP error, network error or timeout.
  async function request(path: string, params: Record<string, string>): Promise<unknown> {
    const signal = AbortSignal.timeout(o.timeoutMs ?? 5000);
    const url = `${base}${path}?${new URLSearchParams(params)}`;
    const aborted = new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    aborted.catch(() => {});
    try {
      const res = await Promise.race([
        o.fetch(url, { headers: { "User-Agent": USER_AGENT }, signal }),
        aborted,
      ]);
      if (res.status === 404) return null;
      if (!res.ok) {
        report(new Error(`HTTP ${res.status}`), url);
        return null;
      }
      return await Promise.race([res.json() as Promise<unknown>, aborted]);
    } catch (err) {
      report(err, url);
      return null;
    }
  }

  return {
    async get(q) {
      const params: Record<string, string> = {
        artist_name: q.artist,
        track_name: q.title,
        duration: String(q.durationSec),
      };
      if (q.album !== null) params.album_name = q.album;
      const body = await request("/api/get", params);
      return body !== null && typeof body === "object" && !Array.isArray(body) ? (body as LrclibRecord) : null;
    },
    async search(q) {
      const body = await request("/api/search", { track_name: q.title, artist_name: q.artist });
      return Array.isArray(body) ? (body as LrclibRecord[]) : [];
    },
  };
}

/** Records within ±3 s of the file's duration; synced first, then closest duration. */
export function pickBest(records: LrclibRecord[], durationSec: number): LrclibRecord | null {
  let best: LrclibRecord | null = null;
  for (const r of records) {
    const diff = Math.abs(r.duration - durationSec);
    if (!(diff <= 3)) continue;
    if (best === null) {
      best = r;
      continue;
    }
    const rs = Boolean(r.syncedLyrics);
    const bs = Boolean(best.syncedLyrics);
    if (rs !== bs ? rs : diff < Math.abs(best.duration - durationSec)) best = r;
  }
  return best;
}
