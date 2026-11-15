import { expect, test } from "vitest";
import { createLrclibClient, pickBest, type LrclibRecord } from "../../server/lib/lyrics/lrclib.ts";

const rec = { id: 1, trackName: "T", artistName: "A", albumName: "Al", duration: 8, instrumental: false, plainLyrics: "x", syncedLyrics: null };

test("get sends params and User-Agent", async () => {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchStub = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), headers: init?.headers as Record<string, string> });
    return new Response(JSON.stringify(rec), { status: 200 });
  }) as unknown as typeof fetch;
  const c = createLrclibClient({ baseUrl: "https://l.test", fetch: fetchStub });
  const r = await c.get({ artist: "A B", title: "T", album: "Al", durationSec: 8 });
  expect(r?.id).toBe(1);
  const u = new URL(calls[0].url);
  expect(u.pathname).toBe("/api/get");
  expect(u.searchParams.get("artist_name")).toBe("A B");
  expect(u.searchParams.get("track_name")).toBe("T");
  expect(u.searchParams.get("album_name")).toBe("Al");
  expect(u.searchParams.get("duration")).toBe("8");
  expect(calls[0].headers["User-Agent"]).toBe("letra (https://github.com/viniciussalve/letra)");
});

test("get omits album_name when null; search hits /api/search", async () => {
  const urls: string[] = [];
  const fetchStub = (async (url: string) => {
    urls.push(String(url));
    return new Response(JSON.stringify([rec]), { status: 200 });
  }) as unknown as typeof fetch;
  const c = createLrclibClient({ baseUrl: "https://l.test/", fetch: fetchStub });
  await c.get({ artist: "A", title: "T", album: null, durationSec: 8 });
  expect(new URL(urls[0]).searchParams.has("album_name")).toBe(false);
  const s = await c.search({ artist: "A", title: "T" });
  expect(s).toHaveLength(1);
  const u = new URL(urls[1]);
  expect(u.pathname).toBe("/api/search");
  expect(u.searchParams.get("track_name")).toBe("T");
  expect(u.searchParams.get("artist_name")).toBe("A");
});

test("404, network error and timeout give null / []", async () => {
  const q = { artist: "A", title: "T", album: null, durationSec: 8 };
  const nf = createLrclibClient({ baseUrl: "http://x", fetch: (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch });
  expect(await nf.get(q)).toBeNull();
  expect(await nf.search(q)).toEqual([]);
  const err = createLrclibClient({ baseUrl: "http://x", fetch: (async () => { throw new Error("down"); }) as unknown as typeof fetch });
  expect(await err.get(q)).toBeNull();
  expect(await err.search(q)).toEqual([]);
  const hang = createLrclibClient({ baseUrl: "http://x", timeoutMs: 50, fetch: (() => new Promise(() => {})) as unknown as typeof fetch });
  expect(await hang.get(q)).toBeNull();
  expect(await hang.search(q)).toEqual([]);
});

test("pickBest keeps ±3 s and prefers synced", () => {
  const r = (id: number, duration: number, synced: boolean) => ({ id, duration, syncedLyrics: synced ? "[00:01]a" : null }) as LrclibRecord;
  expect(pickBest([r(1, 200, false), r(2, 203, true), r(3, 210, true)], 201)?.id).toBe(2);
  expect(pickBest([r(1, 190, true)], 201)).toBeNull();
  expect(pickBest([r(1, 203, true), r(2, 201, true)], 201)?.id).toBe(2);
});

test("onError fires for 500 and timeout, not for 404", async () => {
  const q = { artist: "A", title: "T", album: null, durationSec: 8 };
  const errs: unknown[] = [];
  const onError = (e: unknown) => errs.push(e);
  const mk = (f: unknown, timeoutMs?: number) => createLrclibClient({ baseUrl: "http://x", timeoutMs, onError, fetch: f as typeof fetch });
  await mk(async () => new Response("{}", { status: 404 })).get(q);
  expect(errs).toHaveLength(0);
  expect(await mk(async () => new Response("{}", { status: 500 })).get(q)).toBeNull();
  expect(errs).toHaveLength(1);
  expect(String(errs[0])).toMatch(/500/);
  expect(await mk(() => new Promise(() => {}), 50).search(q)).toEqual([]);
  expect(errs).toHaveLength(2);
});
