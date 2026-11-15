// Regenerates the committed test fixtures. Needs ffmpeg on PATH. Idempotent.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import NodeID3 from "node-id3";

const dir = fileURLToPath(new URL(".", import.meta.url));
const out = (name: string) => dir + name;
const ffmpeg = (...args: string[]) =>
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-bitexact", ...args], { stdio: "inherit" });

mkdirSync(dir, { recursive: true });

const lrc = [
  "[00:00.50]Primeiro verso da música",
  "[00:02.50]Segundo verso, um pouco mais longo para quebrar a linha em telas estreitas",
  "[00:04.50]Terceiro verso",
  "[00:06.50]Último verso",
  "",
].join("\n");
writeFileSync(out("sample.lrc"), lrc, "utf8");

// 600x600 cover: left half #2F3E57, right half #738488.
ffmpeg(
  "-f", "lavfi", "-i", "color=c=0x2F3E57:s=600x600",
  "-vf", "drawbox=x=300:y=0:w=300:h=600:color=0x738488:t=fill",
  "-frames:v", "1", out("cover.png"),
);

const audio = (file: string) =>
  ffmpeg(
    "-f", "lavfi", "-i", "sine=frequency=440:duration=8:sample_rate=44100",
    "-af", "volume=-30dB", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "32k",
    "-map_metadata", "-1", "-id3v2_version", "3", "-write_id3v1", "0", "-write_xing", "1", file,
  );

audio(out("song.mp3"));
audio(out("Letra Fixtures - Sem Tags.mp3"));

const ok = NodeID3.write(
  {
    title: "Linha de Teste",
    artist: "Letra Fixtures",
    album: "Fixtures",
    image: { mime: "image/png", type: { id: 3, name: "front cover" }, description: "cover", imageBuffer: readFileSync(out("cover.png")) },
    unsynchronisedLyrics: { language: "por", text: lrc },
  },
  out("song.mp3"),
);
if (ok instanceof Error || ok !== true) throw new Error("failed to write ID3 tags");

writeFileSync(out("not-audio.mp3"), "isto não é áudio", "utf8");
console.log("fixtures written to", dir);
