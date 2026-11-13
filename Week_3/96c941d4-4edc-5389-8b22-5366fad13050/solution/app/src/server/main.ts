import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, initializeSearch, requireStore } from './app.js';
import { createHttpServer } from './http.js';
import { ROUTES } from './api/routes.js';
import { reconcileDiscovery, sweepStaleDocuments } from './api/discovery.js';

const RECONCILE_INTERVAL_MS = 1500;
const SWEEP_INTERVAL_MS = 4000;

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, '../public');

const context = createContext();

async function attemptInitialization(): Promise<void> {
  try {
    await requireStore(context);
  } catch (error) {
    process.stderr.write(`[startup] database initialization deferred: ${(error as Error).message}\n`);
  }
  try {
    await initializeSearch(context);
  } catch (error) {
    process.stderr.write(`[startup] search initialization deferred: ${(error as Error).message}\n`);
  }
}

const server = createHttpServer(context, ROUTES, publicDir);
server.listen(context.config.port, '0.0.0.0', () => {
  process.stdout.write(`squallglass listening on 0.0.0.0:${context.config.port}\n`);
});

void attemptInitialization();

setInterval(() => {
  void reconcileDiscovery(context).catch(() => undefined);
}, RECONCILE_INTERVAL_MS).unref();

setInterval(() => {
  void sweepStaleDocuments(context).catch(() => undefined);
}, SWEEP_INTERVAL_MS).unref();
