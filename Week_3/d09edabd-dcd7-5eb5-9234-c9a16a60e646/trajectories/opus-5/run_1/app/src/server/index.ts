import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, limits } from './config.js';
import { ApiError, errors } from './errors.js';
import {
  checkOrigin,
  matchPath,
  parseJsonBody,
  parseMultipart,
  readBody,
  readCookies,
  sendError,
  sendJson,
  Sent,
} from './http.js';
import type { Ctx, Route } from './http.js';
import { useSecret } from './domain/session.js';
import { endAllDue } from './domain/endings.js';
import { applySchema } from './services/schema.js';
import { applySeed, sessionSecret } from './services/seed.js';
import { pingPostgres, postgresUp } from './services/db.js';
import { ensureBucket, minioUp, pingStorage } from './services/storage.js';
import { liveUp } from './services/live.js';
import { drainQueue, mailUp, pingMail } from './services/mail.js';
import { authRoutes } from './routes/auth.js';
import { roomRoutes } from './routes/rooms.js';
import { placementRoutes } from './routes/placements.js';
import { nodeRoutes } from './routes/nodes.js';
import { lockRoutes } from './routes/locks.js';
import { eventRoutes } from './routes/events.js';
import { historyRoutes } from './routes/history.js';
import { propRoutes } from './routes/props.js';
import { versionRoutes } from './routes/versions.js';
import { packRoutes } from './routes/pack.js';
import { playtestRoutes } from './routes/playtests.js';
import { playRoutes } from './routes/play.js';
import { Reply } from './routes/support.js';
import type { HealthBody } from '../shared/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, 'public');

const routes: Route[] = [
  ...authRoutes,
  ...roomRoutes,
  ...placementRoutes,
  ...nodeRoutes,
  ...lockRoutes,
  ...eventRoutes,
  ...historyRoutes,
  ...propRoutes,
  ...versionRoutes,
  ...packRoutes,
  ...playtestRoutes,
  ...playRoutes,
];

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

const assets = new Map<string, Buffer>();

async function loadAssets(directory: string, prefix: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await loadAssets(path, `${prefix}${entry.name}/`);
    } else {
      assets.set(`${prefix}${entry.name}`, await readFile(path));
    }
  }
}

function healthBody(): HealthBody {
  return {
    status: 'ok',
    instance: config.instanceName,
    services: {
      postgres: postgresUp() ? 'up' : 'down',
      valkey: liveUp() ? 'up' : 'down',
      minio: minioUp() ? 'up' : 'down',
      mail: mailUp() ? 'up' : 'down',
    },
  };
}

function serveAsset(res: ServerResponse, name: string): boolean {
  const body = assets.get(name);
  if (!body) return false;
  const type = contentTypes[extname(name)] ?? 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': String(body.length),
    'Cache-Control': name === 'index.html' ? 'no-cache' : 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
  return true;
}

function limitFor(route: Route): number {
  if (route.bodyLimit !== undefined) return route.bodyLimit;
  return limits.json;
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  query: URLSearchParams,
): Promise<void> {
  const method = req.method ?? 'GET';
  if (path.startsWith('/api/pack/') && method !== 'GET') {
    sendError(res, errors.readOnly());
    return;
  }
  if (path === '/api/health' && method === 'GET') {
    sendJson(res, 200, healthBody());
    return;
  }
  let route: Route | undefined;
  let params: Record<string, string> = {};
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    const match = matchPath(candidate.pattern, path);
    if (match !== null) {
      route = candidate;
      params = match;
      break;
    }
  }
  if (!route) {
    sendError(res, errors.notFound());
    return;
  }
  const ctx: Ctx = {
    req,
    res,
    method,
    path,
    query,
    params,
    body: {},
    bytes: Buffer.alloc(0),
    multipart: { fields: {}, files: {} },
    header: (name: string) => {
      const value = req.headers[name.toLowerCase()];
      return Array.isArray(value) ? value[0] : value;
    },
    cookies: readCookies(req.headers.cookie),
  };
  try {
    if (route.body === 'json') {
      ctx.bytes = await readBody(req, limitFor(route));
      ctx.body = parseJsonBody(ctx.bytes);
    } else if (route.body === 'bytes') {
      ctx.bytes = await readBody(req, limitFor(route));
    } else if (route.body === 'multipart') {
      ctx.bytes = await readBody(req, limitFor(route));
      ctx.multipart = parseMultipart(ctx.bytes, ctx.header('content-type') ?? '');
      const file = ctx.multipart.files.file;
      if (file && file.bytes.length > limits.propFile) throw errors.tooLarge();
    }
    checkOrigin(ctx);
    const result = await route.handler(ctx);
    if (result instanceof Sent || result === null) return;
    if (result instanceof Reply) {
      sendJson(res, result.status, result.body);
      return;
    }
    if (result === undefined) {
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    sendJson(res, 200, result);
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof ApiError) {
      sendError(res, error);
      return;
    }
    sendJson(res, 500, { error: 'internal' });
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  if (path.startsWith('/api/')) {
    void handleApi(req, res, path, url.searchParams);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendError(res, errors.notFound());
    return;
  }
  const name = path.replace(/^\/+/, '');
  if (name !== '' && serveAsset(res, name)) return;
  const segment = name.slice(name.lastIndexOf('/') + 1);
  if (segment.includes('.')) {
    sendError(res, errors.notFound());
    return;
  }
  if (!serveAsset(res, 'index.html')) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
});

async function boot(): Promise<void> {
  await loadAssets(publicDir, '');
  server.listen(config.port, '0.0.0.0');

  let ready = false;
  const prepare = async (): Promise<void> => {
    await pingPostgres();
    if (!ready && postgresUp()) {
      try {
        await applySchema();
        await applySeed();
        useSecret(await sessionSecret());
        ready = true;
      } catch {
        ready = false;
      }
    }
  };
  void prepare().catch(() => undefined);
  void ensureBucket().catch(() => undefined);
  void pingMail().catch(() => undefined);

  setInterval(() => {
    void prepare().catch(() => undefined);
    void pingStorage().catch(() => undefined);
    void pingMail().catch(() => undefined);
  }, 5000);
  setInterval(() => {
    if (!postgresUp()) return;
    void drainQueue().catch(() => undefined);
  }, 10_000);
  setInterval(() => {
    if (!postgresUp()) return;
    void endAllDue().catch(() => undefined);
  }, 1000);
}

void boot();

process.on('SIGTERM', () => {
  server.close();
  process.exit(0);
});
