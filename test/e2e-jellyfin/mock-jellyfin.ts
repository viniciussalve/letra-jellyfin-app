import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { basename, extname, join } from "node:path";

export type MockJellyfinLyricsLine = {
  Text: string;
  Start?: number; // .NET ticks (10_000 ticks = 1 ms)
};

export type MockJellyfinLyricsPayload = {
  Lyrics?: MockJellyfinLyricsLine[];
  Lines?: MockJellyfinLyricsLine[];
};

export type MockJellyfinItem = {
  id: string;
  name: string;
  artists: string[];
  album: string | null;
  runTimeTicks: number;
  container?: string;
  audioBytes?: Buffer;
  audioMime?: string;
  coverBytes?: Buffer;
  coverMime?: string;
  lyricsPayload?: MockJellyfinLyricsPayload | null;
  lyricsRawBody?: string;
};

export type MockJellyfinUser = {
  id: string;
  username: string;
  password: string;
};

export type MockJellyfinOptions = {
  libraryDir?: string;
  serverId?: string;
  serverName?: string;
  serverVersion?: string;
  apiKey?: string;
  users?: MockJellyfinUser[];
};

export type FaultOptions = {
  message?: string;
  once?: boolean;
};

export type MockJellyfinServer = {
  url: string;
  serverId: string;
  apiKey: string;
  close: () => Promise<void>;
  reset: () => void;
  addItem: (item: MockJellyfinItem) => void;
  getItem: (id: string) => MockJellyfinItem | undefined;
  getRefreshCount: () => number;
  setFault: (endpoint: string, statusCode: number | null, opts?: FaultOptions) => void;
};

type FaultEntry = {
  statusCode: number;
  message?: string;
  once?: boolean;
};

const AUDIO_EXT_MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
};

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function parseLrcToJellyfinLyrics(lrcText: string): MockJellyfinLyricsPayload {
  const cleaned = lrcText.replace(/^\uFEFF/, "");
  const lines: MockJellyfinLyricsLine[] = [];
  const tagRe = /^\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\](.*)$/;
  for (const rawLine of cleaned.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    const match = tagRe.exec(trimmed);
    if (match) {
      const min = Number(match[1]);
      const sec = Number(match[2]);
      const fracRaw = match[3] ?? "0";
      const fracMs = fracRaw.length === 3 ? Number(fracRaw) : fracRaw.length === 2 ? Number(fracRaw) * 10 : Number(fracRaw) * 100;
      const ms = min * 60_000 + sec * 1000 + fracMs;
      lines.push({ Text: match[4].trim(), Start: ms * 10_000 });
    } else if (!/^\[[a-z]+:.*\]$/i.test(trimmed)) {
      lines.push({ Text: trimmed });
    }
  }
  return { Lyrics: lines };
}

function walkDir(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkDir(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function parseRangeHeader(rangeHeader: string, total: number): { start: number; end: number } | "invalid" {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) return "invalid";
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return "invalid";

  if (rawStart === "") {
    const suffixLen = Number(rawEnd);
    if (!Number.isFinite(suffixLen) || suffixLen <= 0) return "invalid";
    const start = Math.max(0, total - suffixLen);
    return { start, end: total - 1 };
  }

  const start = Number(rawStart);
  const end = rawEnd === "" ? total - 1 : Math.min(total - 1, Number(rawEnd));
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= total || start > end) {
    return "invalid";
  }
  return { start, end };
}

function formatJellyfinItem(item: MockJellyfinItem) {
  return {
    Id: item.id,
    Name: item.name,
    Type: "Audio",
    MediaType: "Audio",
    Artists: item.artists,
    AlbumArtist: item.artists[0] ?? "Unknown Artist",
    Album: item.album,
    RunTimeTicks: item.runTimeTicks,
    Container: item.container ?? "mp3",
    ImageTags: item.coverBytes ? { Primary: "mock-cover-tag" } : {},
    HasLyrics: Boolean(item.lyricsPayload),
  };
}

