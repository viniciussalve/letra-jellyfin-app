import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LineTranslationDTO, SummaryResponse, TrackDTO, TranslationDTO } from "../../shared/types.ts";
import {
  loadFixture,
  loadSampleLrc,
  loginAs,
  multipartBody,
  parsePlayerData,
  startAppServer,
  type AppServerHandle,
} from "./helpers.ts";
import { startMockJellyfin, startMockLrclib, type MockJellyfinServer, type MockLrclibServer } from "./mock-jellyfin.ts";

describe("Tier 4: Real-World End-to-End User Workflows", () => {
  let jf: MockJellyfinServer;
  let lrclib: MockLrclibServer;
  let app: AppServerHandle;
  let libraryDir: string;
  let songBytes: Buffer;
  let coverBytes: Buffer;

  beforeAll(async () => {
    libraryDir = mkdtempSync(join(tmpdir(), "letra-t4-lib-"));
    songBytes = loadFixture("song.mp3");
    coverBytes = loadFixture("cover.png");
    jf = await startMockJellyfin({ libraryDir });
    lrclib = await startMockLrclib([
      {
        id: 301,
        trackName: "Recovered Song",
        artistName: "Recovery Band",
        albumName: null,
        duration: 8,
        instrumental: false,
        plainLyrics: "Linha recuperada 1\nLinha recuperada 2",
        syncedLyrics: "[00:01.00]Linha recuperada 1\n[00:03.00]Linha recuperada 2",
      },
    ]);
    app = await startAppServer({
      jellyfinUrl: jf.url,
      jellyfinApiKey: jf.apiKey,
      jellyfinLibraryDir: libraryDir,
      lrclibUrl: lrclib.url,
      translator: "fake",
    });
  });

  afterAll(async () => {
    await app?.stop();
    await lrclib?.close();
    await jf?.close();
    rmSync(libraryDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    jf.reset();
  });

  it("Workflow 1: Curator uploads audio + LRC, refreshes library, and shares link with listener", async () => {
    const { cookie } = await loginAs(app.baseUrl, "jelly", "jelly-pass");
    const lrc = loadSampleLrc();
    const { body, contentType } = multipartBody(
      {},
      [{ field: "file", filename: "Curator Track.mp3", contentType: "audio/mpeg", data: songBytes }],
    );
    const uploadRes = await fetch(`${app.baseUrl}/api/tracks`, {
      method: "POST",
      headers: { cookie: cookie!, "content-type": contentType },
      body,
    });
    expect(uploadRes.status).toBe(201);
    const uploaded = (await uploadRes.json()) as TrackDTO;

    const lrcRes = await fetch(`${app.baseUrl}/api/tracks/${uploaded.id}/lyrics`, {
      method: "PUT",
      headers: { cookie: cookie!, "content-type": "application/json" },
      body: JSON.stringify({ text: lrc }),
    });
    expect(lrcRes.status).toBe(200);

    // Unauthenticated listener opens the shared URL
    const shareRes = await fetch(`${app.baseUrl}/t/${uploaded.id}`);
    expect(shareRes.status).toBe(200);
    const data = parsePlayerData(await shareRes.text());
    expect(data?.track.lyrics?.synced).toBe(true);
    expect(data?.track.lyrics?.lines).toHaveLength(4);

    // Listener seeks audio via Range
    const streamRes = await fetch(`${app.baseUrl}/media/${uploaded.id}/audio`, {
      headers: { Range: "bytes=0-1023" },
    });
    expect(streamRes.status).toBe(206);
  });

  it("Workflow 2: Listener discovers track, streams audio in chunks, views cover, and translates whole track + single line", async () => {
    jf.addItem({
      id: "jfwork002",
      name: "Samba da Rua",
      artists: ["Banda Local"],
      album: "Ao Vivo",
      runTimeTicks: 80_000_000,
      audioBytes: songBytes,
      audioMime: "audio/mpeg",
      coverBytes,
      coverMime: "image/png",
      lyricsPayload: {
        Lyrics: [
          { Text: "Abre a janela pro sol entrar", Start: 10_000_000 },
          { Text: "Canta comigo ate amanhecer", Start: 35_000_000 },
        ],
      },
    });

    const playerRes = await fetch(`${app.baseUrl}/t/jfwork002`);
    expect(playerRes.status).toBe(200);
    const playerData = parsePlayerData(await playerRes.text());
    expect(playerData?.track.title).toBe("Samba da Rua");
    expect(playerData?.track.hasCover).toBe(true);

    const chunk1 = await fetch(`${app.baseUrl}/media/jfwork002/audio`, { headers: { Range: "bytes=0-4095" } });
    const chunk2 = await fetch(`${app.baseUrl}/media/jfwork002/audio`, { headers: { Range: "bytes=4096-8191" } });
    expect(chunk1.status).toBe(206);
    expect(chunk2.status).toBe(206);

    const coverRes = await fetch(`${app.baseUrl}/media/jfwork002/cover.jpg`);
    expect(coverRes.status).toBe(200);

    const fullTrans = (await (
      await fetch(`${app.baseUrl}/api/tracks/jfwork002/translation?lang=en`)
    ).json()) as TranslationDTO;
    expect(fullTrans.lines).toHaveLength(2);

    const lineTrans = (await (
      await fetch(
        `${app.baseUrl}/api/tracks/jfwork002/translation/line?index=1&lang=en&text=${encodeURIComponent("Canta comigo ate amanhecer")}`,
      )
    ).json()) as LineTranslationDTO;
    expect(lineTrans.text).toBeTruthy();
  });

  it("Workflow 3: Missing lyrics recovery via LRCLIB search and manual fallback", async () => {
    jf.addItem({
      id: "jfwork003",
      name: "Recovered Song",
      artists: ["Recovery Band"],
      album: null,
      runTimeTicks: 80_000_000,
      audioBytes: songBytes,
      lyricsPayload: null,
    });

    const { cookie } = await loginAs(app.baseUrl, "jelly", "jelly-pass");

    // Step 1: Search LRCLIB and populate Jellyfin lyrics
    const searchRes = await fetch(`${app.baseUrl}/api/tracks/jfwork003/lyrics/search`, {
      method: "POST",
      headers: { cookie: cookie! },
    });
    expect(searchRes.status).toBe(200);
    const afterSearch = (await searchRes.json()) as TrackDTO;
    expect(afterSearch.lyrics?.lines[0].text).toBe("Linha recuperada 1");

    // Step 2: Curator refines lyrics manually
    const manualRes = await fetch(`${app.baseUrl}/api/tracks/jfwork003/lyrics`, {
      method: "PUT",
      headers: { cookie: cookie!, "content-type": "application/json" },
      body: JSON.stringify({ text: "[00:01.00]Linha revisada 1\n[00:03.00]Linha revisada 2" }),
    });
    expect(manualRes.status).toBe(200);

    // Step 3: Listener reloads /t/jfwork003 and sees refined lyrics
    const playerData = parsePlayerData(await (await fetch(`${app.baseUrl}/t/jfwork003`)).text());
    expect(playerData?.track.lyrics?.lines[0].text).toBe("Linha revisada 1");
  });

  it("Workflow 4: Multi-track library browsing, saved lines page, and summary hydration", async () => {
    jf.addItem({
      id: "jfwork004a",
      name: "Faixa A",
      artists: ["Artista A"],
      album: null,
      runTimeTicks: 50_000_000,
      audioBytes: songBytes,
      lyricsPayload: { Lyrics: [{ Text: "Verso A", Start: 10_000_000 }] },
    });
    jf.addItem({
      id: "jfwork004b",
      name: "Faixa B",
      artists: ["Artista B"],
      album: null,
      runTimeTicks: 70_000_000,
      audioBytes: songBytes,
      lyricsPayload: { Lyrics: [{ Text: "Verso B", Start: 10_000_000 }] },
    });

    const { cookie } = await loginAs(app.baseUrl, "jelly", "jelly-pass");
    const tracks = (await (await fetch(`${app.baseUrl}/api/tracks`, { headers: { cookie: cookie! } })).json()) as TrackDTO[];
    expect(tracks.length).toBeGreaterThanOrEqual(2);

    const salvasRes = await fetch(`${app.baseUrl}/salvas`);
    expect(salvasRes.status).toBe(200);

    const summary = (await (
      await fetch(`${app.baseUrl}/api/tracks/summary?ids=jfwork004a,jfwork004b`)
    ).json()) as SummaryResponse;
    expect(summary.tracks.map((t) => t.id)).toEqual(["jfwork004a", "jfwork004b"]);

    const lineA = await fetch(`${app.baseUrl}/api/tracks/jfwork004a/translation/line?index=0&lang=en&text=Verso+A`);
    const lineB = await fetch(`${app.baseUrl}/api/tracks/jfwork004b/translation/line?index=0&lang=en&text=Verso+B`);
    expect(lineA.status).toBe(200);
    expect(lineB.status).toBe(200);
  });

  it("Workflow 5: Upstream token expiry triggers 401 and curator recovers by re-authenticating", async () => {
    jf.addItem({
      id: "jfwork005",
      name: "Auth Recovery",
      artists: ["Artist"],
      album: null,
      runTimeTicks: 50_000_000,
      audioBytes: songBytes,
      lyricsPayload: null,
    });

    const firstLogin = await loginAs(app.baseUrl, "jelly", "jelly-pass");
    expect(firstLogin.response.status).toBe(200);

    // Simulate expired upstream Jellyfin token
    jf.setFault("GET /Items", 401, { once: true });
    const expiredRes = await fetch(`${app.baseUrl}/api/tracks`, {
      headers: { cookie: firstLogin.cookie! },
    });
    expect(expiredRes.status).toBe(401);

    // Curator re-authenticates and resumes managing lyrics
    const secondLogin = await loginAs(app.baseUrl, "jelly", "jelly-pass");
    expect(secondLogin.response.status).toBe(200);

    const listRes = await fetch(`${app.baseUrl}/api/tracks`, {
      headers: { cookie: secondLogin.cookie! },
    });
    expect(listRes.status).toBe(200);

    const putRes = await fetch(`${app.baseUrl}/api/tracks/jfwork005/lyrics`, {
      method: "PUT",
      headers: { cookie: secondLogin.cookie!, "content-type": "application/json" },
      body: JSON.stringify({ text: "[00:01.00]Recuperado com sucesso" }),
    });
    expect(putRes.status).toBe(200);
  });
});
