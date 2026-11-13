import { createServer } from 'node:http';
import { waitForDatabase } from './db/pool.js';
import { applySchemaAndSeed } from './db/seed.js';
import { env } from './env.js';
import { handleRequest } from './http/app.js';
import { purgeExpiredKeys } from './http/idempotency.js';
import { ensureBucket } from './services/s3.js';
import { startBillingSync } from './workers/billing-sync.js';
import { startMailer } from './workers/mailer.js';

import './http/routes/session.js';
import './http/routes/bookings.js';
import './http/routes/materials.js';
import './http/routes/interpreters.js';
import './http/routes/billing.js';

const KEY_PURGE_INTERVAL_MS = 60 * 60 * 1000;

async function main(): Promise<void> {
  const server = createServer((req, res) => {
    void handleRequest(req, res);
  });
  server.listen(env.appPublicPort, '0.0.0.0');

  await waitForDatabase();
  await applySchemaAndSeed();

  void ensureBucket().catch(() => undefined);

  startMailer();
  startBillingSync();
  setInterval(() => {
    void purgeExpiredKeys().catch(() => undefined);
  }, KEY_PURGE_INTERVAL_MS).unref();
}

void main();
