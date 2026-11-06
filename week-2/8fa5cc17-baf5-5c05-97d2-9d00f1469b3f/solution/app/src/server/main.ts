// Quire's server: starts at once, answers the health check with 503 until PostgreSQL is reachable
// and the schema and seed are applied, retrying every two seconds.
import { createServer } from 'node:http';
import { config } from './config.ts';
import { handle, markReady } from './app.ts';
import { initEvents, onEvent } from './events.ts';
import { sweepIdempotency } from './idempotency.ts';
import { applySchemaAndSeed } from './seed.ts';
import { startIdleSweep } from './sessions.ts';
import { dropObjectCache } from './share.ts';
import { storageAvailable } from './storage.ts';

const DB_RETRY_MS = 2000;

async function boot(): Promise<void> {
  for (;;) {
    try {
      await applySchemaAndSeed();
      await initEvents();
      break;
    } catch (error) {
      console.error('database not ready:', error instanceof Error ? error.message : 'unknown error');
      await new Promise((resolve) => setTimeout(resolve, DB_RETRY_MS));
    }
  }
  startIdleSweep();
  sweepIdempotency();
  // An object that leaves a link's scope loses its cached renderings (and those quoting it).
  onEvent((event, data) => {
    if ((event === 'object.saved' || event === 'object.removed') && data && typeof data === 'object' && !Array.isArray(data)) {
      void dropObjectCache(String(data.object_id)).catch(() => undefined);
    }
  });
  void storageAvailable().then((up) => {
    if (!up) console.error('object store unreachable at start; attachments wait for it');
  });
  markReady();
}

const server = createServer((req, res) => void handle(req, res));
server.requestTimeout = 0;
server.listen(config.port, '0.0.0.0', () => console.log(`Quire listening on port ${config.port}`));
void boot();
