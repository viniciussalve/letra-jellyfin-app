import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../../web/${p}`, import.meta.url), "utf8");
const SHEETS = ["shared/base.css", "shared/background.css", "player/styles.css", "upload/styles.css", "upload/saved.css", "shared/nav.css"];
const tokens = read("shared/tokens.css");
// Continuous loops, not transitions: they keep their own timing.
const LOOPS = ["drift", "dot-pulse", "breathe", "share-spin"];

describe("motion tokens", () => {
  it("defines the durations and easings", () => {
    for (const line of [
      "--dur-fast: 120ms;", "--dur-exit: 150ms;", "--dur-base: 200ms;", "--dur-move: 400ms;", "--dur-spring: 350ms;",
      "--ease-out: cubic-bezier(.22, 1, .36, 1);", "--ease-in-out: cubic-bezier(.65, 0, .35, 1);",
      "--ease-move: cubic-bezier(.2, 0, 0, 1);", "--ease-spring: cubic-bezier(.34, 1.56, .64, 1);",
      "--lyrics-follow: 500ms;",
    ]) expect(tokens).toContain(line);
  });
  it("replaces the spring with linear() where it is supported", () => {
    expect(tokens).toMatch(/@supports \(transition-timing-function: linear\(0, 1\)\)\s*\{\s*:root\s*\{\s*--ease-spring: linear\(0, 0\.051,/);
  });
});

describe("movement", () => {
  it("the cover's view-transition group moves on --ease-move over --dur-move", () => {
    const group = read("shared/base.css").match(/::view-transition-group\(cover\)\s*\{[^}]*\}/)![0];
    expect(group).toContain("animation-duration: var(--dur-move);");
    expect(group).toContain("animation-timing-function: var(--ease-move);");
  });
  it("the root cross-fades over --dur-fast", () => {
    expect(read("shared/base.css")).toMatch(/::view-transition-old\(root\),\s*::view-transition-new\(root\)\s*\{\s*animation-duration: var\(--dur-fast\);\s*\}/);
  });
  it("a cover with no counterpart on the other page fades with the root, over --dur-fast", () => {
    expect(read("shared/base.css")).toMatch(
      /::view-transition-old\(cover\):only-child,\s*::view-transition-new\(cover\):only-child\s*\{\s*animation-duration: var\(--dur-fast\);\s*\}/,
    );
  });
  it("the cover-view FLIP defaults to --ease-move", () => {
    expect(read("shared/motion.ts")).toContain('token(o.easing ?? "--ease-move")');
  });
  it("the lyrics follow on --ease-move", () => {
    const follows = [...read("player/styles.css").matchAll(/translate var\(--lyrics-follow\) var\((--[\w-]+)\)/g)].map((m) => m[1]);
    expect(follows.length).toBeGreaterThan(0);
    for (const ease of follows) expect(ease).toBe("--ease-move");
  });
});

describe("background", () => {
  it("the background field has no filter", () => {
    const field = read("shared/background.css").match(/\.bg-field\s*\{[^}]*\}/)![0];
    expect(field).not.toMatch(/\bfilter\s*:/);
    expect(field).toContain("will-change: transform;");
  });
});

describe("stylesheets", () => {
  const declarations = SHEETS.flatMap((sheet) =>
    [...read(sheet).matchAll(/(transition|animation)\s*:\s*([^;}]+)[;}]/g)].map((m) => ({ sheet, prop: m[1]!, value: m[2]!.trim() })),
  );
  it("never uses transition: all", () => {
    for (const d of declarations) if (d.prop === "transition") expect(d.value, d.sheet).not.toMatch(/(^|,\s*)all\b/);
  });
  it("has no blur on icon swaps", () => {
    for (const sheet of ["player/styles.css", "upload/styles.css"]) {
      const rules = [...read(sheet).matchAll(/([^{}]*\.icon[^{}]*)\{([^}]*)\}/g)];
      for (const [, selector, body] of rules) expect(body, `${sheet}: ${selector!.trim()}`).not.toMatch(/filter/);
    }
  });
  it("never animates filter (static blur rules stay)", () => {
    const css = read("player/styles.css");
    for (const m of css.matchAll(/transition(?:-property)?\s*:\s*([^;}]+)/g)) expect(m[1], m[0]).not.toMatch(/\bfilter\b/);
    for (const m of css.matchAll(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g)) expect(m[0]).not.toMatch(/\bfilter\s*:/);
  });
  it("moves nothing by a layout property", () => {
    const ALLOWED = [/slider-runnable-track[^}]*transition:\s*height/, /\.bar-fill[^}]*transition:\s*width/];
    for (const sheet of SHEETS) {
      const css = ALLOWED.reduce((text, ok) => text.replace(ok, ""), read(sheet));
      expect(css, sheet).not.toMatch(/transition\s*:[^;}]*\b(left|right|top|bottom|width|height|margin|padding|inset)\b/);
    }
  });
  it("takes every duration and easing from a token", () => {
    for (const d of declarations) {
      if (d.value === "none" || LOOPS.some((name) => d.value.includes(name))) continue;
      const bare = d.value.replace(/var\(--[\w-]+\)/g, "").replace(/\b0s\b/g, "");
      expect(bare, `${d.sheet}: ${d.prop}: ${d.value}`).not.toMatch(/\d*\.?\d+m?s\b|\bease\b|ease-in|ease-out|cubic-bezier|\blinear\b(?!\s*\()/);
    }
  });
});
