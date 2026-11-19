// Entry point: schema, seed applied once at first start, then serve. The
// server starts and serves even if MinIO or Valkey is unreachable, and keeps
// retrying Postgres at boot.
import { startServer } from './app';
import { pool } from './db';
import { applySchema } from './db';
import { seedOnce } from './seed';
import { startWorker } from './worker';

async function main(): Promise<void> {
  for (;;) {
    try {
      await pool.query('SELECT 1');
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  await applySchema();
  await startServer();
  void seedOnce().catch((e) => console.error('seed failed', e));
  void startWorker();
}

void main();
