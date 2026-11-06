/**
 * The server entry point.
 *
 * It listens first, so `/api/health` answers as soon as the port is open
 * whatever the state of any provider or of the database, then applies schema
 * and seed, starts the provider probes and starts the background work. A
 * provider unreachable at boot does not stop the server and is picked up
 * without a restart.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applySchemaAndSeed } from './db/seed.js';
import { createApp } from './http/app.js';
import { startKillbillHealthProbe } from './providers/killbill.js';
import { startRegistryProbe } from './providers/registry.js';
import { startMailRetry } from './providers/mail.js';
import {
  startCallbackRegistration,
  startCollection,
  startHoldExpiry,
  startRefundRetry,
} from './workers/index.js';

const SCHEMA_RETRY_MS = 2_000;

const port = Number(process.env.APP_PUBLIC_PORT ?? 4173);
const here = dirname(fileURLToPath(import.meta.url));
const clientDir = join(here, '..', '..', 'client');

/** Keep trying until PostgreSQL is there; data routes report 503 until then. */
function prepareDatabase(): void {
  const attempt = async (): Promise<void> => {
    try {
      await applySchemaAndSeed();
      console.log('[db] schema and seed applied');
      startCollection();
      startHoldExpiry();
      startRefundRetry();
      startMailRetry();
      startCallbackRegistration();
    } catch (error) {
      console.error('[db] not ready:', error instanceof Error ? error.message : error);
      setTimeout(() => void attempt(), SCHEMA_RETRY_MS);
    }
  };
  void attempt();
}

const app = createApp(clientDir);
app.listen(port, '0.0.0.0', () => {
  console.log(`[http] listening on 0.0.0.0:${port}`);
  startKillbillHealthProbe();
  startRegistryProbe();
  prepareDatabase();
});
