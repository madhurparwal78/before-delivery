import { createServer } from 'node:http';
import { applySchema, seedIfEmpty, waitForDatabase } from './db/seed.js';
import { config } from './env.js';
import { startEventStream } from './events.js';
import { handleRequest } from './http/router.js';
import { startJobs } from './jobs.js';
import { markReady } from './routes/meta.js';
import { startMonitor } from './services/monitor.js';
import { ensureBucket } from './services/storage.js';

const server = createServer((req, res) => {
  void handleRequest(req, res);
});

server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`Promptside is listening on ${config.port}\n`);
});

async function boot(): Promise<void> {
  await waitForDatabase();
  await applySchema();
  await seedIfEmpty();
  markReady();
  startMonitor();
  startEventStream();
  await ensureBucket().catch(() => undefined);
  startJobs();
}

void boot();
