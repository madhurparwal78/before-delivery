import { readFile } from 'node:fs/promises';
import { ServerResponse, createServer } from 'node:http';
import { join } from 'node:path';
import { config } from './config';
import { logFault } from './log';
import { applySchema, startLogListener } from './db';
import { applySeed } from './db/seed';
import { ApiError } from './errors';
import { handleApi, sendProblem } from './http/router';
import { pageShell } from './web/shell';
import { ensureBucket } from './services/storage';
import { runRelayOnce } from './workers/relay';
import { runSweepOnce } from './workers/sweep';
import { cleanCancelledRecords, runRecordWorkerOnce } from './workers/records';
import { WORKER_INTERVAL_MS } from './workers/schedule';

const publicDir = join(__dirname, 'public');

const pagePaths = new Set(['/', '/start', '/calendar', '/plan', '/requests', '/costs', '/records']);

const assetTypes: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
};

function isPagePath(pathname: string): boolean {
  if (pagePaths.has(pathname)) return true;
  return /^\/(join|share)\/[^/]+$/.test(pathname);
}

async function serveAsset(pathname: string): Promise<{ body: Buffer; type: string } | null> {
  const match = /^\/assets\/([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)?)$/.exec(pathname);
  if (!match) return null;
  const relative = match[1] as string;
  if (relative.includes('..')) return null;
  const extension = relative.slice(relative.lastIndexOf('.'));
  const type = assetTypes[extension];
  if (!type) return null;
  try {
    const body = await readFile(join(publicDir, relative));
    return { body, type };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Every page route answers the one shell; the browser draws the not-found screen itself. */
function sendPage(response: ServerResponse, status: number, headOnly: boolean): void {
  const shell = pageShell();
  response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': shell.length });
  response.end(headOnly ? undefined : shell);
}

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? '/', config.publicUrl);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url);
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendPage(response, new ApiError('not_found').status, request.method === 'HEAD');
      return;
    }
    const asset = await serveAsset(url.pathname);
    if (asset) {
      response.writeHead(200, {
        'Content-Type': asset.type,
        'Content-Length': asset.body.length,
        'Cache-Control': 'no-cache',
      });
      response.end(request.method === 'HEAD' ? undefined : asset.body);
      return;
    }
    sendPage(response, isPagePath(url.pathname) ? 200 : new ApiError('not_found').status, request.method === 'HEAD');
  })().catch((error: unknown) => {
    logFault('page', error);
    if (!response.headersSent) sendProblem(response, new ApiError('internal_error'));
    else response.end();
  });
});

function everyWorkerInterval(work: () => Promise<void>): void {
  const tick = (): void => {
    work()
      .catch((error: unknown) => logFault('worker', error))
      .finally(() => setTimeout(tick, WORKER_INTERVAL_MS));
  };
  tick();
}

async function start(): Promise<void> {
  await applySchema();
  await applySeed();
  startLogListener();
  // Storage may be out at start; the bucket is made again on the first write, so this is not a fault.
  await ensureBucket().catch(() => process.stderr.write('storage not reachable at start; the bucket is made on first write\n'));
  everyWorkerInterval(runRelayOnce);
  everyWorkerInterval(runSweepOnce);
  everyWorkerInterval(async () => {
    await runRecordWorkerOnce();
    await cleanCancelledRecords();
  });
  server.listen(config.port, '0.0.0.0');
}

void start();
