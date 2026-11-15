import { afterEach, expect, test, vi } from "vitest";
import { NOT_AUDIO } from "../../shared/copy.ts";
import type { TrackDTO } from "../../shared/types.ts";
import { ApiClientError } from "../../web/shared/api.ts";
import { lyricsToText } from "../../web/upload/dialogs.ts";
import { upload, uploadHint, validateFile } from "../../web/upload/uploader.ts";

const MB = 1048576;

test("validateFile", () => {
  expect(validateFile({ name: "a.mp3", size: 142 * 1048576 }, 100 * 1048576)).toBe("O arquivo tem 142 MB. O limite é 100 MB.");
  expect(validateFile({ name: "a.txt", size: 10 }, 100 * 1048576)).toBe("Esse arquivo não é um áudio que dá para tocar. Envie MP3, M4A, FLAC, OGG ou WAV.");
  expect(validateFile({ name: "A.MP3", size: 10 }, 100 * 1048576)).toBeNull();
});

test("validateFile accepts every allowed extension and rejects the rest", () => {
  for (const name of ["a.mp3", "b.m4a", "c.flac", "d.ogg", "e.wav", "Artista - Música.Flac"]) {
    expect(validateFile({ name, size: 1 }, 100 * MB)).toBeNull();
  }
  for (const name of ["mp3", "a.mp3.txt", "a.aac", "a.", ".wav.zip"]) {
    expect(validateFile({ name, size: 1 }, 100 * MB)).toBe(NOT_AUDIO);
  }
});

test("validateFile: the type is checked before the size", () => {
  expect(validateFile({ name: "a.zip", size: 500 * MB }, 100 * MB)).toBe(NOT_AUDIO);
});

test("validateFile: exactly the limit passes, one byte over does not", () => {
  expect(validateFile({ name: "a.wav", size: 100 * MB }, 100 * MB)).toBeNull();
  expect(validateFile({ name: "a.wav", size: 100 * MB + 1 }, 100 * MB)).toBe("O arquivo tem 101 MB. O limite é 100 MB.");
});

test("uploadHint lists the formats and the limit", () => {
  expect(uploadHint(100 * MB)).toBe("MP3, M4A, FLAC, OGG ou WAV, até 100 MB");
  expect(uploadHint(25 * MB)).toBe("MP3, M4A, FLAC, OGG ou WAV, até 25 MB");
});

// --- upload(): XHR with progress ---------------------------------------------------

type Listener = ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null;

class FakeXHR {
  static last: FakeXHR | null = null;
  method = "";
  url = "";
  body: unknown = null;
  status = 0;
  responseText = "";
  withCredentials = false;
  upload: { onprogress: Listener; onload: (() => void) | null } = { onprogress: null, onload: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() {
    FakeXHR.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader() {}
  send(body: unknown) {
    this.body = body;
  }
  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = typeof body === "string" ? body : JSON.stringify(body);
    this.onload?.();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeXHR.last = null;
});

const file = () => new File([new Uint8Array([1, 2, 3])], "song.mp3", { type: "audio/mpeg" });

test("upload posts the file as multipart field `file` and reports progress", async () => {
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
  const seen: number[] = [];
  const done = upload(file(), (pct) => seen.push(pct));
  const xhr = FakeXHR.last!;
  expect(xhr.method).toBe("POST");
  expect(xhr.url).toBe("/api/tracks");
  expect(xhr.body).toBeInstanceOf(FormData);
  expect(((xhr.body as FormData).get("file") as File).name).toBe("song.mp3");

  xhr.upload.onprogress?.({ lengthComputable: true, loaded: 42, total: 100 });
  xhr.upload.onprogress?.({ lengthComputable: true, loaded: 999, total: 1000 });
  xhr.upload.onprogress?.({ lengthComputable: false, loaded: 5, total: 0 });
  xhr.upload.onload?.();
  const track = { id: "abc", title: "T", shareUrl: "http://x/t/abc" } as TrackDTO;
  xhr.respond(201, track);
  await expect(done).resolves.toEqual(track);
  // 99.9% is not done yet: 100 only once the body is sent.
  expect(seen).toEqual([42, 99, 100]);
});

test("upload maps an API error to ApiClientError with the server's code and message", async () => {
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
  const done = upload(file(), () => {});
  FakeXHR.last!.respond(413, { error: { code: "too_large", message: "O arquivo tem 142 MB. O limite é 100 MB." } });
  const err = await done.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApiClientError);
  expect(err).toMatchObject({ status: 413, code: "too_large", message: "O arquivo tem 142 MB. O limite é 100 MB." });
});

test("upload: a non-JSON error body still rejects with an ApiClientError", async () => {
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
  const done = upload(file(), () => {});
  FakeXHR.last!.respond(502, "<html>Bad Gateway</html>");
  const err = await done.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApiClientError);
  expect(err).toMatchObject({ status: 502, code: "unknown" });
});

test("upload: a network failure maps to code `network`", async () => {
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
  const done = upload(file(), () => {});
  FakeXHR.last!.onerror?.();
  const err = await done.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApiClientError);
  expect(err).toMatchObject({ status: 0, code: "network", message: "Sem conexão. Confira a internet e tente de novo." });
});

// --- the lyrics editor's starting text -----------------------------------------------

test("lyricsToText writes synced lyrics back as LRC and plain lyrics as lines", () => {
  const synced = { synced: true, instrumental: false, lines: [{ t: 500, text: "Um" }, { t: 62_345, text: "" }, { t: 3_600_000, text: "Três" }] };
  expect(lyricsToText(synced)).toBe("[00:00.50]Um\n[01:02.35]\n[60:00.00]Três");
  const plain = { synced: false, instrumental: false, lines: [{ t: null, text: "Um" }, { t: null, text: "Dois" }] };
  expect(lyricsToText(plain)).toBe("Um\nDois");
  expect(lyricsToText(null)).toBe("");
  expect(lyricsToText({ synced: false, instrumental: true, lines: [] })).toBe("");
});
