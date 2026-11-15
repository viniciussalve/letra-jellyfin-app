import { expect, test } from "vitest";
import { isLrc, parseLrc } from "../../server/lib/lyrics/lrc.ts";
import { parsePlain } from "../../server/lib/lyrics/plain.ts";
import { parseLyricsText } from "../../server/lib/lyrics/parse.ts";

test("timestamps in ms, sorted, multi-tag lines expanded", () => {
  const l = parseLrc("[00:05.00]b\n[00:01.5][00:09.250]a\n[ar:X]\n[length:03:00]");
  expect(l.lines).toEqual([{ t: 1500, text: "a" }, { t: 5000, text: "b" }, { t: 9250, text: "a" }]);
  expect(l.synced).toBe(true);
  expect(l.instrumental).toBe(false);
});
test("positive offset makes lyrics appear sooner", () => expect(parseLrc("[offset:+500]\n[00:01.00]a\n[00:02]b\n[00:03]c").lines[0].t).toBe(500));
test("negative offset delays lyrics", () => expect(parseLrc("[offset:-250]\n[00:01.00]a\n[00:02]b\n[00:03]c").lines[0].t).toBe(1250));
test("offset clamps at 0", () => expect(parseLrc("[offset:+2000]\n[00:01.00]a\n[00:02]b\n[00:03]c").lines[0].t).toBe(0));
test("enhanced word tags stripped", () => expect(parseLrc("[00:01.00]<00:01.00>Hi <00:01.50>there\n[00:02]x\n[00:03]y").lines[0].text).toBe("Hi there"));
test("empty timed line kept as break", () => expect(parseLrc("[00:01]a\n[00:02]\n[00:03]b").lines[1]).toEqual({ t: 2000, text: "" }));
test("leading and trailing breaks trimmed", () =>
  expect(parseLrc("[00:01]\n[00:02]a\n[00:03]\n[00:04]b\n[00:05]").lines.map((x) => x.text)).toEqual(["a", "", "b"]));
test("isLrc needs 3 timed lines", () => { expect(isLrc("[00:01]a\n[00:02]b")).toBe(false); expect(isLrc("[00:01]a\n[00:02]b\n[00:03]c")).toBe(true); });
test("plain keeps blank lines as breaks, trims CRLF", () =>
  expect(parsePlain("a\r\n\r\nb").lines).toEqual([{ t: null, text: "a" }, { t: null, text: "" }, { t: null, text: "b" }]));
test("plain trims leading and trailing breaks", () =>
  expect(parsePlain("\n\na\n\nb\n\n").lines.map((x) => x.text)).toEqual(["a", "", "b"]));
test("parseLyricsText null on whitespace", () => expect(parseLyricsText("  \n ")).toBeNull());
test("parseLyricsText picks LRC or plain", () => {
  expect(parseLyricsText("[00:01]a\n[00:02]b\n[00:03]c")?.synced).toBe(true);
  expect(parseLyricsText("a\nb")?.synced).toBe(false);
});