export async function startMockJellyfin(opts: MockJellyfinOptions = {}): Promise<MockJellyfinServer> {
  const serverId = opts.serverId ?? "mock-jellyfin-server-id";
  const serverName = opts.serverName ?? "Mock Jellyfin";
  const serverVersion = opts.serverVersion ?? "10.9.11";
  const apiKey = opts.apiKey ?? "mock-jellyfin-api-key";
  const defaultUsers: MockJellyfinUser[] = opts.users ?? [
    { id: "user-1", username: "jelly", password: "jelly-pass" },
  ];

  const users = new Map<string, MockJellyfinUser>();
  for (const u of defaultUsers) users.set(u.username, u);

  const tokens = new Map<string, { userId: string; username: string }>();
  const items = new Map<string, MockJellyfinItem>();
  const faults = new Map<string, FaultEntry>();
  let refreshCount = 0;

  function extractToken(req: IncomingMessage, url: URL): string | null {
    const auth = req.headers.authorization;
    if (typeof auth === "string") {
      const m = /Token="([^"]+)"/i.exec(auth) ?? /Token=([^\s,]+)/i.exec(auth);
      if (m) return m[1];
    }
    const emby = req.headers["x-emby-token"];
    if (typeof emby === "string" && emby.trim() !== "") return emby.trim();
    const qKey = url.searchParams.get("api_key") ?? url.searchParams.get("ApiKey");
    if (qKey && qKey.trim() !== "") return qKey.trim();
    return null;
  }

  function isAuthorized(req: IncomingMessage, url: URL): boolean {
    const tok = extractToken(req, url);
    if (!tok) return false;
    return tok === apiKey || tokens.has(tok);
  }

  function checkFault(method: string, pathname: string): FaultEntry | null {
    const exact = `${method} ${pathname}`;
    const entry = faults.get(exact) ?? faults.get(pathname);
    if (!entry) return null;
    if (entry.once) {
      faults.delete(faults.has(exact) ? exact : pathname);
    }
    return entry;
  }

  function scanLibraryDir(): void {
    if (!opts.libraryDir || !existsSync(opts.libraryDir)) return;
    const files = walkDir(opts.libraryDir);
    for (const file of files) {
      const ext = extname(file).toLowerCase();
      const mime = AUDIO_EXT_MIME[ext];
      if (!mime) continue;
      const base = basename(file, ext);
      const id = `lib-${base.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      if (items.has(id)) continue;

      const audioBytes = readFileSync(file);
      const lrcPath = file.slice(0, -ext.length) + ".lrc";
      const lyricsPayload = existsSync(lrcPath)
        ? parseLrcToJellyfinLyrics(readFileSync(lrcPath, "utf8"))
        : null;

      items.set(id, {
        id,
        name: base,
        artists: ["Unknown Artist"],
        album: null,
        runTimeTicks: 80_000_000,
        container: ext.slice(1),
        audioBytes,
        audioMime: mime,
        lyricsPayload,
      });
    }
  }

  const server: Server = createServer(async (req, res) => {
    const method = (req.method ?? "GET").toUpperCase();
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const pathname = url.pathname;

    const fault = checkFault(method, pathname);
    if (fault) {
      sendJson(res, fault.statusCode, { error: fault.message ?? "Injected mock fault" });
      return;
    }

    if (method === "GET" && pathname === "/System/Info/Public") {
      sendJson(res, 200, {
        Id: serverId,
        ServerName: serverName,
        Version: serverVersion,
        StartupWizardCompleted: true,
      });
      return;
    }

    if (method === "POST" && pathname === "/Users/AuthenticateByName") {
      const raw = (await readBody(req)).toString("utf8");
      let parsed: { Username?: unknown; Pw?: unknown; username?: unknown; pw?: unknown } = {};
      try {
        parsed = JSON.parse(raw) as typeof parsed;
      } catch {
        sendJson(res, 400, { error: "Invalid JSON" });
        return;
      }
      const username = typeof parsed.Username === "string" ? parsed.Username : typeof parsed.username === "string" ? parsed.username : "";
      const password = typeof parsed.Pw === "string" ? parsed.Pw : typeof parsed.pw === "string" ? parsed.pw : "";
      const user = users.get(username);
      if (!user || user.password !== password) {
        sendJson(res, 401, { error: "Invalid username or password" });
        return;
      }
      const accessToken = `jf-tok-${randomUUID()}`;
      tokens.set(accessToken, { userId: user.id, username: user.username });
      sendJson(res, 200, {
        User: { Id: user.id, Name: user.username },
        AccessToken: accessToken,
        ServerId: serverId,
      });
      return;
    }

    if (method === "GET" && pathname === "/Items") {
      if (!isAuthorized(req, url)) {
        sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      let list = [...items.values()];
      const includeTypes = url.searchParams.get("IncludeItemTypes");
      if (includeTypes && !includeTypes.split(",").map((s) => s.trim()).includes("Audio")) {
        list = [];
      }
      const idsParam = url.searchParams.get("Ids");
      if (idsParam) {
        const wanted = new Set(idsParam.split(",").map((s) => s.trim()).filter(Boolean));
        list = list.filter((it) => wanted.has(it.id));
      }
      const search = url.searchParams.get("SearchTerm")?.trim().toLowerCase();
      if (search) {
        list = list.filter(
          (it) =>
            it.name.toLowerCase().includes(search) ||
            it.artists.some((a) => a.toLowerCase().includes(search)) ||
            (it.album?.toLowerCase().includes(search) ?? false),
        );
      }
      const total = list.length;
      const startIndex = Math.max(0, Number(url.searchParams.get("StartIndex") ?? "0") || 0);
      const limitRaw = url.searchParams.get("Limit");
      const limit = limitRaw ? Math.max(0, Number(limitRaw) || 0) : list.length;
      const sliced = list.slice(startIndex, startIndex + limit).map(formatJellyfinItem);
      sendJson(res, 200, {
        Items: sliced,
        TotalRecordCount: total,
        StartIndex: startIndex,
      });
      return;
    }

    const itemMatch = /^\/(?:Users\/[^/]+\/)?Items\/([^/]+)$/.exec(pathname);
    if (method === "GET" && itemMatch) {
      if (!isAuthorized(req, url)) {
        sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      const item = items.get(decodeURIComponent(itemMatch[1]));
      if (!item) {
        sendJson(res, 404, { error: "Item not found" });
        return;
      }
      sendJson(res, 200, formatJellyfinItem(item));
      return;
    }

    const streamMatch = /^\/Audio\/([^/]+)\/stream$/.exec(pathname);
    if (method === "GET" && streamMatch) {
      const item = items.get(decodeURIComponent(streamMatch[1]));
      if (!item || !item.audioBytes) {
        sendJson(res, 404, { error: "Audio stream not found" });
        return;
      }
      const total = item.audioBytes.length;
      res.setHeader("accept-ranges", "bytes");
      res.setHeader("content-type", item.audioMime ?? "audio/mpeg");

      const rangeHeader = req.headers.range;
      if (typeof rangeHeader === "string") {
        const parsed = parseRangeHeader(rangeHeader, total);
        if (parsed === "invalid") {
          res.statusCode = 416;
          res.setHeader("content-range", `bytes */${total}`);
          res.end();
          return;
        }
        const chunk = item.audioBytes.subarray(parsed.start, parsed.end + 1);
        res.statusCode = 206;
        res.setHeader("content-range", `bytes ${parsed.start}-${parsed.end}/${total}`);
        res.setHeader("content-length", String(chunk.length));
        res.end(chunk);
        return;
      }

      res.statusCode = 200;
      res.setHeader("content-length", String(total));
      res.end(item.audioBytes);
      return;
    }

    const imageMatch = /^\/Items\/([^/]+)\/Images\/Primary$/.exec(pathname);
    if (method === "GET" && imageMatch) {
      const item = items.get(decodeURIComponent(imageMatch[1]));
      if (!item || !item.coverBytes) {
        sendJson(res, 404, { error: "Image not found" });
        return;
      }
      res.statusCode = 200;
      res.setHeader("content-type", item.coverMime ?? "image/png");
      res.setHeader("content-length", String(item.coverBytes.length));
      res.end(item.coverBytes);
      return;
    }

    const lyricsMatch = /^\/Audio\/([^/]+)\/Lyrics$/.exec(pathname);
    if (lyricsMatch) {
      if (!isAuthorized(req, url)) {
        sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      const item = items.get(decodeURIComponent(lyricsMatch[1]));
      if (!item) {
        sendJson(res, 404, { error: "Item not found" });
        return;
      }

      if (method === "GET") {
        if (item.lyricsRawBody !== undefined) {
          res.statusCode = 200;
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.end(item.lyricsRawBody);
          return;
        }
        if (!item.lyricsPayload) {
          sendJson(res, 404, { error: "Lyrics not found" });
          return;
        }
        sendJson(res, 200, item.lyricsPayload);
        return;
      }

      if (method === "POST") {
        const bodyBuf = await readBody(req);
        const bodyText = bodyBuf.toString("utf8");
        const contentType = req.headers["content-type"] ?? "";
        let payload: MockJellyfinLyricsPayload;
        if (contentType.includes("application/json")) {
          try {
            const parsed = JSON.parse(bodyText) as MockJellyfinLyricsPayload;
            payload = parsed;
          } catch {
            sendJson(res, 400, { error: "Invalid lyrics JSON" });
            return;
          }
        } else {
          payload = parseLrcToJellyfinLyrics(bodyText);
        }
        item.lyricsRawBody = undefined;
        item.lyricsPayload = payload;
        sendJson(res, 200, item.lyricsPayload);
        return;
      }

      if (method === "DELETE") {
        item.lyricsRawBody = undefined;
        item.lyricsPayload = null;
        res.statusCode = 204;
        res.end();
        return;
      }
    }

    if (method === "POST" && pathname === "/Library/Refresh") {
      if (!isAuthorized(req, url)) {
        sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      refreshCount += 1;
      scanLibraryDir();
      res.statusCode = 204;
      res.end();
      return;
    }

    sendJson(res, 404, { error: `Unhandled mock endpoint: ${method} ${pathname}` });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("Mock Jellyfin failed to bind ephemeral port");
  }

  return {
    url: `http://127.0.0.1:${addr.port}`,
    serverId,
    apiKey,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
    reset: () => {
      items.clear();
      tokens.clear();
      faults.clear();
      refreshCount = 0;
    },
    addItem: (item: MockJellyfinItem) => {
      items.set(item.id, item);
    },
    getItem: (id: string) => items.get(id),
    getRefreshCount: () => refreshCount,
    setFault: (endpoint: string, statusCode: number | null, faultOpts?: FaultOptions) => {
      if (statusCode === null) {
        faults.delete(endpoint);
      } else {
        faults.set(endpoint, { statusCode, message: faultOpts?.message, once: faultOpts?.once });
      }
    },
  };
}

