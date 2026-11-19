// The HTTP server: one port for the interface, the API and the live channel.

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { Db, clock, connect } from './db.js';
import { runSeed } from './seed.js';
import { ApiError, writeError, rateLimited } from './errors.js';
import { StorageClient } from './storage.js';
import { readConnections, currentStorageEndpoint } from './connections.js';
import { SETTING_DEFAULTS, defaultFor, envSetting } from './settings.js';
import { schemaSql } from './schema.js';
import { loadSession, readSessionCookie } from './auth.js';
import { checkRate } from './ratelimit.js';
import { handleApi, RouteContext } from './api.js';
import { readBody } from './apibase.js';
import { LiveHub } from './live.js';

export interface Ctx {
  db: Db;
  storage: StorageClient;
  settings: Map<string, string | number>;
  live: LiveHubInterface;
}

export interface LiveHubInterface {
  publish(topic: string, event: string, data: unknown): void;
  publishMany(pairs: Array<{ topic: string; event: string; data: unknown }>): void;
  publishListNotice(table: string, data: unknown): void;
  presence(record: string, username: string): void;
  dropPresence(record: string, username: string): void;
}

const JSON_BODY_LIMIT = 1_000_000;

export async function startServer(): Promise<void> {
  const connections = readConnections();
  let db: Db;
  for (;;) {
    try {
      db = await connect(connections.databaseUrl);
      break;
    } catch {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // Apply the schema idempotently on every serve.
  await db.query(schemaSql());

  // Settings: environment values seed overrides; the table stores runtime ones.
  const settings = new Map<string, string | number>();
  for (const name of Object.keys(SETTING_DEFAULTS)) {
    const env = envSetting(name);
    if (env !== undefined) settings.set(name, env);
  }

  const storage = new StorageClient({
    ...connections.s3,
    endpoint: () => currentStorageEndpoint(connections.s3.endpoint),
  });

  const live = new LiveHub(db, () => Number(settings.get('LIVE_SETTLE_MS') ?? 200));
  const ctx: Ctx = { db, storage, settings, live };

  const server = createServer((req, res) => {
    void handle(req, res, ctx);
  });
  live.attach(server);
  server.listen(connections.publicPort, '0.0.0.0', () => {
    console.log(`Switchyard listening on port ${connections.publicPort}`);
  });

  // Seed only when the database is empty.
  await runSeed(db).catch(e => { console.error('Seed failed', e); });

  // Storage probe loop and SLA sweep run forever.
  startBackgroundJobs(ctx);

  process.on('SIGTERM', () => { server.close(); void db.end(); });
  process.on('SIGINT', () => { server.close(); void db.end(); });
}

async function handle(req: IncomingMessage, res: ServerResponse, ctx: Ctx): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;

    // Transport checks come first: cross-origin writes, then body size.
    if (isWriteMethod(req.method)) {
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) {
        const body = JSON.stringify({ error: { code: 'cross_origin', message: 'Requests must come from Switchyard itself.' } });
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(body);
        return;
      }
    }

    if (path === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ status: ctx.storage.isAvailable ? 'ok' : 'unavailable' }));
      return;
    }

    if (path.startsWith('/api/')) {
      const token = readSessionCookie(req);
      const session = token ? await loadSession(ctx.db, token) : null;
      let body: Record<string, unknown> = {};
      let rawBodyBuffer: Buffer | null = null;
      if (isWriteMethod(req.method)) {
        const contentType = String(req.headers['content-type'] ?? '');
        const isMultipart = contentType.startsWith('multipart/form-data');
        const limit = isMultipart
          ? Number(settingOf(ctx, 'ATTACHMENT_MAX_BYTES')) + 65_536
          : 1_000_000;
        const { buffer, tooLarge } = await readBody(req, limit);
        if (tooLarge) {
          const shown = limit.toLocaleString('en-US');
          const body2 = JSON.stringify({ error: { code: 'too_large', message: `Request bodies can be at most ${shown} bytes.` } });
          res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(body2);
          return;
        }
        if (!isMultipart && buffer && buffer.length) {
          try {
            body = JSON.parse(buffer.toString('utf8')) as Record<string, unknown>;
          } catch {
            body = {};
          }
        }
        // The raw body is kept for multipart uploads so the route can parse it.
        rawBodyBuffer = buffer;
        // Rate check for writes runs right after authentication.
        const writeLimit = Number(settingOf(ctx, 'WRITE_RATE_LIMIT_PER_MINUTE'));
        const identity = session?.impersonating?.username ?? session?.user.username ?? 'anonymous';
        const rate = await checkRate(ctx.db, 'write', identity, writeLimit);
        if (!rate.ok) {
          writeError(res, rateLimited(rate.retryAfter));
          return;
        }
      }
      const route: RouteContext = {
        req, res, ctx, url, method: req.method ?? 'GET', path, session, body,
        rawBody: rawBodyBuffer,
      };
      await handleApi(route);
      return;
    }

    serveStatic(path, res);
  } catch (e) {
    if (e instanceof ApiError) {
      writeError(res, e);
      return;
    }
    console.error('Unhandled error', e);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { code: 'internal', message: 'Something went wrong.' } }));
    }
  }
}

function isWriteMethod(method?: string): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** Known interface paths render the app shell; unknown paths answer 404. */
const KNOWN_SCREENS = [
  /^\/$/,
  /^\/login$/,
  /^\/desk(\/|$)/,
  /^\/approve$/,
  /^\/portal(\/|$)/,
  /^\/pages$/,
  /^\/dashboards(\/|$)/,
  /^\/inbox$/,
];

function serveStatic(path: string, res: ServerResponse): void {
  const clean = path === '/' ? '/index.html' : path;
  const file = join(process.cwd(), 'public', clean);
  if (!file.startsWith(join(process.cwd(), 'public')) || !existsSync(file)) {
    // Known screens render the app shell; unknown pages answer the not-found
    // state with HTTP 404.
    if (KNOWN_SCREENS.some(pattern => pattern.test(path))) {
      const shell = readFileSync(join(process.cwd(), 'public', 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(shell);
      return;
    }
    serveNotFound(res);
    return;
  }
  const ext = extname(file);
  const type = MIME[ext] ?? 'application/octet-stream';
  try {
    const body = readFileSync(file);
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    serveNotFound(res);
  }
}

function serveNotFound(res: ServerResponse): void {
  const file = join(process.cwd(), 'public', 'index.html');
  if (existsSync(file)) {
    const body = readFileSync(file);
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(body);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}


function startBackgroundJobs(ctx: Ctx): void {
  const probe = async (): Promise<void> => {
    await ctx.storage.probe();
  };
  void probe();
  const retrySeconds = () => Number(settingOf(ctx, 'STORAGE_RETRY_SECONDS'));
  let timer: NodeJS.Timeout;
  const schedule = (): void => {
    timer = setTimeout(async () => {
      await probe();
      schedule();
    }, retrySeconds() * 1000);
  };
  schedule();
}

export function settingOf(ctx: Ctx, name: string): string | number {
  const value = ctx.settings.get(name);
  return value !== undefined ? value : defaultFor(name);
}

void startServer().catch(e => {
  console.error('Fatal startup error', e);
  process.exit(1);
});
