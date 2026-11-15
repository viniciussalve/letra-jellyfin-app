import { expect, test } from "vitest";
import { newId } from "../../server/lib/ids.ts";

test("10 base62 chars, unique", () => {
  const ids = new Set(Array.from({ length: 1000 }, newId));
  expect(ids.size).toBe(1000);
  for (const id of ids) expect(id).toMatch(/^[0-9A-Za-z]{10}$/);
});
