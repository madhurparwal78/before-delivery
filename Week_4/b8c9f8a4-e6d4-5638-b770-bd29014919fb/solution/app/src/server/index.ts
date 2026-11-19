// The server: the API, the page shell and the built client, on one origin.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { applySchema } from './db/schema.js';
import { seedIfNeeded } from './db/seed.js';
import { ApiError } from './http/errors.js';
import { guardOrigin, limitFor, readBody, type Context } from './http/request.js';
import { redirect, sendJson } from './http/respond.js';
import { Router } from './http/router.js';
import { isAsset, sendAsset, sendShell } from './http/static.js';
import { startBackgroundPass } from './jobs/background.js';
import { registerOwnerCars } from './routes/owner-cars.js';
import { registerUploads } from './routes/owner-uploads.js';
import { registerRecord } from './routes/owner-record.js';
import { registerPublish } from './routes/owner-publish.js';
import { registerPeople } from './routes/owner-people.js';
import { registerLink } from './routes/link.js';
import { storeReachable } from './services/store.js';

const router = new Router();
registerOwnerCars(router);
registerUploads(router);
registerRecord(router);
registerPublish(router);
registerPeople(router);
registerLink(router);

let ready = false;

const PAGES = [
  /^\/owner$/,
  /^\/owner\/cars$/,
  /^\/owner\/cars\/[^/]+$/,
  /^\/l\/[^/]+$/,
];

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = (request.method ?? 'GET').toUpperCase();

  if (path === '/api/health') {
    sendJson(response, ready ? 200 : 503, ready ? { status: 'ok' } : { status: 'starting' });
    return;
  }

  const match = router.match(method, path);
  if (match) {
    // The published order: an oversized body is refused before anything else is looked at.
    const hasBody = method === 'POST' || method === 'PUT' || method === 'PATCH';
    const { limit, refuse } = limitFor(path);
    const body = hasBody ? await readBody(request, limit, refuse) : Buffer.alloc(0);
    guardOrigin(request);
    const context: Context = { request, response, method, path, url, params: match.params, body };
    await match.handler(context);
    return;
  }

  guardOrigin(request);

  if (method === 'GET' || method === 'HEAD') {
    if (isAsset(path) && (await sendAsset(response, path))) return;
    if (path === '/') {
      redirect(response, '/owner');
      return;
    }
    if (PAGES.some((pattern) => pattern.test(path))) {
      sendShell(response);
      return;
    }
  }

  if (path.startsWith('/api/')) {
    sendJson(response, 404, { error: 'not_found', message: 'That is not one of our routes.' });
    return;
  }
  sendShell(response, 404);
}

const server = createServer((request, response) => {
  handle(request, response).catch((error: unknown) => {
    if (response.headersSent) {
      response.end();
      return;
    }
    if (error instanceof ApiError) {
      sendJson(response, error.status, error.body);
      return;
    }
    process.stderr.write(`request failed: ${String((error as Error)?.stack ?? error)}\n`);
    sendJson(response, 500, { error: 'server_error', message: 'Something went wrong here.' });
  });
});

async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch {
      await new Promise((wake) => setTimeout(wake, 2000));
    }
  }
}

async function boot(): Promise<void> {
  await waitForDatabase();
  await applySchema();
  await storeReachable();
  await seedIfNeeded();
  ready = true;
  startBackgroundPass();
}

server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`open bonnet listening on ${config.port}\n`);
});

boot().catch((error: unknown) => {
  process.stderr.write(`could not start: ${String((error as Error)?.stack ?? error)}\n`);
  process.exitCode = 1;
  server.close();
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
  });
}
