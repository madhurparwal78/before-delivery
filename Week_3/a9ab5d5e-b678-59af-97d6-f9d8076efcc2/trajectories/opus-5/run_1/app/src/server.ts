import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { config } from './config';
import { applySchema, startLogListener } from './db';
import { applySeed } from './db/seed';
import { ApiError } from './errors';
import { handleApi, sendProblem } from './http/router';
import { pageShell } from './web/shell';
import { ensureBucket } from './services/storage';
import { runRelayOnce } from './workers/relay';
import { runSweepOnce } from './workers/sweep';
import { cleanCancelledRecords, runRecordWorkerOnce } from './workers/records';

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
  } catch {
    return null;
  }
}

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? '/', config.publicUrl);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url);
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const shell = pageShell();
      response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : shell);
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
    const shell = pageShell();
    response.writeHead(isPagePath(url.pathname) ? 200 : 404, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': shell.length,
    });
    response.end(request.method === 'HEAD' ? undefined : shell);
  })().catch((error: unknown) => {
    process.stderr.write(`page failed: ${String(error)}\n`);
    if (!response.headersSent) sendProblem(response, new ApiError('internal_error'));
    else response.end();
  });
});

function everyTwoSeconds(work: () => Promise<void>): void {
  const tick = (): void => {
    work()
      .catch(() => undefined)
      .finally(() => setTimeout(tick, 2000));
  };
  tick();
}

async function start(): Promise<void> {
  await applySchema();
  await applySeed();
  startLogListener();
  await ensureBucket().catch(() => undefined);
  everyTwoSeconds(runRelayOnce);
  everyTwoSeconds(runSweepOnce);
  everyTwoSeconds(async () => {
    await runRecordWorkerOnce();
    await cleanCancelledRecords();
  });
  server.listen(config.port, '0.0.0.0');
}

void start();
