import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { handleApi } from './api/router.js';
import { applySchema } from './db/pool.js';
import { sweepExpiredKeys } from './db/idempotency.js';
import { seedIfEmpty } from './db/seed.js';
import { ApiError } from './domain/errors.js';
import { assertSameOrigin } from './http/request.js';
import { sendError } from './http/respond.js';
import { serveStatic } from './http/static.js';
import { checkServices, startStatusChecks } from './services/status.js';
import { startSheetWorker } from './workers/sheets.js';
import { sweepPurges } from './workers/purge.js';

const port = Number(process.env.APP_PUBLIC_PORT ?? 4173);

const server = createServer((request, response) => {
  void handle(request, response);
});

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  try {
    assertSameOrigin(request);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url);
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      throw new ApiError('not_found');
    }
    if (await serveStatic(url.pathname, response)) return;
    throw new ApiError('not_found');
  } catch (error) {
    if (response.headersSent) {
      response.end();
      return;
    }
    sendError(response, error);
  }
}

/** Purge sweeps, key sweeps and the seed run on real elapsed time. */
function startBackgroundWork(): void {
  startStatusChecks();
  startSheetWorker();
  setInterval(() => {
    void sweepPurges().catch(() => undefined);
  }, 3_000).unref();
  setInterval(() => {
    void sweepExpiredKeys().catch(() => undefined);
  }, 60_000).unref();
}

async function seedUntilItTakes(): Promise<void> {
  for (;;) {
    const done = await seedIfEmpty().catch((error: unknown) => {
      process.stderr.write(`seed deferred: ${String(error)}
`);
      return false;
    });
    if (done) return;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

async function start(): Promise<void> {
  await applySchema();
  await checkServices().catch(() => undefined);
  server.listen(port, '0.0.0.0');
  startBackgroundWork();
  void seedUntilItTakes();
}

void start();
