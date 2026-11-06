import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { migrate } from "./migrate.js";
import { startRetryWorker } from "./services/outbox.js";

const BOOT_DEADLINE_MS = 60_000;
const BOOT_RETRY_MS = 1000;

async function waitForPostgres(): Promise<void> {
  const deadline = Date.now() + BOOT_DEADLINE_MS;
  for (;;) {
    try {
      await pool.query("select 1");
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, BOOT_RETRY_MS));
    }
  }
}

async function main(): Promise<void> {
  await waitForPostgres();
  await migrate();
  serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" });
  startRetryWorker();
  console.log(`Conecount Paddock listening on 0.0.0.0:${config.port}`);
}

main().catch((error: unknown) => {
  console.error("start failed", error);
  process.exit(1);
});
