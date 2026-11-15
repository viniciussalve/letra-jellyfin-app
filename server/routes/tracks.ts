import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readSync, realpathSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, extname, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import multipart from "@fastify/multipart";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { NOT_AUDIO, tooLarge, UNKNOWN_ARTIST } from "../../shared/copy.ts";
import { ALLOWED_EXTS, MIME_BY_EXT } from "../../shared/formats.ts";
import type { SummaryResponse, Track, TrackDTO, TrackSummary } from "../../shared/types.ts";
import { getSession, requireSession } from "../auth.ts";
import type { Config } from "../config.ts";
import { lyricsToLrc, toTrack, toTrackDTO, toTrackSummary } from "../jellyfin/mapper.ts";
import type { JellyfinClient } from "../jellyfin/types.ts";
import { AppError, sendError } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import type { LrclibClient } from "../lib/lyrics/lrclib.ts";
import { parseLyricsText } from "../lib/lyrics/parse.ts";
import { resolveLyrics } from "../lib/lyrics/resolve.ts";
import { deterministicPalette } from "../lib/palette.ts";

const NOT_FOUND = () => new AppError(404, "not_found", "Música não encontrada.");
const UPLOAD_SLACK_BYTES = 65536; // multipart framing on top of the file itself
const MAX_LRC_BYTES = 1048576;
const LYRICS_VISIBILITY_TIMEOUT_MS = 2000;
const LYRICS_VISIBILITY_POLL_MS = 200;

async function waitForLyrics(
  jellyfin: Pick<JellyfinClient, "getLyrics">,
  token: string,
  itemId: string,
  timeoutMs = LYRICS_VISIBILITY_TIMEOUT_MS,
): Promise<void> {
  if (typeof jellyfin.getLyrics !== "function") return;
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      const lyrics = await jellyfin.getLyrics(token, itemId);
      if (lyrics !== null) return;
    } catch {
      // Treat transient read errors during Jellyfin's async lyrics indexing as not-yet-visible.
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, Math.min(LYRICS_VISIBILITY_POLL_MS, remaining)));
  }
}

function isFileTooLarge(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "FST_REQ_FILE_TOO_LARGE";
}

const SUMMARY_ID = /^[0-9A-Za-z_-]{1,64}$/;
const MAX_SUMMARY_IDS = 50;

// Public: the listener home refreshes its stored list from here, so cap it per client IP.
const SUMMARY_RATE_LIMIT = {
  max: 60,
  timeWindow: "1 minute",
  errorResponseBuilder: () => new AppError(429, "too_many_requests", "Muitas requisições. Espere um minuto e tente de novo."),
};

function parseSummaryIds(raw: unknown): string[] {
  const bad = () => new AppError(400, "bad_request", "Pedido inválido. Confira os dados e tente de novo.");
  if (typeof raw !== "string") throw bad();
  const ids = [...new Set(raw.split(",").map((s) => s.trim()))];
  if (ids.length < 1 || ids.length > MAX_SUMMARY_IDS || !ids.every((id) => SUMMARY_ID.test(id))) throw bad();
  return ids;
}

const MAX_STEM_BYTES = 180;

function truncateUtf8(str: string, maxBytes: number): string {
  if (Buffer.byteLength(str, "utf8") <= maxBytes) return str;
  let out = "";
  let bytes = 0;
  for (const ch of str) {
    const b = Buffer.byteLength(ch, "utf8");
    if (bytes + b > maxBytes) break;
    out += ch;
    bytes += b;
  }
  return out;
}

function sanitizeUploadFilename(rawName: string, ext: string): string {
  const base = basename(rawName.replace(/\\/g, "/")).replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, "_");
  const rawStem = base.slice(0, base.length - extname(base).length).trim();
  const truncated = truncateUtf8(rawStem, MAX_STEM_BYTES).trim();
  const safeStem = !truncated || truncated === "." || truncated === ".." ? newId() : truncated;
  return `${safeStem}.${ext}`;
}

