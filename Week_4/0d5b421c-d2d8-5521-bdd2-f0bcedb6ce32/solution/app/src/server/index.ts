import { catalog, loadCatalog } from "./catalog.js";
import { config } from "./config.js";
import { migrateAndSeed, pool, waitForPostgres } from "./db.js";
import { startEventReader } from "./events.js";
import { createApp } from "./http.js";
import { routes } from "./routes.js";
import { probeDependencies, startWorkers } from "./worker.js";

try {
  await waitForPostgres();
} catch {
  console.error("Postgres never answered within 60 seconds");
  process.exit(1);
}

await migrateAndSeed();
await loadCatalog();
startEventReader();
await probeDependencies();
startWorkers();

const server = createApp(routes).listen(config.port, "0.0.0.0", () => {
  console.log(`Saffron & Slate Tables serving ${catalog().rooms.length} rooms on port ${config.port}`);
});

function shutDown(): void {
  server.close();
  void pool.end().finally(() => process.exit(0));
}

process.on("SIGTERM", shutDown);
process.on("SIGINT", shutDown);
