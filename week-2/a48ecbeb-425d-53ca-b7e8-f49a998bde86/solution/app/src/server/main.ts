import { createServer } from "node:http";
import { handle } from "./app.js";
import { config } from "./config.js";
import { startDb } from "./db.js";
import { stockChanged } from "./domain/stock.js";
import { refreshStatus } from "./health.js";
import { ensureCatalog } from "./killbill.js";
import { ensureCollections, followRealtime, realtimeUp, seedAccounts } from "./pocketbase.js";
import { closeLive, liveHeartbeat, relayRealtime } from "./routes/storefront.js";
import { startWorkers } from "./workers.js";

// Serves at once, then brings each service up in the background, retrying while it is down.

const server = createServer((req, res) => {
  void handle(req, res);
});
server.requestTimeout = 120_000;
server.listen(config.port, "0.0.0.0", () => {
  console.log(`Ceibo Shop & Cellar listening on port ${config.port}`);
});

/** Retries `work` every few seconds until it succeeds once. */
async function untilDone(work: () => Promise<void>): Promise<void> {
  for (;;) {
    try {
      await work();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

void refreshStatus();
setInterval(() => void refreshStatus(), 3000);
void startDb(() => stockChanged(["guava-lime", "yuzu-ginger", "passionfruit-basil", "cacao-orange"]));
void untilDone(ensureCatalog);
void untilDone(async () => {
  await ensureCollections();
  await seedAccounts();
  void followRealtime(relayRealtime);
});
setInterval(() => (realtimeUp() ? liveHeartbeat() : closeLive()), 15_000);
startWorkers();

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    closeLive();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
