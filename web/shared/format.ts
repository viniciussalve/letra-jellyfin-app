function clock(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** m:ss under an hour, h:mm:ss from one hour up; negative or NaN clamps to 0:00. */
export function formatTime(ms: number): string {
  return clock(ms);
}

/** Remaining time with U+2212 MINUS SIGN, e.g. "−2:17". */
export function formatRemaining(ms: number): string {
  return `−${clock(ms)}`;
}