function uniqueDestPath(realLibDir: string, safeName: string, ext: string): string {
  const candidate = resolve(realLibDir, safeName);
  if (!existsSync(candidate)) return candidate;
  const stem = safeName.slice(0, safeName.length - extname(safeName).length);
  return resolve(realLibDir, `${stem}-${newId().slice(0, 6)}.${ext}`);
}

function splitStem(fileName: string): { title: string; artist: string } {
  const stem = fileName.slice(0, fileName.length - extname(fileName).length) || fileName;
  const i = stem.indexOf(" - ");
  if (i >= 0) {
    const artist = stem.slice(0, i).trim();
    const title = stem.slice(i + 3).trim();
    if (artist && title) return { title, artist };
  }
  return { title: stem.trim(), artist: UNKNOWN_ARTIST };
}

function hasValidAudioHeader(filePath: string, ext: string): boolean {
  const buf = Buffer.alloc(12);
  let fd: number | null = null;
  let bytesRead = 0;
  try {
    fd = openSync(filePath, "r");
    bytesRead = readSync(fd, buf, 0, 12, 0);
  } finally {
    if (fd !== null) closeSync(fd);
  }
  if (bytesRead < 3) return false;
  switch (ext) {
    case "mp3":
      return (
        (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) || // ID3
        (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0) // MPEG frame sync
      );
    case "flac":
      return bytesRead >= 4 && buf.subarray(0, 4).toString("ascii") === "fLaC";
    case "ogg":
      return bytesRead >= 4 && buf.subarray(0, 4).toString("ascii") === "OggS";
    case "wav":
      return (
        bytesRead >= 12 &&
        buf.subarray(0, 4).toString("ascii") === "RIFF" &&
        buf.subarray(8, 12).toString("ascii") === "WAVE"
      );
    case "m4a":
      return bytesRead >= 8 && buf.subarray(4, 8).toString("ascii") === "ftyp";
    default:
      return false;
  }
}

