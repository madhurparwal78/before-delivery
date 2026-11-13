import http from "node:http";
import { ensureCounters } from "./allowance";
import { config } from "./config";
import { migrate, pool } from "./db";
import { startExports } from "./exports";
import { dispatch, errorReply, send, serveStatic } from "./http";
import { hub } from "./live";
import { startMail } from "./mail";
import { exportQueue } from "./queue";
import { apiRoutes } from "./routes";
import { ensureBucket } from "./s3";
import { ensureSeedObjects, seed, seedMediaSha } from "./seed";
import { upgradeOlderProjects } from "./upgrade";

/** Retries a start-up step for up to a minute, like the Postgres connection. */
async function retried(step: () => Promise<void>): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      return await step();
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

/** Everything after the schema is ready runs while the server keeps answering. */
async function settle(): Promise<void> {
  await upgradeOlderProjects();
  await ensureBucket().catch(() => undefined);
  await ensureSeedObjects(seedMediaSha());
  await retried(ensureCounters);
  startExports();
  startMail();
  setInterval(() => hub.sweepExpired(), 500).unref();
}

const schemaReady = migrate(seed);
schemaReady.then(settle).catch((error: unknown) => {
  process.stderr.write(`boot failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});

const server = http.createServer((request, response) => {
  void (async () => {
    try {
      const path = new URL(request.url ?? "/", "http://local").pathname;
      if (path !== "/api/health") await schemaReady;
      send(response, path.startsWith("/api/") ? await dispatch(apiRoutes, request) : await serveStatic(request));
    } catch (error) {
      send(response, errorReply(error));
    }
  })();
});

server.on("upgrade", (request, socket, head) => hub.upgrade(request, socket, head));
server.listen(config.port, "0.0.0.0");

async function shutdown(): Promise<void> {
  hub.closeAll();
  await exportQueue.close();
  server.close();
  await pool.end().catch(() => undefined);
  process.exit(0);
}

process.on("unhandledRejection", (reason) => process.stderr.write(`unhandled rejection: ${String(reason)}\n`));
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
