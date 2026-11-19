/** The app entry point: serves at once, and keeps retrying the services it needs. */

import { createServer } from 'node:http';
import { config } from './config';
import { applySchema, pool } from './db';
import { cleanSearchRateHits } from './domain/limits';
import { handleRequest } from './http/router';
import { seedIfEmpty } from './seed';
import { applySearchSettings, searchIsReachable } from './search/client';
import { startIndexWorker } from './search/pending';
import { startStorageBootstrap } from './assets/bootstrap';

const SCHEMA_RETRY_MS = 2000;
const SEARCH_RETRY_MS = 5000;
const RATE_HIT_CLEANUP_MS = 60000;

async function prepareDatabase(): Promise<void> {
  for (;;) {
    try {
      await applySchema();
      await seedIfEmpty();
      return;
    } catch (error) {
      process.stderr.write(`waiting for Postgres: ${error instanceof Error ? error.message : String(error)}\n`);
      await new Promise((resolve) => setTimeout(resolve, SCHEMA_RETRY_MS));
    }
  }
}

function startSearchSettings(): void {
  const run = async (): Promise<void> => {
    try {
      if (await searchIsReachable()) {
        await applySearchSettings();
        return;
      }
    } catch {
      // Meilisearch is unreachable: settings are applied when it returns.
    }
    setTimeout(run, SEARCH_RETRY_MS);
  };
  void run();
}

function startRateHitCleanup(): void {
  const run = async (): Promise<void> => {
    try {
      await cleanSearchRateHits(pool);
    } catch {
      // Postgres is briefly unavailable; the next pass cleans up.
    }
    setTimeout(run, RATE_HIT_CLEANUP_MS);
  };
  setTimeout(run, RATE_HIT_CLEANUP_MS);
}

const server = createServer((request, response) => {
  void handleRequest(request, response);
});

server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`Highwater listening on ${config.port}\n`);
});

void (async () => {
  await prepareDatabase();
  startIndexWorker();
  startSearchSettings();
  startStorageBootstrap();
  startRateHitCleanup();
})();
