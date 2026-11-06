import { createServer } from "node:http";
import { config } from "./config.ts";
import { isReady, markReady, pool } from "./db.ts";
import { serveAsset, serveDocument } from "./documents.ts";
import { internalError, sendError } from "./http.ts";
import { startMailWorker } from "./mail.ts";
import { handleApi } from "./router.ts";
import { migrateAndSeed } from "./seed.ts";
import { prepareStorage } from "./storage.ts";
import "./routes/auth.ts";
import "./routes/diagrams.ts";
import "./routes/shares.ts";
import "./routes/files.ts";
import "./routes/platform.ts";

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  const work = async () => {
    if (path.startsWith("/api/")) {
      if (!isReady() && path !== "/api/health") {
        req.resume();
        return sendError(res, internalError(503));
      }
      return handleApi(req, res, path);
    }
    req.resume();
    if (await serveAsset(res, path)) return;
    if (!isReady()) return sendError(res, internalError(503));
    return serveDocument(req, res, url);
  };
  work().catch(() => {
    console.error(`unexpected error serving a ${req.method} request`);
    if (!res.headersSent) sendError(res, internalError());
    else res.destroy();
  });
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(`Scopewright listening on port ${config.port}`);
});

/** Connects to PostgreSQL, retrying every 2 seconds, then applies schema and seed data. */
async function boot(): Promise<void> {
  for (;;) {
    try {
      const client = await pool.connect();
      try {
        await migrateAndSeed(client);
      } finally {
        client.release();
      }
      markReady();
      console.log("Database ready");
      break;
    } catch {
      console.error("Database not reachable yet; retrying in 2 seconds");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  await prepareStorage();
  startMailWorker();
}

void boot();

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close();
    void pool.end().finally(() => process.exit(0));
  });
}
