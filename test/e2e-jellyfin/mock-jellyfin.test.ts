import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startMockJellyfin, startMockLrclib, type MockJellyfinServer, type MockLrclibServer } from "./mock-jellyfin.ts";

describe("Mock Jellyfin HTTP Server", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop()!;
      await fn();
    }
  });

  async function setup(libraryDir?: string): Promise<MockJellyfinServer> {
    const jf = await startMockJellyfin({ libraryDir });
    cleanups.push(() => jf.close());
    return jf;
  }

  it("GET /System/Info/Public returns server info", async () => {
    const jf = await setup();
    const res = await fetch(`${jf.url}/System/Info/Public`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { Id: string; ServerName: string; Version: string };
    expect(body.Id).toBe(jf.serverId);
    expect(body.ServerName).toBe("Mock Jellyfin");
    expect(body.Version).toBeTruthy();
  });

  it("POST /Users/AuthenticateByName returns 200 with token for valid credentials and 401 for invalid", async () => {
    const jf = await setup();
    const okRes = await fetch(`${jf.url}/Users/AuthenticateByName`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ Username: "jelly", Pw: "jelly-pass" }),
    });
    expect(okRes.status).toBe(200);
    const okBody = (await okRes.json()) as { User: { Id: string; Name: string }; AccessToken: string; ServerId: string };
    expect(okBody.User.Name).toBe("jelly");
    expect(okBody.AccessToken).toBeTruthy();
    expect(okBody.ServerId).toBe(jf.serverId);

    const badRes = await fetch(`${jf.url}/Users/AuthenticateByName`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ Username: "jelly", Pw: "wrong" }),
    });
    expect(badRes.status).toBe(401);
  });

  it("GET /Items enforces auth and filters by IncludeItemTypes, SearchTerm, Ids, Limit, StartIndex", async () => {
    const jf = await setup();
    jf.addItem({ id: "t1", name: "Azul", artists: ["Gal Costa"], album: "Domingo", runTimeTicks: 180_000_000 });
    jf.addItem({ id: "t2", name: "Águas de Março", artists: ["Elis Regina"], album: "Elis & Tom", runTimeTicks: 210_000_000 });
    jf.addItem({ id: "t3", name: "Construção", artists: ["Chico Buarque"], album: "Construção", runTimeTicks: 380_000_000 });

    const unauth = await fetch(`${jf.url}/Items`);
    expect(unauth.status).toBe(401);

    const authRes = await fetch(`${jf.url}/Users/AuthenticateByName`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ Username: "jelly", Pw: "jelly-pass" }),
    });
    const { AccessToken } = (await authRes.json()) as { AccessToken: string };
    const headers = { Authorization: `MediaBrowser Token="${AccessToken}"` };

    const searchRes = await fetch(`${jf.url}/Items?IncludeItemTypes=Audio&SearchTerm=elis`, { headers });
    expect(searchRes.status).toBe(200);
    const searchJson = (await searchRes.json()) as { Items: Array<{ Id: string }>; TotalRecordCount: number };
    expect(searchJson.TotalRecordCount).toBe(1);
    expect(searchJson.Items[0].Id).toBe("t2");

    const idsRes = await fetch(`${jf.url}/Items?Ids=t1,t3`, { headers });
    const idsJson = (await idsRes.json()) as { Items: Array<{ Id: string }> };
    expect(idsJson.Items.map((i) => i.Id)).toEqual(["t1", "t3"]);

    const pageRes = await fetch(`${jf.url}/Items?StartIndex=1&Limit=1`, { headers: { "X-Emby-Token": AccessToken } });
    const pageJson = (await pageRes.json()) as { Items: Array<{ Id: string }>; TotalRecordCount: number; StartIndex: number };
    expect(pageJson.TotalRecordCount).toBe(3);
    expect(pageJson.StartIndex).toBe(1);
    expect(pageJson.Items).toHaveLength(1);
    expect(pageJson.Items[0].Id).toBe("t2");
  });

  it("GET /Items/:id returns item or 404", async () => {
    const jf = await setup();
    jf.addItem({ id: "t1", name: "Track One", artists: ["Artist"], album: null, runTimeTicks: 50_000_000 });

    const headers = { "X-Emby-Token": jf.apiKey };
    const ok = await fetch(`${jf.url}/Items/t1`, { headers });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { Id: string; Name: string };
    expect(body.Name).toBe("Track One");

    const missing = await fetch(`${jf.url}/Items/unknown`, { headers });
    expect(missing.status).toBe(404);
  });

  it("GET /Audio/:id/stream supports 200 full stream, 206 Range, 416 out-of-range, and 404 missing", async () => {
    const jf = await setup();
    const audio = Buffer.from("0123456789abcdef");
    jf.addItem({
      id: "a1",
      name: "Audio",
      artists: ["Artist"],
      album: null,
      runTimeTicks: 10_000_000,
      audioBytes: audio,
      audioMime: "audio/mpeg",
    });

    const full = await fetch(`${jf.url}/Audio/a1/stream`);
    expect(full.status).toBe(200);
    expect(full.headers.get("accept-ranges")).toBe("bytes");
    expect(Buffer.from(await full.arrayBuffer()).toString()).toBe("0123456789abcdef");

    const partial = await fetch(`${jf.url}/Audio/a1/stream`, { headers: { Range: "bytes=4-7" } });
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toBe("bytes 4-7/16");
    expect(Buffer.from(await partial.arrayBuffer()).toString()).toBe("4567");

    const invalid = await fetch(`${jf.url}/Audio/a1/stream`, { headers: { Range: "bytes=999-1000" } });
    expect(invalid.status).toBe(416);

    const missing = await fetch(`${jf.url}/Audio/nope/stream`);
    expect(missing.status).toBe(404);
  });

  it("GET /Items/:id/Images/Primary serves cover bytes or 404 when absent", async () => {
    const jf = await setup();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    jf.addItem({ id: "c1", name: "With Cover", artists: ["A"], album: null, runTimeTicks: 1000, coverBytes: png });
    jf.addItem({ id: "c2", name: "No Cover", artists: ["A"], album: null, runTimeTicks: 1000 });

    const ok = await fetch(`${jf.url}/Items/c1/Images/Primary`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await ok.arrayBuffer())).toEqual(png);

    const none = await fetch(`${jf.url}/Items/c2/Images/Primary`);
    expect(none.status).toBe(404);
  });

  it("GET/POST/DELETE /Audio/:id/Lyrics manages lyrics in Lyrics and Lines formats", async () => {
    const jf = await setup();
    const headers = { "X-Emby-Token": jf.apiKey };
    jf.addItem({
      id: "l1",
      name: "Lyric Track",
      artists: ["A"],
      album: null,
      runTimeTicks: 1000,
      lyricsPayload: { Lyrics: [{ Text: "Hello", Start: 5_000_000 }] },
    });

    const getRes = await fetch(`${jf.url}/Audio/l1/Lyrics`, { headers });
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as { Lyrics: Array<{ Text: string; Start: number }> };
    expect(getBody.Lyrics[0]).toEqual({ Text: "Hello", Start: 5_000_000 });

    const postRes = await fetch(`${jf.url}/Audio/l1/Lyrics`, {
      method: "POST",
      headers: { ...headers, "content-type": "text/plain" },
      body: "[00:01.50]Updated line",
    });
    expect(postRes.status).toBe(200);
    expect(jf.getItem("l1")?.lyricsPayload?.Lyrics?.[0]).toEqual({ Text: "Updated line", Start: 15_000_000 });

    const delRes = await fetch(`${jf.url}/Audio/l1/Lyrics`, { method: "DELETE", headers });
    expect(delRes.status).toBe(204);

    const afterDel = await fetch(`${jf.url}/Audio/l1/Lyrics`, { headers });
    expect(afterDel.status).toBe(404);
  });

  it("POST /Library/Refresh increments counter and scans libraryDir for .mp3 and .lrc files", async () => {
    const libDir = mkdtempSync(join(tmpdir(), "mock-jf-lib-"));
    cleanups.push(() => rmSync(libDir, { recursive: true, force: true }));
    writeFileSync(join(libDir, "My Song.mp3"), Buffer.from("ID3dummy"));
    writeFileSync(join(libDir, "My Song.lrc"), "[00:02.00]Scanned lyric");

    const jf = await setup(libDir);
    const headers = { "X-Emby-Token": jf.apiKey };
    expect(jf.getRefreshCount()).toBe(0);

    const res = await fetch(`${jf.url}/Library/Refresh`, { method: "POST", headers });
    expect(res.status).toBe(204);
    expect(jf.getRefreshCount()).toBe(1);

    const itemsRes = await fetch(`${jf.url}/Items?IncludeItemTypes=Audio`, { headers });
    const itemsBody = (await itemsRes.json()) as { Items: Array<{ Id: string; Name: string; HasLyrics: boolean }> };
    expect(itemsBody.Items).toHaveLength(1);
    expect(itemsBody.Items[0].Name).toBe("My Song");
    expect(itemsBody.Items[0].HasLyrics).toBe(true);
  });

  it("setFault() injects HTTP errors and reset() clears state", async () => {
    const jf = await setup();
    jf.setFault("GET /Items", 500, { once: true });
    const headers = { "X-Emby-Token": jf.apiKey };

    const fail = await fetch(`${jf.url}/Items`, { headers });
    expect(fail.status).toBe(500);

    const ok = await fetch(`${jf.url}/Items`, { headers });
    expect(ok.status).toBe(200);

    jf.addItem({ id: "x1", name: "Temp", artists: ["A"], album: null, runTimeTicks: 1000 });
    jf.reset();
    expect(jf.getItem("x1")).toBeUndefined();
    expect(jf.getRefreshCount()).toBe(0);
  });

  it("startMockLrclib() serves /api/get and /api/search", async () => {
    const lrclib: MockLrclibServer = await startMockLrclib([
      {
        id: 10,
        trackName: "Sem Tags",
        artistName: "Letra Fixtures",
        albumName: null,
        duration: 8,
        instrumental: false,
        plainLyrics: "Linha 1",
        syncedLyrics: "[00:01.00]Linha 1",
      },
    ]);
    cleanups.push(() => lrclib.close());

    const searchRes = await fetch(`${lrclib.url}/api/search?track_name=Sem+Tags`);
    expect(searchRes.status).toBe(200);
    const list = (await searchRes.json()) as Array<{ trackName: string }>;
    expect(list).toHaveLength(1);

    const getRes = await fetch(`${lrclib.url}/api/get?track_name=Sem+Tags`);
    expect(getRes.status).toBe(200);
    const one = (await getRes.json()) as { syncedLyrics: string };
    expect(one.syncedLyrics).toContain("Linha 1");

    const missRes = await fetch(`${lrclib.url}/api/get?track_name=Missing`);
    expect(missRes.status).toBe(404);
    expect(lrclib.getRequestCount()).toBe(3);
  });
});
