import { createServer } from 'node:http';
import { config } from './config.js';
import { query } from './db/pool.js';
import { waitForDatabase } from './db/migrate.js';
import { pruneLinkRequests, sweepIssueAttempts } from './data/sheets.js';
import { reconcileHolds, sweepLapses } from './data/holds.js';
import { runMaskStep } from './data/maskjobs.js';
import { dispatchEvents } from './events/outbox.js';
import { ProblemError } from './http/problem.js';
import { handleApi, route } from './http/server.js';
import { serveStatic } from './http/staticfiles.js';
import { ensureBucket } from './services/store.js';

import './routes/sites.js';
import './routes/layouts.js';
import './routes/kit.js';
import './routes/hire.js';
import './routes/sheets.js';
import './routes/rig.js';

route('GET', '/api/health', async () => {
  await query('select 1');
  return { status: 200, body: { status: 'ok' } };
});

function repeat(work: () => Promise<unknown>, everyMilliseconds: number): void {
  const run = async (): Promise<void> => {
    try {
      await work();
    } catch (error) {
      if (!(error instanceof ProblemError)) {
        process.stderr.write(`background work failed: ${String((error as Error).message)}\n`);
      }
    }
    setTimeout(() => void run(), everyMilliseconds);
  };
  setTimeout(() => void run(), everyMilliseconds);
}

const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://app.invalid').pathname;
  if (path === '/api' || path.startsWith('/api/')) {
    void handleApi(request, response);
    return;
  }
  void serveStatic(request, response);
});

server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`gevelwerk listening on ${config.port}\n`);
});

void waitForDatabase().then(() => {
  repeat(dispatchEvents, 100);
  repeat(sweepLapses, 1_000);
  repeat(reconcileHolds, 1_000);
  repeat(runMaskStep, 500);
  repeat(sweepIssueAttempts, 5_000);
  repeat(pruneLinkRequests, 60_000);
});

void (async function prepareStore(): Promise<void> {
  for (;;) {
    try {
      await ensureBucket();
      return;
    } catch {
      // The wall store may arrive later; calls that need it answer their own code.
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
})();

process.on('SIGTERM', () => {
  server.close();
  process.exit(0);
});
