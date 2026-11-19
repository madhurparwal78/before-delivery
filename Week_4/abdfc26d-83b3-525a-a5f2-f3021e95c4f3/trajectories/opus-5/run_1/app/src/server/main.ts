import { config } from './config.js';
import { pool, query } from './db/pool.js';
import { schemaSql } from './db/schema.js';
import { applySeed } from './db/seed.js';
import { bootstrapKeycloak } from './auth/keycloakAdmin.js';
import { createApp } from './http/app.js';
import { ensureCatalog, registerCallback } from './providers/killbill.js';
import { consumeRenderJobs } from './providers/queue.js';
import { ensureBucket } from './providers/storage.js';
import { pollUnconfirmedPayments, sweepBilledPlans } from './services/billing.js';
import { renderPendingInvoices } from './services/invoices.js';
import { drainOutbox } from './services/outbox.js';
import { endDuePlans } from './services/plans.js';
import { mailReachable, runServiceProbes } from './services/probes.js';
import { renderPendingCreditNotes } from './services/refunds.js';
import { runRenderJob } from './services/renders.js';
import { everySeconds } from './workers/schedule.js';

const SCHEMA_RETRY_SECONDS = 2;

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

/** Postgres unreachable at boot: retry every 2 seconds until the schema is in place. */
async function applySchema(): Promise<void> {
  for (;;) {
    try {
      await query(schemaSql);
      return;
    } catch (error) {
      process.stderr.write(`waiting for Postgres: ${String(error)}\n`);
      await sleep(SCHEMA_RETRY_SECONDS);
    }
  }
}

/**
 * Start-up work that needs other services. It retries in the background so the
 * app serves while a dependency is down.
 */
async function bootstrapDependencies(): Promise<void> {
  await ensureBucket().catch(() => undefined);
  await ensureCatalog().catch(() => undefined);
  await registerCallback().catch(() => undefined);

  for (let attempt = 0; ; attempt += 1) {
    try {
      await applySeed(await bootstrapKeycloak());
      return;
    } catch (error) {
      process.stderr.write(`seed attempt ${attempt + 1} failed: ${String(error)}\n`);
      await sleep(SCHEMA_RETRY_SECONDS);
    }
  }
}

function startBackgroundWork(): void {
  everySeconds(10, runServiceProbes);
  everySeconds(2, pollUnconfirmedPayments);
  everySeconds(30, renderPendingInvoices);
  everySeconds(30, renderPendingCreditNotes);
  everySeconds(5, async () => drainOutbox(mailReachable()));
  everySeconds(60, endDuePlans);
  everySeconds(60, sweepBilledPlans);

  everySeconds(10, async () => {
    await consumeRenderJobs(async (job) => {
      await runRenderJob(job.render_id);
    });
  });
}

async function main(): Promise<void> {
  await applySchema();

  const app = createApp();
  const server = app.listen(config.appPublicPort, '0.0.0.0', () => {
    process.stdout.write(`Phosphene Yard listening on port ${config.appPublicPort}\n`);
  });

  void bootstrapDependencies();
  startBackgroundWork();

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    setTimeout(() => process.exit(0), 5000).unref();
    server.closeAllConnections();
    server.close(() => {
      void pool.end().finally(() => process.exit(0));
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

void main();
