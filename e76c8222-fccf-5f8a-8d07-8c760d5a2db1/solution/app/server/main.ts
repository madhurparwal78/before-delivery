// Starts the server: listen at once, then prepare Postgres (retrying until reachable) and the background work.
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { pool, prepareDatabase } from "./db.js";
import { createApp } from "./http.js";
import { startOutbox } from "./outbox.js";
import "./routes/admin.js";
import "./routes/cancel.js";
import "./routes/dispatch.js";
import "./routes/files.js";
import "./routes/offers.js";
import "./routes/requests.js";
import "./routes/session.js";
import "./routes/timesheets.js";
import { seed, storePendingSeedFiles } from "./seed.js";
import { startSweeps } from "./sweep.js";

let ready = false;

const clientRoot = fileURLToPath(new URL("../client", import.meta.url));
const server = await createApp(clientRoot, () => ready);
server.listen(config.port, "0.0.0.0", () => console.log(`Seatweaver listening on :${config.port}`));

for (let attempt = 1; ; attempt += 1) {
  try {
    await prepareDatabase(seed);
    break;
  } catch (error) {
    console.error(`database not ready (attempt ${attempt}):`, error instanceof Error ? error.message : error);
    await sleep(Math.min(5000, 500 * attempt));
  }
}
await storePendingSeedFiles().catch((error: unknown) => console.error("seed files:", error instanceof Error ? error.message : error));
ready = true;
startOutbox();
startSweeps();

const stop = (): void => {
  server.close();
  void pool.end().finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
