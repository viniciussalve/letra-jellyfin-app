#!/usr/bin/env node
// Measures dropped frames in three interactions of the built front end (dist/web):
//   1. home -> player (cross-document view transition, the cover flies from the tile),
//   2. player -> cover view -> player (the full-screen button with the Fullscreen API removed),
//   3. the lyrics following four verse changes (seeks to 0.6, 2.6, 4.6 and 6.6 s).
// Each runs in Chromium at 390x844 and at 1440x900, device scale 2, CPU throttled 4x.
//
// Run from the repo root after `npx vite build`:
//   node scripts/perf-motion.mjs [--json out.json]
//
// Frames come from a requestAnimationFrame loop that an init script starts on every page. The
// page being left saves its timestamps to sessionStorage on pagehide, so the two documents of a
// navigation join into one record. The loop cannot see the gap between the two documents (nothing
// runs in it) nor what the compositor does with a frame it already has; a frame it shows late
// but the page produced on time is not counted. Frame gaps are taken inside each document, never
// across the navigation; the gap itself is reported in the JSON as `navGapMs`.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium, request: apiRequest } = require("@playwright/test");

const APP = fileURLToPath(new URL("..", import.meta.url));
const PORT = 4398;
const BASE = `http://127.0.0.1:${PORT}`;
const USERNAME = "jelly";
const PASSWORD = "jelly-pass";
const CPU_THROTTLE = 4;
const GUARD_MS = 15_000;
const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844 },
  { name: "1440x900", width: 1440, height: 900 },
];
const SEEKS = [0.6, 2.6, 4.6, 6.6];
const IDLE_MS = 2500; // about as long as the lyrics window
// One missed frame at 60 Hz is 33 ms; timestamps jitter by up to ~9 ms around 16.7, so 25 ms is the
// lowest gap that is a missed frame and not jitter.
const MISSED_MS = 25;
const LONG_MS = 33;

const fail = (message) => {
  console.error(`perf-motion: ${message}`);
  process.exitCode = 1;
};

