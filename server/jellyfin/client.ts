import { AppError } from "../lib/errors.ts";
import { parseJellyfinLyrics, ticksToMs } from "./lyrics.ts";
import type {
  JellyfinAudioItem,
  JellyfinAuthResponse,
  JellyfinBaseItemDto,
  JellyfinClient,
  JellyfinClientOptions,
  JellyfinItemsResponse,
  JellyfinListOpts,
  JellyfinSession,
  ParsedLyrics,
} from "./types.ts";

function mapItem(dto: JellyfinBaseItemDto): JellyfinAudioItem {
  const artistFromArray = dto.Artists?.filter((a) => a.trim() !== "").join(", ");
  const artistFromItems = dto.ArtistItems?.map((a) => a.Name?.trim() ?? "")
    .filter((a) => a !== "")
    .join(", ");
  const artist = artistFromArray || artistFromItems || dto.AlbumArtist?.trim() || "";
  const media = dto.MediaSources?.[0];

  return {
    id: dto.Id ?? "",
    title: dto.Name ?? "",
    artist,
    album: dto.Album ?? null,
    durationMs: ticksToMs(dto.RunTimeTicks ?? media?.RunTimeTicks ?? 0),
    hasCover: Boolean(dto.ImageTags?.Primary),
    hasLyrics: Boolean(dto.HasLyrics),
    container: dto.Container ?? media?.Container ?? null,
    sizeBytes: dto.Size ?? media?.Size ?? 0,
    createdAt: dto.DateCreated ?? new Date(0).toISOString(),
  };
}

const HEADER_UNSAFE_GLOBAL = /["\\\r\n\x00-\x1f\x7f]/g;
const HEADER_UNSAFE = /["\\\r\n\x00-\x1f\x7f]/;
const VALID_ITEM_ID = /^(?!\.\.?$)[0-9A-Za-z_ .-]{1,128}$/;

function sanitizeHeaderParam(value: string): string {
  return value.replace(HEADER_UNSAFE_GLOBAL, "");
}

function validateItemId(itemId: string): string {
  if (!VALID_ITEM_ID.test(itemId)) {
    throw new AppError(400, "bad_request", "ID de item inválido.");
  }
  return itemId;
}

async function parseJson<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new AppError(502, "jellyfin_error", "Resposta inválida do Jellyfin.");
  }
}

