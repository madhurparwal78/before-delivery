import { createServer } from "node:http";
import { config } from "./config.js";
import { ensureReady } from "./killbill.js";
import { migrate } from "./db.js";
import { handle } from "./routes.js";
import { ensureSeedUsers, seedIfEmpty } from "./seed.js";
import { startScheduler } from "./scheduler.js";

process.on("unhandledRejection", (reason) => {
  console.error("unhandled rejection:", reason instanceof Error ? reason.message : "unknown");
});

await migrate();
await seedIfEmpty();

const server = createServer((req, res) => void handle(req, res));
server.keepAliveTimeout = 65_000;
server.listen(config.port, "0.0.0.0", () => {
  console.log(`lockset listening on ${config.port}`);
});

// Keycloak, Kill Bill and the breach feed may be down at boot: each is picked up when it answers.
const SEED_RETRY_MS = 30_000;
const wake = (): void => {
  void ensureSeedUsers();
  void ensureReady().catch(() => undefined);
};
wake();
setInterval(wake, SEED_RETRY_MS);
startScheduler();
