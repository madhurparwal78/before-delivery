import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readAsset } from './assets.js';
import { config } from './config.js';
import { applySchema, databaseReady, query } from './db.js';
import { removeExpiredSessions } from './auth.js';
import { ApiError } from './errors.js';
import {
  bodyLimitFor,
  checkContentType,
  checkOrigin,
  emptyReply,
  jsonReply,
  parseCookies,
  parseJsonBody,
  readBody,
  writeReply,
  type Reply,
} from './http.js';
import { SESSION_COOKIE } from './auth.js';
import { apiRoute, type RouteRequest } from './routes.js';
import { sweepStalledRenders } from './packets.js';
import { seedDatabase } from './seed.js';
import { deletePrefix, ensureBucket, putObject, strokesKey, StorageDown } from './storage.js';
import { shellHtml } from './shell.js';

const SPA_ROUTES: RegExp[] = [
  /^\/$/,
  /^\/signup$/,
  /^\/signin$/,
  /^\/tonight$/,
  /^\/kit$/,
  /^\/programs$/,
  /^\/programs\/[^/]+$/,
  /^\/sessions\/[^/]+$/,
  /^\/objects\/[^/]+$/,
  /^\/packets\/[^/]+$/,
];

function errorReply(error: unknown): Reply {
  if (error instanceof ApiError) {
    const body = error.body();
    const retryAfter = body.__retryAfter;
    delete body.__retryAfter;
    const headers: Record<string, string> = {};
    if (typeof retryAfter === 'number') headers['retry-after'] = String(retryAfter);
    return jsonReply(error.status, body, headers);
  }
  return jsonReply(500, { error: 'internal' });
}

async function handleApi(
  request: IncomingMessage,
  url: URL,
): Promise<Reply> {
  const method = (request.method ?? 'GET').toUpperCase();
  const bytes = await readBody(request, bodyLimitFor(url.pathname));
  checkContentType(request, bytes.byteLength);
  checkOrigin(request);
  const routeRequest: RouteRequest = {
    method,
    segments: url.pathname.replace(/^\/api\/?/, '').split('/').filter((part) => part !== ''),
    url,
    body: method === 'GET' ? {} : parseJsonBody(bytes),
    raw: request,
    sessionId: parseCookies(request.headers.cookie).get(SESSION_COOKIE),
  };
  return apiRoute(routeRequest);
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const method = (request.method ?? 'GET').toUpperCase();

  if (url.pathname === '/api/health') {
    writeReply(
      response,
      databaseReady()
        ? jsonReply(200, { status: 'ok' })
        : jsonReply(503, { status: 'starting' }),
    );
    return;
  }

  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    try {
      writeReply(response, await handleApi(request, url));
    } catch (error) {
      writeReply(response, errorReply(error));
    }
    return;
  }

  if (method !== 'GET' && method !== 'HEAD') {
    writeReply(response, emptyReply(405));
    return;
  }

  const asset = await readAsset(url.pathname).catch(() => null);
  if (asset) {
    writeReply(response, {
      status: 200,
      body: asset.bytes,
      headers: {
        'content-type': asset.contentType,
        'cache-control': url.pathname.startsWith('/fonts/')
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      },
    });
    return;
  }

  const known = SPA_ROUTES.some((pattern) => pattern.test(url.pathname));
  writeReply(response, {
    status: known ? 200 : 404,
    body: new Uint8Array(Buffer.from(shellHtml(), 'utf8')),
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' },
  });
}

/** Seeded stroke files that are missing at start are written once storage answers. */
async function writeSeededStrokes(): Promise<void> {
  const pending = await query<{
    observation_id: string;
    account_id: string;
    sha256: string;
    body: string;
  }>('SELECT observation_id, account_id, sha256, body FROM seeded_strokes WHERE written = false');
  for (const row of pending.rows) {
    try {
      await putObject(
        strokesKey(row.account_id, row.observation_id, row.sha256),
        Buffer.from(row.body, 'utf8'),
        'application/json',
      );
      await query('UPDATE seeded_strokes SET written = true WHERE observation_id = $1', [
        row.observation_id,
      ]);
    } catch (error) {
      if (error instanceof StorageDown) return;
      throw error;
    }
  }
}

/** A removal storage refused after a tombstone is retried until storage confirms it. */
async function retryStorageRemovals(): Promise<void> {
  const pending = await query<{ id: number; prefix: string }>(
    "SELECT id, prefix FROM storage_removals WHERE next_attempt_at <= now() ORDER BY id LIMIT 50",
  );
  for (const row of pending.rows) {
    try {
      await deletePrefix(row.prefix);
      await query('DELETE FROM storage_removals WHERE id = $1', [row.id]);
    } catch (error) {
      if (!(error instanceof StorageDown)) throw error;
      await query(
        "UPDATE storage_removals SET next_attempt_at = now() + interval '60 seconds' WHERE id = $1",
        [row.id],
      );
      return;
    }
  }
}

function every(seconds: number, task: () => Promise<void>): void {
  const timer = setInterval(() => {
    if (!databaseReady()) return;
    void task().catch(() => undefined);
  }, seconds * 1000);
  timer.unref();
}

async function startDatabase(): Promise<void> {
  for (;;) {
    try {
      await applySchema(seedDatabase);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

const server = createServer((request, response) => {
  void handle(request, response).catch(() => {
    if (!response.headersSent) writeReply(response, jsonReply(500, { error: 'internal' }));
    else response.end();
  });
});

server.listen(config.port, '0.0.0.0');

void startDatabase().then(() => {
  void ensureBucket().catch(() => undefined);
  void writeSeededStrokes().catch(() => undefined);
  every(10, writeSeededStrokes);
  every(10, sweepStalledRenders);
  every(30, retryStorageRemovals);
  every(3600, removeExpiredSessions);
});
