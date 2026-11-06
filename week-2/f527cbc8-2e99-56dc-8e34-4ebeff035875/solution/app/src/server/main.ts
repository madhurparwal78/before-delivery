// Clinchline server: migrations and seed, the HTTP server on 0.0.0.0, the background workers, readiness probes
// and graceful shutdown on SIGTERM (brief: Deployment; Server boundary).
import { createServer } from "node:http";
import { config } from "./config.js";
import { closePool, db } from "./db.js";
import { handle, inFlightSettled, setReadinessProbes, startDraining } from "./http.js";
import { releaseJobLeases } from "./jobs.js";
import { billingReachable } from "./killbill.js";
import { errorText, log } from "./log.js";
import { SmtpConnection } from "./mail/smtp.js";
import { migrateAndSeed } from "./migrate.js";
import { loadPractice } from "./practice.js";
import { storageReachable } from "./storage.js";
import { endAllStreams } from "./streams.js";
import { startWorkers, stopWorkers } from "./workers.js";
import "./routes/account.js";
import "./routes/barnDays.js";
import "./routes/bookings.js";
import "./routes/horses.js";
import "./routes/imports.js";
import "./routes/invoices.js";
import "./routes/practice.js";
import "./routes/prices.js";
import "./routes/vetLinks.js";
import "./routes/visits.js";

await migrateAndSeed();
await loadPractice(db);

setReadinessProbes({
  postgres: async () => (await db.query("SELECT 1")).rowCount === 1,
  minio: () => storageReachable(config.readyCheckTimeoutMs),
  killbill: () => billingReachable(config.readyCheckTimeoutMs),
  mailpit: async () => {
    const connection = await SmtpConnection.open(config.readyCheckTimeoutMs);
    connection.close();
    return true;
  },
});

const server = createServer((req, res) => void handle(req, res));
server.listen(config.port, "0.0.0.0", () => log("info", "listening", { port: config.port }));
startWorkers();

let shuttingDown = false;

/**
 * Stops accepting work at once, ends event streams, lets in-flight requests finish, returns this instance's job
 * leases with no attempt counted and exits 0 within the grace period.
 */
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log("info", "shutting down");
  startDraining();
  stopWorkers();
  endAllStreams();
  const grace = new Promise<void>((resolve) => setTimeout(resolve, Math.max(1, config.shutdownGraceSeconds - 2) * 1000));
  await Promise.race([inFlightSettled(), grace]);
  await releaseJobLeases().catch((error: unknown) => log("error", "could not return job leases", { error: errorText(error) }));
  server.close();
  server.closeAllConnections();
  await closePool().catch(() => undefined);
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
