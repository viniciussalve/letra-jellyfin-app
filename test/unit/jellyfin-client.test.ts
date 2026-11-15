import { describe, expect, it, vi } from "vitest";
import { createJellyfinClient } from "../../server/jellyfin/client.ts";
import { AppError } from "../../server/lib/errors.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createJellyfinClient", () => {
  it("authenticateByName sends MediaBrowser client header and credentials", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        AccessToken: "tok-123",
        ServerId: "srv-1",
        User: { Id: "usr-1", Name: "alice" },
      }),
    );

    const client = createJellyfinClient({
      baseUrl: "https://jf.example.com/",
      clientName: "LetraApp",
      deviceName: "Browser",
      deviceId: "dev-1",
      version: "2.0.0",
      fetchFn: fetchMock,
    });

    const session = await client.authenticateByName("alice", "s3cr3t");
    expect(session).toEqual({
      accessToken: "tok-123",
      userId: "usr-1",
      username: "alice",
      serverId: "srv-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://jf.example.com/Users/AuthenticateByName");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      'MediaBrowser Client="LetraApp", Device="Browser", DeviceId="dev-1", Version="2.0.0"',
    );
    expect(headers["X-Emby-Token"]).toBeUndefined();
    expect(JSON.parse(init?.body as string)).toEqual({ Username: "alice", Pw: "s3cr3t" });
  });

  it("listAudioItems passes query params, MediaBrowser Token header, and maps DTOs", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        Items: [
          {
            Id: "item-1",
            Name: "Song One",
            Artists: ["Band A", "Band B"],
            Album: "Album X",
            RunTimeTicks: 1_800_000_000,
            HasLyrics: true,
            ImageTags: { Primary: "tag-1" },
            DateCreated: "2026-01-01T00:00:00.000Z",
            MediaSources: [{ Container: "flac", Size: 42_000 }],
          },
        ],
      }),
    );

    const client = createJellyfinClient({ baseUrl: "https://jf.example.com", fetchFn: fetchMock });
    const items = await client.listAudioItems("tok-abc", {
      search: "song",
      ids: ["item-1", "item-2"],
      limit: 10,
      startIndex: 5,
    });

    expect(items).toEqual([
      {
        id: "item-1",
        title: "Song One",
        artist: "Band A, Band B",
        album: "Album X",
        durationMs: 180_000,
        hasCover: true,
        hasLyrics: true,
        container: "flac",
        sizeBytes: 42_000,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const [url, init] = fetchMock.mock.calls[0]!;
    const parsed = new URL(url as string);
    expect(parsed.pathname).toBe("/Items");
    expect(parsed.searchParams.get("IncludeItemTypes")).toBe("Audio");
    expect(parsed.searchParams.get("Recursive")).toBe("true");
    expect(parsed.searchParams.get("Fields")).toBe("MediaSources,DateCreated");
    expect(parsed.searchParams.get("SearchTerm")).toBe("song");
    expect(parsed.searchParams.get("Ids")).toBe("item-1,item-2");
    expect(parsed.searchParams.get("Limit")).toBe("10");
    expect(parsed.searchParams.get("StartIndex")).toBe("5");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('MediaBrowser Token="tok-abc"');
    expect(headers["X-Emby-Token"]).toBeUndefined();
  });

  it("getAudioItem returns item or null on 404 or empty Items", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ Items: [{ Id: "id-1", Name: "Track" }] }))
      .mockResolvedValueOnce(jsonResponse({ Items: [] }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));

    const client = createJellyfinClient({ baseUrl: "https://jf.example.com", fetchFn: fetchMock });

    const found = await client.getAudioItem("tok", "id-1");
    expect(found?.id).toBe("id-1");
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://jf.example.com/Items?Ids=id-1&IncludeItemTypes=Audio&Fields=MediaSources%2CDateCreated",
    );

    expect(await client.getAudioItem("tok", "missing-empty")).toBeNull();
    expect(await client.getAudioItem("tok", "missing-404")).toBeNull();
  });

  it("getLyrics parses lyrics on 200 and returns null on 404 or 204", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ Lyrics: [{ Text: "Hello", Start: 10_000_000 }] }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const client = createJellyfinClient({ baseUrl: "https://jf.example.com", fetchFn: fetchMock });
    expect(await client.getLyrics("tok", "a1")).toEqual({
      synced: true,
      lines: [{ t: 1000, text: "Hello" }],
      instrumental: false,
    });
    expect(await client.getLyrics("tok", "a2")).toBeNull();
    expect(await client.getLyrics("tok", "a3")).toBeNull();
  });

  it("uploadLyrics and deleteLyrics hit /Audio/{id}/Lyrics", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 204 }));
    const client = createJellyfinClient({ baseUrl: "https://jf.example.com", fetchFn: fetchMock });

    await client.uploadLyrics("tok", "track 1", "song.lrc", "[00:01.00]Hi");
    const [upUrl, upInit] = fetchMock.mock.calls[0]!;
    expect(upUrl).toBe("https://jf.example.com/Audio/track%201/Lyrics?fileName=song.lrc");
    expect(upInit?.method).toBe("POST");
    expect((upInit?.headers as Record<string, string>)["Content-Type"]).toBe("text/plain; charset=utf-8");
    expect((upInit?.headers as Record<string, string>).Authorization).toBe('MediaBrowser Token="tok"');
    expect(upInit?.body).toBe("[00:01.00]Hi");

    await client.deleteLyrics("tok", "track 1");
    const [delUrl, delInit] = fetchMock.mock.calls[1]!;
    expect(delUrl).toBe("https://jf.example.com/Audio/track%201/Lyrics");
    expect(delInit?.method).toBe("DELETE");
  });

  it("streamAudio forwards Range header and omits timeout signal", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      async () => new Response("audio-bytes", { status: 206, headers: { "content-range": "bytes 0-10/100" } }),
    );
    const client = createJellyfinClient({ baseUrl: "https://jf.example.com", fetchFn: fetchMock });

    const res = await client.streamAudio("tok", "t1", "bytes=0-10");
    expect(res.status).toBe(206);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://jf.example.com/Audio/t1/stream?static=true");
    expect((init?.headers as Record<string, string>).Range).toBe("bytes=0-10");
    expect(init?.signal).toBeUndefined();

    await client.streamAudio("tok", "t1");
    expect((fetchMock.mock.calls[1]![1]?.headers as Record<string, string>).Range).toBeUndefined();
  });

  it("getPrimaryImage includes optional maxWidth and refreshLibrary posts to /Library/Refresh", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response(new Uint8Array([1, 2]), { status: 200 }));
    const client = createJellyfinClient({ baseUrl: "https://jf.example.com", fetchFn: fetchMock });

    await client.getPrimaryImage("tok", "t1", 600);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://jf.example.com/Items/t1/Images/Primary?maxWidth=600");

    await client.getPrimaryImage("tok", "t1");
    expect(fetchMock.mock.calls[1]![0]).toBe("https://jf.example.com/Items/t1/Images/Primary");

    await client.refreshLibrary("tok");
    expect(fetchMock.mock.calls[2]![0]).toBe("https://jf.example.com/Library/Refresh");
    expect(fetchMock.mock.calls[2]![1]?.method).toBe("POST");
  });

  it("maps 401/403 to AppError(401, 'unauthorized') and 5xx/network to AppError(502, 'jellyfin_unavailable')", async () => {
    const client401 = createJellyfinClient({
      baseUrl: "https://jf.example.com",
      fetchFn: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 })),
    });
    await expect(client401.authenticateByName("u", "p")).rejects.toMatchObject({
      statusCode: 401,
      code: "unauthorized",
    });

    const client403 = createJellyfinClient({
      baseUrl: "https://jf.example.com",
      fetchFn: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 403 })),
    });
    await expect(client403.listAudioItems("tok")).rejects.toMatchObject({
      statusCode: 401,
      code: "unauthorized",
    });

    const client500 = createJellyfinClient({
      baseUrl: "https://jf.example.com",
      fetchFn: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 })),
    });
    await expect(client500.listAudioItems("tok")).rejects.toMatchObject({
      statusCode: 502,
      code: "jellyfin_unavailable",
    });

    const clientNet = createJellyfinClient({
      baseUrl: "https://jf.example.com",
      fetchFn: vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed")),
    });
    const err = await clientNet.refreshLibrary("tok").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(502);
    expect((err as AppError).code).toBe("jellyfin_unavailable");
  });

  it("sanitizes MediaBrowser client metadata and rejects invalid/injected tokens with 401", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        AccessToken: "tok-123",
        ServerId: "srv-1",
        User: { Id: "usr-1", Name: "alice" },
      }),
    );

    const client = createJellyfinClient({
      baseUrl: "https://jf.example.com",
      clientName: 'Letra"\r\n',
      deviceName: "Web\\x\x00",
      deviceId: 'id", Token="evil',
      version: "1.0\x7f",
      fetchFn: fetchMock,
    });

    await client.authenticateByName("alice", "pw");
    const headers = fetchMock.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      'MediaBrowser Client="Letra", Device="Webx", DeviceId="id, Token=evil", Version="1.0"',
    );

    for (const badToken of ["", 'tok", DeviceId="hijack', "tok\\bad", "tok\r\nX-Evil: 1", "tok\x00"]) {
      await expect(client.listAudioItems(badToken)).rejects.toMatchObject({
        statusCode: 401,
        code: "unauthorized",
      });
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects path-traversal and invalid itemIds with 400 before calling fetch", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = createJellyfinClient({ baseUrl: "https://jf.example.com", fetchFn: fetchMock });

    for (const badId of ["", ".", "..", "../etc", "a/b", "a\\b", "a?x=1", "a#frag"]) {
      await expect(client.getAudioItem("tok", badId)).rejects.toMatchObject({ statusCode: 400, code: "bad_request" });
      await expect(client.getLyrics("tok", badId)).rejects.toMatchObject({ statusCode: 400, code: "bad_request" });
      await expect(client.uploadLyrics("tok", badId, "a.lrc", "hi")).rejects.toMatchObject({ statusCode: 400, code: "bad_request" });
      await expect(client.deleteLyrics("tok", badId)).rejects.toMatchObject({ statusCode: 400, code: "bad_request" });
      await expect(client.streamAudio("tok", badId)).rejects.toMatchObject({ statusCode: 400, code: "bad_request" });
      await expect(client.getPrimaryImage("tok", badId)).rejects.toMatchObject({ statusCode: 400, code: "bad_request" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps 200 non-JSON HTML responses to AppError(502, 'jellyfin_error')", async () => {
    const html200 = () => new Response("<html><body>Maintenance</body></html>", { status: 200, headers: { "content-type": "text/html" } });
    const client = createJellyfinClient({
      baseUrl: "https://jf.example.com",
      fetchFn: vi.fn<typeof fetch>().mockImplementation(async () => html200()),
    });

    await expect(client.authenticateByName("u", "p")).rejects.toMatchObject({ statusCode: 502, code: "jellyfin_error" });
    await expect(client.listAudioItems("tok")).rejects.toMatchObject({ statusCode: 502, code: "jellyfin_error" });
    await expect(client.getAudioItem("tok", "t1")).rejects.toMatchObject({ statusCode: 502, code: "jellyfin_error" });
  });
});
