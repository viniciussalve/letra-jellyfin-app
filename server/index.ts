import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { closeOnSignals } from "./shutdown.ts";

const config = loadConfig(process.env);
const app = await buildApp(config);
closeOnSignals(app);
await app.listen({ host: "0.0.0.0", port: config.port });
console.log(`letra listening on :${config.port}`);
