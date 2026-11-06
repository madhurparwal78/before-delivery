// Serve: wait for Postgres (retrying every two seconds), apply the schema and seed, start the
// background workers, then listen on 0.0.0.0:APP_PUBLIC_PORT.

import { createServer } from "node:http";
import { config } from "./config.js";
import { pool } from "./db.js";
import { handleApi } from "./http/pipeline.js";
import { SECURITY_HEADERS, serveStatic } from "./http/static.js";
import { registerRoutes } from "./routes.js";
import { migrateAndSeed } from "./seed.js";
import { startWorkers } from "./workers.js";

async function waitForPostgres(): Promise<void> {
  for (;;) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      console.error(`Postgres not ready (${error instanceof Error ? error.message : String(error)}); retrying in 2 s`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function main(): Promise<void> {
  await waitForPostgres();
  await migrateAndSeed();
  registerRoutes();
  startWorkers();
  const server = createServer((req, res) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    const handled = (req.url ?? "/").startsWith("/api/") ? handleApi(req, res) : serveStatic(req, res);
    handled.catch((error: unknown) => {
      console.error(`${req.method} ${req.url} crashed:`, error);
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "internal" }));
    });
  });
  server.requestTimeout = 60_000;
  server.listen(config.port, "0.0.0.0", () => console.log(`Railside listening on 0.0.0.0:${config.port}`));
  const stop = (): void => {
    server.close();
    void pool.end().finally(() => process.exit(0));
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

void main().catch((error: unknown) => {
  console.error("Railside failed to start:", error);
  process.exit(1);
});
