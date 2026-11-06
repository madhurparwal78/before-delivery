import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { applySchemaAndSeed } from './db/seed.js';
import { connectWithRetry } from './db/pool.js';
import { ensureCatalog } from './services/killbill.js';
import { startWorkers } from './workers.js';

async function main(): Promise<void> {
  /* A missing address, credential, bucket, sender or port stops the start. */
  const config = loadConfig();

  const app = createApp();
  const server = app.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`Plotwright is listening on ${config.port}\n`);
  });
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 70000;

  /* Postgres is retried every 2 seconds; until it connects the API answers
     503 database_unavailable while health still answers ok. */
  await connectWithRetry();
  await applySchemaAndSeed();

  /* An unreachable provider at start never stops the app. */
  try {
    await ensureCatalog();
  } catch {
    process.stdout.write('Kill Bill is unreachable at start; the catalog is checked again later.\n');
  }

  startWorkers();
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