export type MockLrclibRecord = {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string | null;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
};

export type MockLrclibServer = {
  url: string;
  close: () => Promise<void>;
  setRecords: (records: MockLrclibRecord[]) => void;
  getRequestCount: () => number;
};

export async function startMockLrclib(initialRecords: MockLrclibRecord[] = []): Promise<MockLrclibServer> {
  let records = [...initialRecords];
  let requestCount = 0;

  const server = createServer((req, res) => {
    requestCount += 1;
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const trackName = (url.searchParams.get("track_name") ?? url.searchParams.get("q") ?? "").trim().toLowerCase();
    const artistName = (url.searchParams.get("artist_name") ?? "").trim().toLowerCase();

    const matches = records.filter((r) => {
      const nameMatch = trackName === "" || r.trackName.toLowerCase().includes(trackName);
      const artistMatch = artistName === "" || r.artistName.toLowerCase().includes(artistName);
      return nameMatch && artistMatch;
    });

    if (url.pathname === "/api/search") {
      sendJson(res, 200, matches);
      return;
    }

    if (url.pathname === "/api/get") {
      if (matches.length > 0) {
        sendJson(res, 200, matches[0]);
      } else {
        sendJson(res, 404, { code: 404, name: "TrackNotFound" });
      }
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("Mock LRCLIB failed to bind ephemeral port");
  }

  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
    setRecords: (next: MockLrclibRecord[]) => {
      records = [...next];
    },
    getRequestCount: () => requestCount,
  };
}
