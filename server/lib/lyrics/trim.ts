import type { Line } from "../../../shared/types.ts";

/** Drops empty-text lines at the start and end. */
export function trimBreaks(lines: Line[]): Line[] {
  let a = 0;
  let b = lines.length;
  while (a < b && lines[a].text === "") a++;
  while (b > a && lines[b - 1].text === "") b--;
  return lines.slice(a, b);
}
