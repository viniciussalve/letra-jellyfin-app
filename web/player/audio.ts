import type { TrackDTO } from "../../shared/types.ts";

export type Player = {
  /** Called with the playback position in ms: every animation frame while playing, and on seeks and pauses. */
  onTime(cb: (ms: number) => void): void;
  seek(ms: number): void;
  /** Plays or pauses. Rejects when the browser refuses to play (no gesture, unsupported file). */
  toggle(): Promise<void>;
};

const SEEK_STEP_MS = 10_000;

/** The file's real duration once the browser knows it, else the one measured at upload. */
export function durationOf(audio: HTMLAudioElement, track: TrackDTO): number {
  return Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : track.durationMs;
}

export function createPlayer(audio: HTMLAudioElement, track: TrackDTO): Player {
  const listeners: ((ms: number) => void)[] = [];
  let frame = 0;

  const now = () => audio.currentTime * 1000;
  const emit = () => {
    const ms = now();
    for (const cb of listeners) cb(ms);
  };
  const tick = () => {
    emit();
    frame = audio.paused ? 0 : requestAnimationFrame(tick);
  };
  audio.addEventListener("play", () => {
    if (frame === 0) frame = requestAnimationFrame(tick);
  });
  // While paused nothing drives frames, so position changes are reported from events.
  for (const type of ["loadedmetadata", "durationchange", "seeking", "seeked", "timeupdate", "pause", "ended"]) {
    audio.addEventListener(type, () => {
      if (frame === 0) emit();
    });
  }

  const seek = (ms: number) => {
    audio.currentTime = Math.min(Math.max(ms, 0), durationOf(audio, track)) / 1000;
    emit();
  };
  const toggle = async () => {
    if (audio.paused) await audio.play();
    else audio.pause();
  };

  wireMediaSession(audio, track, seek);

  return {
    onTime(cb) {
      listeners.push(cb);
      cb(now());
    },
    seek,
    toggle,
  };
}

/** Lock-screen and hardware-key controls: title, artist, album, cover; play, pause, ±10 s and seek-to. */
function wireMediaSession(audio: HTMLAudioElement, track: TrackDTO, seek: (ms: number) => void): void {
  if (!("mediaSession" in navigator)) return;
  const session = navigator.mediaSession;
  session.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album ?? "",
    artwork: track.hasCover ? [{ src: new URL(`/media/${encodeURIComponent(track.id)}/cover.jpg`, location.href).href, type: "image/jpeg" }] : [],
  });

  const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
    ["play", () => void audio.play().catch(() => {})],
    ["pause", () => audio.pause()],
    ["seekbackward", (d) => seek(audio.currentTime * 1000 - (d.seekOffset ?? SEEK_STEP_MS / 1000) * 1000)],
    ["seekforward", (d) => seek(audio.currentTime * 1000 + (d.seekOffset ?? SEEK_STEP_MS / 1000) * 1000)],
    ["seekto", (d) => seek((d.seekTime ?? 0) * 1000)],
  ];
  for (const [action, handler] of handlers) {
    try {
      session.setActionHandler(action, handler);
    } catch {
      // Older browsers reject actions they do not know; the rest still work.
    }
  }

  const syncPosition = () => {
    const duration = durationOf(audio, track) / 1000;
    if (!(duration > 0)) return;
    try {
      session.setPositionState({ duration, position: Math.min(audio.currentTime, duration), playbackRate: audio.playbackRate || 1 });
    } catch {
      // setPositionState throws on inconsistent values during source changes; the next event fixes it.
    }
  };
  audio.addEventListener("play", () => {
    session.playbackState = "playing";
    syncPosition();
  });
  audio.addEventListener("pause", () => {
    session.playbackState = "paused";
    syncPosition();
  });
  for (const type of ["durationchange", "seeked", "ratechange"]) audio.addEventListener(type, syncPosition);
}
