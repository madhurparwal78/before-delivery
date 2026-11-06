import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { applySchema } from './db/schema.js';
import { applySeed } from './db/seed.js';
import { db, transact, waitForDatabase } from './db/pool.js';
import { AppError, errors } from './http/errors.js';
import { dispatch } from './http/router.js';
import { write, type Result } from './http/respond.js';
import { applyDueLapse } from './api/bookingView.js';
import { sendDueExpiryNotices } from './api/notices.js';
import { bookingsNeedingLapse } from './store/bookings.js';
import { allKitchens } from './store/kitchens.js';
import { closedMonths } from './store/months.js';
import { startWorker } from './services/outbox.js';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), 'public');

const screenPaths = new Set([
  '/',
  '/board',
  '/bookings',
  '/documents',
  '/invoices',
  '/reports',
  '/sanitation',
  '/settings',
]);

const assets: Record<string, string> = {
  '/app.js': 'application/javascript; charset=utf-8',
  '/app.css': 'text/css; charset=utf-8',
};

async function serveAsset(path: string): Promise<Result | null> {
  const contentType = assets[path];
  if (contentType) {
    const body = await readFile(join(publicDir, path.slice(1))).catch(() => null);
    return body === null
      ? null
      : {
          kind: 'binary',
          status: 200,
          body,
          contentType,
          headers: { 'cache-control': 'public, max-age=3600' },
        };
  }
  if (/^\/fonts\/[A-Za-z0-9._-]+\.woff2$/.test(path)) {
    const body = await readFile(join(publicDir, path.slice(1))).catch(() => null);
    return body === null
      ? null
      : {
          kind: 'binary',
          status: 200,
          body,
          contentType: 'font/woff2',
          headers: { 'cache-control': 'public, max-age=3600' },
        };
  }
  return null;
}

async function serveScreen(): Promise<Result> {
  const body = await readFile(join(publicDir, 'index.html'));
  return { kind: 'binary', status: 200, body, contentType: 'text/html; charset=utf-8' };
}

function isInspectorPath(path: string): boolean {
  return path === '/inspect' || path.startsWith('/inspect/') || path.startsWith('/api/inspect');
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const path = url.pathname;
  const extra: Record<string, string> = isInspectorPath(path)
    ? { 'referrer-policy': 'no-referrer' }
    : {};

  try {
    if (path.startsWith('/api/')) {
      const result = await dispatch(request, path, url.searchParams);
      write(response, { ...result, headers: { ...(result.headers ?? {}), ...extra } });
      return;
    }
    if (request.method === 'GET' || request.method === 'HEAD') {
      const asset = await serveAsset(path);
      if (asset) {
        write(response, asset);
        return;
      }
      if (screenPaths.has(path) || /^\/inspect\/[^/]+$/.test(path)) {
        const screen = await serveScreen();
        write(response, { ...screen, headers: { ...(screen.headers ?? {}), ...extra } });
        return;
      }
    }
    throw errors.notFound();
  } catch (error) {
    const failure = error instanceof AppError ? error : errors.internal();
    write(response, {
      kind: 'json',
      status: failure.status,
      body: failure.body(),
      headers: { ...failure.headers, ...extra },
    });
  }
}

/** The background sweep: lapses that no request has touched, and due notices. */
function startSweep(): void {
  const sweep = async (): Promise<void> => {
    try {
      const kitchens = await allKitchens();
      for (const kitchen of kitchens) {
        const closed = new Set(await closedMonths(db(), kitchen.id));
        const due = await bookingsNeedingLapse(db(), Date.now());
        await transact(async (client) => {
          for (const booking of due.filter((row) => row.kitchenId === kitchen.id)) {
            await applyDueLapse(client, booking, Date.now(), closed.has(booking.month));
          }
        });
      }
      await sendDueExpiryNotices();
    } catch {
      // Retried on the next sweep.
    }
  };
  setInterval(() => void sweep(), config.sweepSeconds * 1000);
}

async function seedWithRetry(): Promise<void> {
  for (;;) {
    try {
      await applySeed();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function main(): Promise<void> {
  await waitForDatabase();
  await applySchema();

  const server = createServer((request, response) => {
    void handle(request, response);
  });
  server.listen(config.port, '0.0.0.0');

  void seedWithRetry();
  startWorker();
  startSweep();
}

void main();
