import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { config } from "./config.js";
import { connectAndMigrate } from "./db.js";
import { runChecks } from "./health.js";
import { startListening } from "./live.js";
import { ensureBucket } from "./storage.js";
import { startWorkers } from "./workers.js";

async function main(): Promise<void> {
  await connectAndMigrate();
  serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" });
  await startListening();
  await ensureBucket();
  await runChecks();
  startWorkers();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