export function registerTracks(app: FastifyInstance, config: Config, lrclib: LrclibClient): void {
  app.get<{ Querystring: { ids?: unknown } }>(
    "/api/tracks/summary",
    { config: { rateLimit: SUMMARY_RATE_LIMIT } },
    async (req, reply) => {
      const ids = parseSummaryIds(req.query.ids);
      const token = getSession(req, app.sessionSecret)?.accessToken ?? config.jellyfinApiKey;
      if (!token) throw new AppError(401, "unauthorized", "Entre para continuar.");

      const items = await app.jellyfin.listAudioItems(token, { ids });
      const byId = new Map(items.map((item) => [item.id, item]));
      const tracks: TrackSummary[] = [];
      for (const id of ids) {
        const item = byId.get(id);
        if (item) tracks.push(toTrackSummary(item));
      }
      return reply
        .header("Cache-Control", "no-store")
        .send({ tracks, translationEnabled: app.translation.enabled } satisfies SummaryResponse);
    },
  );

  app.register(async (scope) => {
    await scope.register(multipart, { throwFileSizeLimit: false, limits: { files: 1 } });
    scope.addHook("preHandler", requireSession(app.sessionSecret));

    const requireSessionToken = (req: FastifyRequest): string => {
      const session = getSession(req, app.sessionSecret);
      if (!session) throw new AppError(401, "unauthorized", "Entre para continuar.");
      return session.accessToken;
    };

    const tooLargeError = (req: FastifyRequest) =>
      new AppError(413, "too_large", tooLarge(Number(req.headers["content-length"] ?? 0), config.maxUploadBytes));

    scope.get<{ Querystring: { search?: unknown } }>("/api/tracks", async (req): Promise<TrackDTO[]> => {
      const token = requireSessionToken(req);
      const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;
      const items = await app.jellyfin.listAudioItems(token, search ? { search } : {});
      return items.map((item) =>
        toTrackDTO(
          toTrack(item, null, { lyricsSource: item.hasLyrics ? "embedded" : "none" }),
          config.publicUrl,
        ),
      );
    });

    scope.post("/api/tracks", async (req, reply) => {
      const token = requireSessionToken(req);
      if (!config.jellyfinLibraryDir) {
        return sendError(
          reply,
          501,
          "library_dir_not_configured",
          "Envio de áudio requer JELLYFIN_LIBRARY_DIR configurado no servidor. Você pode enviar letras (.lrc) diretamente para faixas existentes via PUT /api/tracks/:id/lyrics.",
        );
      }

      if (!req.isMultipart()) throw new AppError(400, "no_file", "Escolha um arquivo para enviar.");
      const declared = Number(req.headers["content-length"]);
      if (Number.isFinite(declared) && declared > config.maxUploadBytes + UPLOAD_SLACK_BYTES) {
        throw tooLargeError(req);
      }

      const part = await req.file({ limits: { fileSize: config.maxUploadBytes } });
      if (!part) throw new AppError(400, "no_file", "Escolha um arquivo para enviar.");

      const ext = extname(part.filename).slice(1).toLowerCase();
      if (!(ALLOWED_EXTS as readonly string[]).includes(ext)) {
        part.file.resume();
        throw new AppError(415, "not_audio", NOT_AUDIO);
      }

      mkdirSync(config.jellyfinLibraryDir, { recursive: true });
      const realLibDir = realpathSync(config.jellyfinLibraryDir);
      const safeName = sanitizeUploadFilename(part.filename, ext);
      const tmpPath = resolve(realLibDir, `.${newId()}.${ext}.tmp`);
      const prefix = realLibDir.endsWith(sep) ? realLibDir : `${realLibDir}${sep}`;
      if (!tmpPath.startsWith(prefix)) {
        part.file.resume();
        throw new AppError(400, "bad_request", "Nome de arquivo inválido.");
      }

      let destPath: string | null = null;
      try {
        try {
          await pipeline(part.file, createWriteStream(tmpPath, { flags: "wx" }));
        } catch (err) {
          if (isFileTooLarge(err)) throw tooLargeError(req);
          throw err;
        }
        if (part.file.truncated) throw tooLargeError(req);
        if (!hasValidAudioHeader(tmpPath, ext)) {
          throw new AppError(415, "not_audio", NOT_AUDIO);
        }

        const candidateDest = uniqueDestPath(realLibDir, safeName, ext);
        if (!candidateDest.startsWith(prefix)) {
          throw new AppError(400, "bad_request", "Nome de arquivo inválido.");
        }
        renameSync(tmpPath, candidateDest);
        destPath = candidateDest;

        await app.jellyfin.refreshLibrary(token);

        const actualName = basename(destPath);
        const stem = actualName.slice(0, actualName.length - extname(actualName).length) || actualName;
        const parsed = splitStem(actualName);
        const candidates = await app.jellyfin.listAudioItems(token, { search: stem });
        const scanned =
          candidates.find((it) => it.title === stem) ??
          candidates.find((it) => it.title === parsed.title) ??
          (candidates.length === 1 ? candidates[0] : undefined);

        const id = scanned?.id ?? newId();
        const title = scanned && scanned.title && scanned.title !== stem ? scanned.title : parsed.title;
        const hasRealArtist = scanned && scanned.artist && scanned.artist !== UNKNOWN_ARTIST && scanned.artist !== "Unknown Artist";
        const artist = hasRealArtist ? scanned.artist : parsed.artist;
        const album = scanned?.album ?? null;
        const durationMs = scanned?.durationMs ?? 0;

        const resolved = await resolveLyrics({ title, artist, album, durationMs }, lrclib);
        let lyrics = resolved.lyrics;
        let lyricsSource = resolved.source;

        if (lyrics !== null && scanned) {
          const lrcFileName = `${(title || scanned.id).replace(/[/\\:*?"<>|]/g, "_")}.lrc`;
          await app.jellyfin.uploadLyrics(token, scanned.id, lrcFileName, lyricsToLrc(lyrics));
          await waitForLyrics(app.jellyfin, token, scanned.id);
        } else if (lyrics === null && scanned?.hasLyrics) {
          lyrics = await app.jellyfin.getLyrics(token, scanned.id);
          if (lyrics) lyricsSource = "embedded";
        }

        const track: Track = {
          id,
          title,
          artist,
          album,
          durationMs,
          mime: MIME_BY_EXT[ext] ?? "audio/mpeg",
          ext,
          sizeBytes: statSync(destPath).size,
          hasCover: scanned?.hasCover ?? false,
          palette: deterministicPalette(id),
          lyrics,
          lyricsSource,
          lyricsLang: null,
          createdAt: scanned?.createdAt ?? new Date().toISOString(),
        };
        return reply.code(201).send(toTrackDTO(track, config.publicUrl));
      } catch (err) {
        rmSync(tmpPath, { force: true });
        if (destPath !== null) rmSync(destPath, { force: true });
        throw err;
      }
    });

    scope.post<{ Params: { id: string } }>("/api/tracks/:id/lyrics/search", async (req): Promise<TrackDTO> => {
      const token = requireSessionToken(req);
      const item = await app.jellyfin.getAudioItem(token, req.params.id);
      if (!item) throw NOT_FOUND();

      const { lyrics, source } = await resolveLyrics(
        { title: item.title, artist: item.artist, album: item.album, durationMs: item.durationMs },
        lrclib,
      );
      if (lyrics === null) {
        const existing = await app.jellyfin.getLyrics(token, item.id);
        return toTrackDTO(toTrack(item, existing), config.publicUrl);
      }

      const fileName = `${(item.title || item.id).replace(/[/\\:*?"<>|]/g, "_")}.lrc`;
      await app.jellyfin.uploadLyrics(token, item.id, fileName, lyricsToLrc(lyrics));
      await waitForLyrics(app.jellyfin, token, item.id);
      app.translationCache.clearTrackTranslations(item.id);
      return toTrackDTO(toTrack(item, lyrics, { lyricsSource: source }), config.publicUrl);
    });

    scope.put<{ Params: { id: string } }>("/api/tracks/:id/lyrics", async (req): Promise<TrackDTO> => {
      const token = requireSessionToken(req);
      let text = "";
      if (req.isMultipart()) {
        const part = await req.file({ limits: { fileSize: MAX_LRC_BYTES } });
        if (part) {
          const buf = await part.toBuffer();
          if (part.file.truncated) {
            throw new AppError(413, "too_large", tooLarge(Number(req.headers["content-length"] ?? buf.length), MAX_LRC_BYTES));
          }
          text = buf.toString("utf8");
        }
      } else {
        const body = req.body as { text?: unknown } | null | undefined;
        if (typeof body?.text === "string") text = body.text;
      }

      const lyrics = parseLyricsText(text.replace(/^\uFEFF/, ""));
      if (lyrics === null) throw new AppError(400, "empty_lyrics", "Cole a letra ou envie um arquivo .lrc.");

      const item = await app.jellyfin.getAudioItem(token, req.params.id);
      if (!item) throw NOT_FOUND();

      const fileName = `${(item.title || item.id).replace(/[/\\:*?"<>|]/g, "_")}.lrc`;
      await app.jellyfin.uploadLyrics(token, item.id, fileName, lyricsToLrc(lyrics));
      await waitForLyrics(app.jellyfin, token, item.id);
      app.translationCache.clearTrackTranslations(item.id);
      return toTrackDTO(toTrack(item, lyrics, { lyricsSource: "manual" }), config.publicUrl);
    });

    scope.delete<{ Params: { id: string } }>("/api/tracks/:id/lyrics", async (req, reply) => {
      const token = requireSessionToken(req);
      const item = await app.jellyfin.getAudioItem(token, req.params.id);
      if (!item) throw NOT_FOUND();

      await app.jellyfin.deleteLyrics(token, item.id);
      app.translationCache.clearTrackTranslations(item.id);
      return reply.code(204).send();
    });
  });
}