function parseArgs(argv) {
  const out = { json: null, runs: 1 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") {
      out.json = argv[++i];
      if (!out.json) throw new Error("--json needs a file name");
    } else if (argv[i] === "--runs") {
      out.runs = Number(argv[++i]);
      if (!Number.isInteger(out.runs) || out.runs < 1) throw new Error("--runs needs a whole number of 1 or more");
    } else {
      throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  return out;
}

/** Starts the E2E server (fake translator) and resolves once /healthz answers. */
async function startServer() {
  const child = spawn("node", ["test/e2e/server.ts"], {
    cwd: APP,
    env: { ...process.env, E2E_PORT: String(PORT), E2E_TRANSLATOR: "fake" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  let exited = false;
  child.on("exit", () => (exited = true));
  const deadline = Date.now() + GUARD_MS;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`the server exited early:\n${stderr}`);
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) {
        // Another process may hold the port and answer for us; our own server would have exited.
        await new Promise((r) => setTimeout(r, 300));
        if (exited) throw new Error(`port ${PORT} is held by another process (our server exited):\n${stderr}`);
        return child;
      }
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill("SIGTERM");
  throw new Error(`the server did not answer on ${BASE} in ${GUARD_MS} ms:\n${stderr}`);
}

function stopServer(child) {
  if (child && child.exitCode === null) child.kill("SIGTERM");
}

/** Logs in as the owner and uploads song.mp3 twice; returns the two tracks. */
async function uploadTwice() {
  const api = await apiRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": "10.9.8.7" } });
  try {
    const login = await api.post("/api/session", { data: { username: USERNAME, password: PASSWORD } });
    if (!login.ok()) throw new Error(`login failed: ${login.status()}`);
    const buffer = readFileSync(new URL("../test/fixtures/song.mp3", import.meta.url));
    const tracks = [];
    for (let i = 0; i < 2; i++) {
      const res = await api.post("/api/tracks", { multipart: { file: { name: "song.mp3", mimeType: "audio/mpeg", buffer } } });
      if (res.status() !== 201) throw new Error(`upload failed: ${res.status()} ${await res.text()}`);
      tracks.push(await res.json());
    }
    return tracks;
  } finally {
    await api.dispose();
  }
}

/** Runs on every page before its own scripts: records frame times and when a view transition ends. */
function recorder() {
  const w = window;
  w.__frames = [];
  w.__vtEnd = null;
  const loop = (t) => {
    w.__frames.push(performance.timeOrigin + t);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  addEventListener("pagereveal", (e) => {
    const stamp = () => (w.__vtEnd = performance.timeOrigin + performance.now());
    if (e.viewTransition) e.viewTransition.finished.then(stamp, stamp);
    else stamp();
  });
  addEventListener("pagehide", () => {
    try {
      const prev = JSON.parse(sessionStorage.getItem("perf.docs") ?? "[]");
      prev.push(w.__frames);
      sessionStorage.setItem("perf.docs", JSON.stringify(prev));
    } catch {
      // storage blocked: the earlier document's frames are lost
    }
  });
}

const noFullscreenApi = () => Object.defineProperty(Document.prototype, "fullscreenEnabled", { get: () => false });

/** Resolves when no finite animation or transition is running in the document, two frames from now on. */
const settled = () =>
  new Promise((resolve) => {
    const check = () => {
      const running = document
        .getAnimations()
        .some((a) => a.playState === "running" && a.effect && Number.isFinite(a.effect.getComputedTiming().endTime));
      if (running) requestAnimationFrame(check);
      else resolve(performance.timeOrigin + performance.now());
    };
    requestAnimationFrame(() => requestAnimationFrame(check));
  });

const now = () => performance.timeOrigin + performance.now();

async function newPage(browser, viewport, init) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
    locale: "pt-BR",
    extraHTTPHeaders: { "x-forwarded-for": "10.9.8.6" },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(GUARD_MS);
  await page.addInitScript(recorder);
  if (init) await init(page);
  return { page, context };
}

async function throttle(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
}

/** Frames inside [start, end] and the gaps between neighbours of one document. */
function analyse(docs, start, end) {
  const gaps = [];
  let frames = 0;
  for (const doc of docs) {
    const inside = doc.filter((t) => t >= start && t <= end);
    frames += inside.length;
    for (let i = 1; i < inside.length; i++) gaps.push(inside[i] - inside[i - 1]);
  }
  return {
    frames,
    over25: gaps.filter((g) => g > MISSED_MS).length,
    over33: gaps.filter((g) => g > LONG_MS).length,
    longestMs: gaps.length ? Math.round(Math.max(...gaps) * 10) / 10 : 0,
  };
}

async function homeToPlayer(browser, viewport, tracks) {
  const recents = tracks.map((t, i) => ({ id: t.id, title: t.title, artist: t.artist, hasCover: t.hasCover, at: Date.now() - i }));
  const { page, context } = await newPage(browser, viewport, (p) => p.addInitScript(seedRecents, recents));
  try {
    await page.goto("/");
    await page.locator("a[data-recent]").first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(settled);
    await throttle(page);
    const start = await page.evaluate(now);
    await page.locator("a[data-recent]").first().click();
    await page.waitForURL(/\/t\//);
    await page.locator("[data-play]").waitFor();
    await page.waitForFunction(() => window.__vtEnd !== null);
    const end = await page.evaluate(() => window.__vtEnd);
    const current = await page.evaluate(() => window.__frames);
    const earlier = await page.evaluate(() => JSON.parse(sessionStorage.getItem("perf.docs") ?? "[]"));
    const result = analyse([...earlier, current], start, end);
    const first = current.find((t) => t >= start);
    const before = earlier.flat().filter((t) => t >= start);
    const navGapMs = first !== undefined && before.length ? Math.round((first - Math.max(...before)) * 10) / 10 : null;
    return { ...result, navGapMs, spanMs: Math.round(end - start) };
  } finally {
    await context.close();
  }
}

/** Init script: stores the listener's recents once per tab, before the page's own scripts run. */
function seedRecents(list) {
  try {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("letra.recents.v1", JSON.stringify(list));
  } catch {
    // storage blocked
  }
}

async function openPlayer(browser, viewport, track, init) {
  const made = await newPage(browser, viewport, init);
  await made.page.goto(track.shareUrl);
  await made.page.locator("[data-play]").waitFor();
  await made.page.evaluate(() => document.fonts.ready);
  await made.page.evaluate(settled);
  return made;
}

async function coverView(browser, viewport, track) {
  const { page, context } = await openPlayer(browser, viewport, track, (p) => p.addInitScript(noFullscreenApi));
  try {
    await throttle(page);
    const start = await page.evaluate(now);
    await page.locator("[data-fullscreen]").click();
    await page.waitForFunction(() => document.querySelector(".player")?.dataset.lyrics === "off");
    await page.evaluate(settled);
    await page.locator("[data-fullscreen]").click();
    await page.waitForFunction(() => document.querySelector(".player")?.dataset.lyrics === "on");
    const end = await page.evaluate(settled);
    return analyse([await page.evaluate(() => window.__frames)], start, end);
  } finally {
    await context.close();
  }
}

async function lyricsFollow(browser, viewport, track) {
  const { page, context } = await openPlayer(browser, viewport, track);
  try {
    await throttle(page);
    const start = await page.evaluate(now);
    for (const [k, time] of SEEKS.entries()) {
      await page.evaluate((t) => {
        document.querySelector("audio").currentTime = t;
      }, time);
      await page.waitForFunction((i) => document.querySelector(`[data-verse][data-index="${i}"]`)?.dataset.state === "active", k);
      await page.evaluate(settled);
    }
    const end = await page.evaluate(now);
    return analyse([await page.evaluate(() => window.__frames)], start, end);
  } finally {
    await context.close();
  }
}

/** The player with nothing animating, recorded for a window like the lyrics one: the renderer's own noise. */
async function idle(browser, viewport, track) {
  const { page, context } = await openPlayer(browser, viewport, track);
  try {
    await throttle(page);
    const start = await page.evaluate(now);
    await page.evaluate((ms) => new Promise((r) => setTimeout(r, ms)), IDLE_MS);
    const end = await page.evaluate(now);
    return analyse([await page.evaluate(() => window.__frames)], start, end);
  } finally {
    await context.close();
  }
}

const median = (values) => {
  const v = values.filter((x) => x !== null).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : Math.round(((v[m - 1] + v[m]) / 2) * 10) / 10;
};

/** The row-wise median of several runs of the same rows. */
const medianRows = (runs) =>
  runs[0].map((row, i) => {
    const out = { interaction: row.interaction, viewport: row.viewport };
    for (const key of Object.keys(row)) if (typeof row[key] !== "string") out[key] = median(runs.map((r) => r[i][key]));
    return out;
  });

function table(rows) {
  const head = ["Interaction", "Viewport", "Frames", `> ${MISSED_MS} ms`, `> ${LONG_MS} ms`, "Longest (ms)", "Nav gap (ms)"];
  const dash = (v) => (v === null || v === undefined ? "-" : String(v));
  const lines = [head, ...rows.map((r) => [r.interaction, r.viewport, r.frames, r.over25, r.over33, r.longestMs, dash(r.navGapMs)].map(String))];
  const widths = head.map((_, c) => Math.max(...lines.map((l) => l[c].length)));
  const fmt = (l) => `| ${l.map((cell, c) => cell.padEnd(widths[c])).join(" | ")} |`;
  return [fmt(lines[0]), `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`, ...lines.slice(1).map(fmt)].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(fileURLToPath(new URL("../dist/web/player/index.html", import.meta.url)))) {
    throw new Error("dist/web is missing; run `npx vite build` from the repo root first");
  }
  let server = null;
  let browser = null;
  const cleanup = () => stopServer(server);
  process.on("exit", cleanup);
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(130));
  try {
    server = await startServer();
    const tracks = await uploadTwice();
    browser = await chromium.launch();
    const runs = [];
    for (let n = 1; n <= args.runs; n++) {
      const rows = [];
      for (const viewport of VIEWPORTS) {
        const scenarios = [
          ["idle", () => idle(browser, viewport, tracks[0])],
          ["home -> player", () => homeToPlayer(browser, viewport, tracks)],
          ["cover view and back", () => coverView(browser, viewport, tracks[0])],
          ["lyrics follow x4", () => lyricsFollow(browser, viewport, tracks[0])],
        ];
        for (const [interaction, run] of scenarios) {
          rows.push({ interaction, viewport: viewport.name, ...(await run()) });
        }
      }
      runs.push(rows);
      if (args.runs > 1) console.log(`Run ${n}\n${table(rows)}\n`);
    }
    const medians = medianRows(runs);
    console.log(args.runs > 1 ? `Median of ${args.runs} runs\n${table(medians)}` : table(medians));
    if (args.json) {
      const meta = { cpuThrottle: CPU_THROTTLE, deviceScaleFactor: 2, missedMs: MISSED_MS, longMs: LONG_MS };
      writeFileSync(args.json, `${JSON.stringify({ ...meta, runs, medians }, null, 2)}\n`);
    }
  } finally {
    await browser?.close().catch(() => {});
    cleanup();
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
