// Starts Kerfwell Rack: waits for PostgreSQL, applies the schema and seed, then serves.
import { createServer } from "node:http";
import { probeBilling } from "./billing";
import { config } from "./config";
import { migrateAndSeed, pool, waitForDatabase } from "./db";
import { handle, ok, route } from "./http";
import { servicesReport, startProbes } from "./services";
import { probeStorage } from "./storage";
import { now, releaseExpiredHolds } from "./store";
import "./routes/session";
import "./routes/boards";
import "./routes/layouts";
import "./routes/photos";
import "./routes/stock";
import "./routes/holds";
import "./routes/tickets";

route("GET", "/api/health", async () => ok({ status: "ok" }));
route("GET", "/api/services", async () => ok(servicesReport()));

const SWEEP_EVERY_MS = 1000;

function sweepExpiredHolds(): void {
  releaseExpiredHolds(pool, now())
    .catch((error: unknown) => console.error("expiry sweep failed:", error instanceof Error ? error.message : String(error)))
    .finally(() => setTimeout(sweepExpiredHolds, SWEEP_EVERY_MS).unref());
}

await waitForDatabase();
await migrateAndSeed();
startProbes({ billing: probeBilling, storage: probeStorage });
sweepExpiredHolds();

const server = createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    console.error("request failed:", error);
    res.destroy();
  });
});
server.keepAliveTimeout = 5000;
server.listen(config.port, "0.0.0.0", () => console.log(`Kerfwell Rack listening on 0.0.0.0:${config.port}`));

const stop = (): void => {
  server.close();
  pool.end().finally(() => process.exit(0));
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
