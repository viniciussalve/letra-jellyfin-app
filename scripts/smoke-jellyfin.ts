// Mock Jellyfin and LRCLIB for scripts/docker-smoke.sh, on all interfaces so the container reaches them.
// Usage: node scripts/smoke-jellyfin.ts <libraryDir> <jellyfinPort> <lrclibPort>
import { startMockJellyfin, startMockLrclib } from "../test/e2e-jellyfin/mock-jellyfin.ts";

const [libraryDir, jellyfinPort, lrclibPort] = process.argv.slice(2);
if (!libraryDir || !jellyfinPort || !lrclibPort) throw new Error("usage: smoke-jellyfin.ts <libraryDir> <jellyfinPort> <lrclibPort>");

const jellyfin = await startMockJellyfin({ libraryDir, host: "0.0.0.0", port: Number(jellyfinPort) });
const lrclib = await startMockLrclib([], { host: "0.0.0.0", port: Number(lrclibPort) });
console.log(`ready api-key=${jellyfin.apiKey}`);

const stop = async () => {
  await Promise.allSettled([jellyfin.close(), lrclib.close()]);
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
