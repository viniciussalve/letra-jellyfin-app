import type { ApiError, LineTranslationDTO, SummaryResponse, TrackDTO, TrackSummary, TranslationDTO } from "../../shared/types.ts";

export class ApiClientError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
  }
}

const NETWORK_MESSAGE = "Sem conexão. Confira a internet e tente de novo.";
const UNKNOWN_MESSAGE = "Algo deu errado. Tente de novo.";

const networkError = () => new ApiClientError(0, "network", NETWORK_MESSAGE);
const apiError = (status: number, body: ApiError | null) =>
  new ApiClientError(status, body?.error?.code ?? "unknown", body?.error?.message ?? UNKNOWN_MESSAGE);

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "same-origin", ...init });
  } catch {
    throw networkError();
  }
  if (!res.ok) throw apiError(res.status, (await res.json().catch(() => null)) as ApiError | null);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const trackUrl = (id: string) => `/api/tracks/${encodeURIComponent(id)}`;

export type Session = {
  authenticated: boolean;
  owner: boolean;
  userId: string | null;
  username: string | null;
  maxUploadBytes: number;
  libraryUploadEnabled: boolean;
};

export const login = (username: string, password: string) =>
  request<Session>("/api/session", json("POST", { username, password }));
export const logout = () => request<void>("/api/session", { method: "DELETE" });
export const getSession = () => request<Session>("/api/session");

/** With no ids: no request, `{ tracks: [], translationEnabled: false }`. */
export async function getSummary(ids: string[]): Promise<SummaryResponse> {
  if (ids.length === 0) return { tracks: [], translationEnabled: false };
  return request<SummaryResponse>(`/api/tracks/summary?ids=${encodeURIComponent(ids.join(","))}`);
}

export async function getSummaries(ids: string[]): Promise<TrackSummary[]> {
  return (await getSummary(ids)).tracks;
}

export const getLineTranslation = (id: string, index: number, lang: string, text: string) =>
  request<LineTranslationDTO>(`${trackUrl(id)}/translation/line?index=${index}&lang=${encodeURIComponent(lang)}&text=${encodeURIComponent(text)}`);

export const listTracks = () => request<TrackDTO[]>("/api/tracks");
export const updateTrack = (id: string, fields: { title?: string; artist?: string }) =>
  request<TrackDTO>(trackUrl(id), json("PATCH", fields));
export const searchLyrics = (id: string) => request<TrackDTO>(`${trackUrl(id)}/lyrics/search`, { method: "POST" });
export const saveLyricsText = (id: string, text: string) => request<TrackDTO>(`${trackUrl(id)}/lyrics`, json("PUT", { text }));
export const saveLyricsFile = (id: string, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return request<TrackDTO>(`${trackUrl(id)}/lyrics`, { method: "PUT", body: form });
};
export const deleteTrack = (id: string) => request<void>(trackUrl(id), { method: "DELETE" });
export const deleteLyrics = (id: string) => request<void>(`${trackUrl(id)}/lyrics`, { method: "DELETE" });
export const getTranslation = (id: string, lang: string) =>
  request<TranslationDTO>(`${trackUrl(id)}/translation?lang=${encodeURIComponent(lang)}`);

/**
 * Uploads an audio file as multipart field `file`. XHR rather than fetch for upload
 * progress: `onProgress` gets whole percents, and 100 only once the body is sent
 * (the server then reads tags and looks for lyrics before it answers).
 */
export function upload(file: File, onProgress: (pct: number) => void): Promise<TrackDTO> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/tracks");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(Math.min(99, Math.floor((e.loaded / e.total) * 100)));
    };
    xhr.upload.onload = () => onProgress(100);
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // not JSON (a proxy error page): reported as unknown below
      }
      if (xhr.status >= 200 && xhr.status < 300 && body !== null) resolve(body as TrackDTO);
      else reject(apiError(xhr.status, body as ApiError | null));
    };
    xhr.onerror = () => reject(networkError());
    xhr.onabort = () => reject(networkError());
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}
