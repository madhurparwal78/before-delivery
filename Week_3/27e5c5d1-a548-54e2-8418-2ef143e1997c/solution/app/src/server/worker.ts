import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.ts';
import { connectDatabase } from './db.ts';
import { createApp } from './http.ts';
import { startHub } from './hub.ts';
import { startStorage } from './storage.ts';

const SETTLE_MS = 1500;

/** One web worker: wait for PostgreSQL, start the service seams, then listen on the shared port. */
export async function runWorker(): Promise<void> {
  const config = loadConfig();
  await connectDatabase(config.databaseUrl);
  startStorage(config.s3);
  await Promise.race([startHub(config.valkeyUrl), new Promise((resolve) => setTimeout(resolve, SETTLE_MS))]);
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'client');
  const server = await createApp(root);
  server.listen(config.port, '0.0.0.0');
}