export function createJellyfinClient(opts: JellyfinClientOptions): JellyfinClient {
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");
  const clientName = sanitizeHeaderParam(opts.clientName ?? "Letra");
  const deviceName = sanitizeHeaderParam(opts.deviceName ?? "Web");
  const deviceId = sanitizeHeaderParam(opts.deviceId ?? "letra-bff");
  const version = sanitizeHeaderParam(opts.version ?? "1.0.0");
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const fetchFn = opts.fetchFn ?? fetch;

  const authClientHeader = `MediaBrowser Client="${clientName}", Device="${deviceName}", DeviceId="${deviceId}", Version="${version}"`;

  function tokenHeader(token: string): string {
    if (!token || HEADER_UNSAFE.test(token)) {
      throw new AppError(401, "unauthorized", "Token do Jellyfin inválido.");
    }
    return `MediaBrowser Token="${token}"`;
  }

  async function request(
    path: string,
    init: RequestInit & { useTimeout?: boolean } = {},
  ): Promise<Response> {
    const { useTimeout = true, ...fetchInit } = init;
    const signal = useTimeout && !fetchInit.signal ? AbortSignal.timeout(timeoutMs) : fetchInit.signal;
    try {
      return await fetchFn(`${baseUrl}${path}`, { ...fetchInit, signal });
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(502, "jellyfin_unavailable", "Não foi possível conectar ao Jellyfin.");
    }
  }

  function throwForStatus(res: Response, authMessage = "Credenciais ou sessão inválidas no Jellyfin."): never {
    void res.body?.cancel();
    if (res.status === 401 || res.status === 403) {
      throw new AppError(401, "unauthorized", authMessage);
    }
    if (res.status === 404) {
      throw new AppError(404, "not_found", "Item não encontrado no Jellyfin.");
    }
    if (res.status >= 500) {
      throw new AppError(502, "jellyfin_unavailable", "O Jellyfin retornou um erro interno.");
    }
    throw new AppError(res.status >= 400 ? res.status : 502, "jellyfin_error", `Erro do Jellyfin (${res.status}).`);
  }

  return {
    async authenticateByName(username: string, password: string): Promise<JellyfinSession> {
      const res = await request("/Users/AuthenticateByName", {
        method: "POST",
        headers: {
          Authorization: authClientHeader,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ Username: username, Pw: password }),
      });

      if (!res.ok) {
        throwForStatus(res, "Usuário ou senha inválidos.");
      }

      const data = await parseJson<JellyfinAuthResponse>(res);
      if (!data.AccessToken || !data.User?.Id) {
        throw new AppError(502, "jellyfin_error", "Resposta de autenticação inválida do Jellyfin.");
      }

      return {
        accessToken: data.AccessToken,
        userId: data.User.Id,
        username: data.User.Name ?? username,
        serverId: data.ServerId ?? "",
      };
    },

    async listAudioItems(token: string, listOpts: JellyfinListOpts = {}): Promise<JellyfinAudioItem[]> {
      const params = new URLSearchParams({
        IncludeItemTypes: "Audio",
        Recursive: "true",
        Fields: "MediaSources,DateCreated",
      });
      if (listOpts.search !== undefined && listOpts.search !== "") {
        params.set("SearchTerm", listOpts.search);
      }
      if (listOpts.ids && listOpts.ids.length > 0) {
        params.set("Ids", listOpts.ids.join(","));
      }
      if (listOpts.limit !== undefined) {
        params.set("Limit", String(listOpts.limit));
      }
      if (listOpts.startIndex !== undefined) {
        params.set("StartIndex", String(listOpts.startIndex));
      }

      const res = await request(`/Items?${params.toString()}`, {
        method: "GET",
        headers: {
          Authorization: tokenHeader(token),
          Accept: "application/json",
        },
      });

      if (!res.ok) throwForStatus(res);
      const data = await parseJson<JellyfinItemsResponse>(res);
      return (data.Items ?? []).map(mapItem);
    },

    async getAudioItem(token: string, itemId: string): Promise<JellyfinAudioItem | null> {
      const id = validateItemId(itemId);
      const params = new URLSearchParams({
        Ids: id,
        IncludeItemTypes: "Audio",
        Fields: "MediaSources,DateCreated",
      });
      const res = await request(`/Items?${params.toString()}`, {
        method: "GET",
        headers: {
          Authorization: tokenHeader(token),
          Accept: "application/json",
        },
      });

      if (res.status === 404) {
        void res.body?.cancel();
        return null;
      }
      if (!res.ok) throwForStatus(res);
      const data = await parseJson<JellyfinItemsResponse>(res);
      const first = data.Items?.[0];
      return first ? mapItem(first) : null;
    },

    async getLyrics(token: string, itemId: string): Promise<ParsedLyrics> {
      const id = validateItemId(itemId);
      const res = await request(`/Audio/${encodeURIComponent(id)}/Lyrics`, {
        method: "GET",
        headers: {
          Authorization: tokenHeader(token),
          Accept: "application/json",
        },
      });

      if (res.status === 404 || res.status === 204) {
        void res.body?.cancel();
        return null;
      }
      if (!res.ok) throwForStatus(res);

      let json: unknown;
      try {
        json = await res.json();
      } catch {
        return null;
      }
      return parseJellyfinLyrics(json);
    },

    async uploadLyrics(token: string, itemId: string, fileName: string, content: string): Promise<void> {
      const id = validateItemId(itemId);
      const res = await request(
        `/Audio/${encodeURIComponent(id)}/Lyrics?fileName=${encodeURIComponent(fileName)}`,
        {
          method: "POST",
          headers: {
            Authorization: tokenHeader(token),
            "Content-Type": "text/plain; charset=utf-8",
          },
          body: content,
        },
      );
      if (!res.ok) throwForStatus(res);
      void res.body?.cancel();
    },

    async deleteLyrics(token: string, itemId: string): Promise<void> {
      const id = validateItemId(itemId);
      const res = await request(`/Audio/${encodeURIComponent(id)}/Lyrics`, {
        method: "DELETE",
        headers: {
          Authorization: tokenHeader(token),
        },
      });
      if (!res.ok) throwForStatus(res);
      void res.body?.cancel();
    },

    async streamAudio(token: string, itemId: string, rangeHeader?: string): Promise<Response> {
      const id = validateItemId(itemId);
      const headers: Record<string, string> = {
        Authorization: tokenHeader(token),
      };
      if (rangeHeader) {
        headers.Range = rangeHeader;
      }
      const res = await request(`/Audio/${encodeURIComponent(id)}/stream?static=true`, {
        method: "GET",
        headers,
        useTimeout: false,
      });
      if (res.status === 401 || res.status === 403 || res.status >= 500) {
        throwForStatus(res);
      }
      return res;
    },

    async getPrimaryImage(token: string, itemId: string, maxWidth?: number): Promise<Response> {
      const id = validateItemId(itemId);
      const query = maxWidth !== undefined ? `?maxWidth=${encodeURIComponent(String(maxWidth))}` : "";
      const res = await request(`/Items/${encodeURIComponent(id)}/Images/Primary${query}`, {
        method: "GET",
        headers: {
          Authorization: tokenHeader(token),
        },
      });
      if (res.status === 401 || res.status === 403 || res.status >= 500) {
        throwForStatus(res);
      }
      return res;
    },

    async refreshLibrary(token: string): Promise<void> {
      const res = await request("/Library/Refresh", {
        method: "POST",
        headers: {
          Authorization: tokenHeader(token),
        },
      });
      if (!res.ok) throwForStatus(res);
      void res.body?.cancel();
    },
  };
}
