/**
 * Boot. Postgres is required, so the schema and the seed are applied before
 * anything else; Kill Bill, Mailpit and MinIO being unreachable never stops
 * the app or its health check.
 */

import { createServer } from 'node:http';
import { config } from './config.js';
import { pool, waitForDatabase, withAdvisoryLock } from './db.js';
import { SCHEMA_SQL } from './schema.js';
import { loadSeed } from './seed.js';
import { Router } from './http/router.js';
import { handleApiRequest } from './http/pipeline.js';
import { handleStaticRequest } from './http/static.js';
import { startComplianceScan } from './jobs/complianceScan.js';
import { startHoldExpirySweep } from './jobs/holdExpiry.js';
import { startOutboxSender } from './jobs/outbox.js';
import { sessionRoutes } from './routes/session.js';
import { renterRoutes } from './routes/renters.js';
import { documentRoutes } from './routes/documents.js';
import { packRoutes } from './routes/packs.js';
import { stationRoutes } from './routes/stations.js';
import { bookingRoutes } from './routes/bookings.js';
import { statementRoutes } from './routes/statements.js';
import { shelfRoutes } from './routes/shelf.js';
import { linkRoutes } from './routes/links.js';
import { miscRoutes } from './routes/misc.js';

const SEED_RETRY_MS = 5_000;
const SCHEMA_LOCK = 0x5241_494d;

function buildRouter(): Router {
  const router = new Router();
  router.addAll(sessionRoutes);
  router.addAll(renterRoutes);
  router.addAll(documentRoutes);
  router.addAll(packRoutes);
  router.addAll(stationRoutes);
  router.addAll(bookingRoutes);
  router.addAll(statementRoutes);
  router.addAll(shelfRoutes);
  router.addAll(linkRoutes);
  router.addAll(miscRoutes);
  return router;
}

/** The seed needs MinIO for its scans, so it retries until storage answers. */
async function loadSeedWhenPossible(): Promise<void> {
  for (;;) {
    try {
      await loadSeed();
      return;
    } catch (error: unknown) {
      process.stderr.write(`seed deferred: ${String(error)}\n`);
      await new Promise((resolve) => setTimeout(resolve, SEED_RETRY_MS));
    }
  }
}

async function main(): Promise<void> {
  await waitForDatabase();
  await withAdvisoryLock(SCHEMA_LOCK, () => pool.query(SCHEMA_SQL).then(() => undefined));

  const router = buildRouter();
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      void handleApiRequest(router, request, response, url);
      return;
    }
    request.resume();
    void handleStaticRequest(request.method ?? 'GET', url.pathname, response).catch(() => {
      response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'not_found' }));
    });
  });

  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`railside listening on 0.0.0.0:${config.port}\n`);
  });

  // The health check is already answering; the jobs wait for the seed so the
  // first compliance scan sees the seeded renters.
  await loadSeedWhenPossible();
  startHoldExpirySweep();
  startOutboxSender();
  startComplianceScan();
}

void main();
