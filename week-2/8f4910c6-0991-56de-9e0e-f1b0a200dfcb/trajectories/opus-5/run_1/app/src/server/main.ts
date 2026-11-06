import { config } from './config.js';
import { waitForDatabase } from './db.js';
import { ensureSchema } from './schema.js';
import { seedIfEmpty, seedPhotosIfMissing } from './seed.js';
import { markReady, startServer } from './server.js';
import { runSweep } from './sweep.js';
import { deliverPending } from './services/mail.js';
import { bucketReachable } from './services/storage.js';

const WORKER_INTERVAL_MS = 2_000;

function startWorkers(): void {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    const nowMs = Date.now();
    Promise.allSettled([runSweep(nowMs), deliverPending(nowMs)])
      .then((results) => {
        for (const result of results) {
          if (result.status === 'rejected') {
            process.stderr.write(`worker failed: ${String(result.reason)}\n`);
          }
        }
      })
      .finally(() => {
        running = false;
      });
  }, WORKER_INTERVAL_MS);
}

async function main(): Promise<void> {
  startServer(config.port);
  await waitForDatabase();
  await ensureSchema();
  await seedIfEmpty(Date.now());
  if (await bucketReachable()) {
    await seedPhotosIfMissing();
  } else {
    process.stderr.write('photo storage is unreachable at start-up; photo actions will answer 503\n');
  }
  markReady();
  startWorkers();
}

main().catch((error: unknown) => {
  process.stderr.write(`start-up failed: ${String(error)}\n`);
  process.exit(1);
});
