import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { closeOnSignals } from "../../server/shutdown.ts";

let log: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  log.mockRestore();
  error.mockRestore();
});

function harness(close: () => Promise<void>, graceMs = 1000) {
  const signals = new EventEmitter();
  const app = { close: vi.fn(close) };
  let resolveExit!: (code: number) => void;
  const exited = new Promise<number>((r) => (resolveExit = r));
  closeOnSignals(app, { signals, graceMs, exit: (code) => resolveExit(code) });
  return { signals, app, exited };
}

test("SIGTERM closes the app once, then exits 0", async () => {
  const { signals, app, exited } = harness(async () => {});
  signals.emit("SIGTERM", "SIGTERM");
  signals.emit("SIGINT", "SIGINT");
  expect(await exited).toBe(0);
  expect(app.close).toHaveBeenCalledTimes(1);
});

test("SIGINT works the same way", async () => {
  const { signals, app, exited } = harness(async () => {});
  signals.emit("SIGINT", "SIGINT");
  expect(await exited).toBe(0);
  expect(app.close).toHaveBeenCalledTimes(1);
});

test("a close that outlasts the grace period exits 1 instead of waiting", async () => {
  const { signals, exited } = harness(() => new Promise<void>(() => {}), 20);
  signals.emit("SIGTERM", "SIGTERM");
  expect(await exited).toBe(1);
  expect(error).toHaveBeenCalled();
});

test("a failing close exits 1", async () => {
  const { signals, exited } = harness(async () => {
    throw new Error("db busy");
  });
  signals.emit("SIGTERM", "SIGTERM");
  expect(await exited).toBe(1);
});
