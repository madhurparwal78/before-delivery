import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { applySchema, pool } from './db/pool.js';
import { seedDatabase } from './db/seed.js';
import { env } from './env.js';
import { Ctx, type Reply } from './http/context.js';
import {
  ApiError,
  bodyTooLarge,
  crossOrigin,
  notFound,
  readOnly,
  unsupportedMediaType,
} from './http/errors.js';
import { matchRoute, type Route } from './http/router.js';
import { actorFromRequest, loadSessionSecret } from './http/session.js';
import { CLIENT_ROUTES, serveAsset, serveClientPage } from './http/static.js';
import { startWorker } from './jobs/worker.js';
import { binderRoutes } from './routes/binder.js';
import { bookingRoutes } from './routes/bookings.js';
import { documentRoutes } from './routes/documents.js';
import { holdRoutes } from './routes/holds.js';
import { packRoutes } from './routes/packs.js';
import { policyRoutes } from './routes/policies.js';
import { renterRoutes } from './routes/renters.js';
import { reportRoutes } from './routes/reports.js';
import { sessionRoutes } from './routes/session.js';
import { siteRoutes } from './routes/sites.js';
import { ensureTenant } from './services/killbill.js';
import { ensureBucket } from './services/storage.js';

const JSON_BODY_LIMIT = 64_000;
const MULTIPART_BODY_LIMIT = 5_100_000;
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const routes: Route[] = [
  ...sessionRoutes,
  ...siteRoutes,
  ...holdRoutes,
  ...bookingRoutes,
  ...packRoutes,
  ...documentRoutes,
  ...renterRoutes,
  ...reportRoutes,
  ...policyRoutes,
  ...binderRoutes,
];

interface BodyRead {
  bytes: Buffer;
  tooLarge: boolean;
}

async function readBody(req: IncomingMessage, limit: number): Promise<BodyRead> {
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) {
      tooLarge = true;
      continue;
    }
    chunks.push(buffer);
  }
  return { bytes: tooLarge ? Buffer.alloc(0) : Buffer.concat(chunks), tooLarge };
}

function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = {
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
    ...(reply.headers ?? {}),
  };
  if (reply.setCookie !== undefined) headers['set-cookie'] = reply.setCookie;
  if (reply.bytes !== undefined) {
    headers['content-type'] = reply.contentType ?? 'application/octet-stream';
    headers['content-length'] = String(reply.bytes.length);
    res.writeHead(reply.status, headers);
    res.end(reply.bytes);
    return;
  }
  if (reply.body === undefined) {
    res.writeHead(reply.status, headers);
    res.end();
    return;
  }
  const payload = Buffer.from(JSON.stringify(reply.body), 'utf8');
  headers['content-type'] = 'application/json; charset=utf-8';
  headers['content-length'] = String(payload.length);
  res.writeHead(reply.status, headers);
  res.end(payload);
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function isBinderPath(pathname: string): boolean {
  return pathname === '/binder' || pathname.startsWith('/binder/') || pathname.startsWith('/api/binder');
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const contentType = req.headers['content-type'] ?? '';
  const multipart = contentType.startsWith('multipart/form-data');
  const body = await readBody(req, multipart ? MULTIPART_BODY_LIMIT : JSON_BODY_LIMIT);

  try {
    if (WRITE_METHODS.has(method) && !sameOrigin(req)) throw crossOrigin();
    if (body.tooLarge) throw bodyTooLarge();
    const match = matchRoute(routes, method, url.pathname);
    if (match === null) {
      if (isBinderPath(url.pathname) && method !== 'GET') throw readOnly();
      if (method === 'GET') {
        const asset = await serveAsset(url.pathname);
        if (asset !== null) {
          send(res, asset);
          return;
        }
        if (CLIENT_ROUTES.includes(url.pathname)) {
          send(res, await serveClientPage());
          return;
        }
      }
      throw notFound();
    }
    if (WRITE_METHODS.has(method) && method !== 'DELETE') {
      const expectsMultipart = match.route.multipart === true;
      const ok = expectsMultipart
        ? multipart
        : contentType.startsWith('application/json') ||
          (contentType === '' && body.bytes.length === 0);
      if (!ok) throw unsupportedMediaType();
    }
    const actor = await actorFromRequest(req);
    const ctx = new Ctx(method, url, match.params, req.headers, body.bytes, actor);
    send(res, await match.route.handle(ctx));
  } catch (error) {
    if (error instanceof ApiError) {
      send(res, { status: error.status, body: error.body() });
      return;
    }
    process.stderr.write(`request failed: ${String(error)}\n`);
    send(res, {
      status: 500,
      body: { error: 'internal', message: 'Something went wrong on the server.' },
    });
  }
}

async function prepareStores(): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await applySchema();
      await loadSessionSecret();
      await ensureBucket();
      await seedDatabase();
      return;
    } catch (error) {
      process.stderr.write(`startup preparation attempt ${attempt} failed: ${String(error)}\n`);
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }
}

const server = createServer((req, res) => {
  void handle(req, res);
});

server.listen(env.port, '0.0.0.0', () => {
  process.stdout.write(`hearthshift listening on ${env.port}\n`);
  void prepareStores().then(() => {
    startWorker();
  });
  void ensureTenant().catch(() => undefined);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  });
}
