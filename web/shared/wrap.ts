/**
 * Greedy line wrapping for canvas text. Breaks at spaces; a word wider than
 * maxWidth on its own (or a CJK run with no spaces) is broken by characters.
 * When the text needs more than maxLines, the last line is trimmed until it
 * fits with a trailing "…". Pure: the caller supplies the measure function.
 */
export function wrapLines(text: string, maxWidth: number, measure: (s: string) => number, maxLines: number): string[] {
  if (maxLines <= 0) return [];
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  // Puts a word on a fresh line, breaking it by characters when it does not fit.
  const place = (word: string) => {
    if (measure(word) <= maxWidth) {
      line = word;
      return;
    }
    line = "";
    for (const ch of Array.from(word)) {
      if (line !== "" && measure(line + ch) > maxWidth) {
        lines.push(line);
        line = ch;
      } else {
        line += ch;
      }
    }
  };

  for (const word of words) {
    if (line === "") place(word);
    else if (measure(`${line} ${word}`) <= maxWidth) line = `${line} ${word}`;
    else {
      lines.push(line);
      place(word);
    }
  }
  if (line !== "") lines.push(line);

  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = withEllipsis(kept[maxLines - 1]!, maxWidth, measure);
  return kept;
}

/** Trims `line` (by characters) until `line + "…"` fits, then appends the ellipsis. */
export function withEllipsis(line: string, maxWidth: number, measure: (s: string) => number): string {
  const chars = Array.from(line.trimEnd());
  while (chars.length > 0 && measure(`${chars.join("")}…`) > maxWidth) chars.pop();
  return `${chars.join("").trimEnd()}…`;
}
