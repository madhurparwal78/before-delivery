import { pool } from './db';
import { startServer } from './http';
import { markReady } from './readiness';
import { prepare } from './seed';

const RETRY_MS = 1000;

/** Keeps trying until Postgres is up, the schema and seed exist and the seeded bodies have been written. */
async function bootUntilReady(): Promise<void> {
  for (;;) {
    try {
      await prepare();
      markReady();
      return;
    } catch (error) {
      console.error('Waiting for Postgres:', error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }
}

const server = startServer();
void bootUntilReady();

process.on('SIGTERM', () => {
  server.close();
  void pool.end().finally(() => process.exit(0));
});
