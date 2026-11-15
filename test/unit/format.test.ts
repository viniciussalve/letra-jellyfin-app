import { expect, test } from "vitest";
import { formatRemaining, formatTime } from "../../web/shared/format.ts";

test("minutes and seconds", () => {
  expect(formatTime(130000)).toBe("2:10");
  expect(formatTime(0)).toBe("0:00");
  expect(formatTime(9999)).toBe("0:09");
});
test("hours", () => expect(formatTime(3725000)).toBe("1:02:05"));
test("negative and NaN clamp to zero", () => {
  expect(formatTime(-5000)).toBe("0:00");
  expect(formatTime(Number.NaN)).toBe("0:00");
});
test("remaining uses U+2212", () => {
  expect(formatRemaining(137000)).toBe("−2:17");
  expect(formatRemaining(137000).charCodeAt(0)).toBe(0x2212);
});
