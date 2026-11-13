import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { fieldCopy } from '../shared/copy.js';
import { config } from './config.js';
import { applySchema } from './db.js';
import { Fault, faults } from './errors.js';
import {
  Ctx,
  bodyLimitFor,
  compile,
  declaredLength,
  isJsonContentType,
  matchRoute,
  readBody,
  type Reply,
  type Route,
} from './http.js';
import { startOutboxWorker } from './mailer.js';
import { authRoutes } from './routes/auth.js';
import { assetRoutes } from './routes/assets.js';
import { checkpointRoutes } from './routes/checkpoints.js';
import { inviteRoutes } from './routes/invites.js';
import { labRoutes } from './routes/labs.js';
import { liveRoutes } from './routes/live.js';
import { projectRoutes } from './routes/projects.js';
import { sceneRoutes } from './routes/scenes.js';
import { shareRoutes } from './routes/share.js';
import { workspaceRoutes } from './routes/workspaces.js';
import { ensureBucket } from './s3.js';
import { seed } from './seed.js';
import { appShell, isClientRoute, staticFile } from './static.js';
import { serviceStatus, startStatusWatch } from './status.js';

const statusRoutes: readonly Route[] = [
  {
    method: 'GET',
    pattern: '/api/health',
    open: true,
    handler: async () => ({ status: 200, body: { status: 'ok' } }),
  },
  {
    method: 'GET',
    pattern: '/api/status',
    open: true,
    handler: async () => ({ status: 200, body: await serviceStatus() }),
  },
];

const routes = compile([
  ...statusRoutes,
  ...authRoutes,
  ...workspaceRoutes,
  ...inviteRoutes,
  ...projectRoutes,
  ...sceneRoutes,
  ...liveRoutes,
  ...assetRoutes,
  ...checkpointRoutes,
  ...labRoutes,
  ...shareRoutes,
]);

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return true;
  const host = req.headers.host;
  try {
    const url = new URL(origin);
    if (host !== undefined && url.host === host) return true;
    return url.origin === new URL(config.publicUrl).origin;
  } catch {
    return false;
  }
}

/** Any method other than GET, HEAD or the verify POST on a read-only link path. */
function readOnlyViolation(method: string, path: string): boolean {
  if (!path.startsWith('/api/view/')) return false;
  if (method === 'GET' || method === 'HEAD') return false;
  return !(method === 'POST' && /^\/api\/view\/[^/]+\/scenes\/[^/]+\/verify$/.test(path));
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    ...headers,
  });
  res.end(text);
}

function sendReply(req: IncomingMessage, res: ServerResponse, reply: Reply): void {
  if (reply.handled) return;
  const headers: Record<string, string> = { ...(reply.headers ?? {}) };
  if (reply.bytes) {
    headers['content-type'] = reply.contentType ?? 'application/octet-stream';
    headers['content-length'] = String(reply.bytes.length);
    res.writeHead(reply.status, headers);
    res.end(req.method === 'HEAD' ? undefined : Buffer.from(reply.bytes));
    return;
  }
  if (reply.body === undefined) {
    res.writeHead(reply.status, headers);
    res.end();
    return;
  }
  const text = JSON.stringify(reply.body);
  headers['content-type'] = 'application/json; charset=utf-8';
  headers['content-length'] = String(Buffer.byteLength(text));
  res.writeHead(reply.status, headers);
  res.end(req.method === 'HEAD' ? undefined : text);
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? 'GET';
  if (readOnlyViolation(method, url.pathname)) {
    const fault = faults.readOnly();
    sendJson(res, fault.status, fault.body(), { allow: 'GET, HEAD' });
    return;
  }

  const matched = matchRoute(routes, method, url.pathname);
  const isUpload = matched?.route.raw === true;
  const limit = bodyLimitFor(isUpload);
  const declared = declaredLength(req);
  if (declared !== null && declared > limit) {
    const fault = new Fault(
      413,
      'payload_too_large',
      isUpload ? fieldCopy.uploadTooLarge : 'This request body is too large.',
    );
    sendJson(res, fault.status, fault.body());
    req.destroy();
    return;
  }
  if (
    matched &&
    !isUpload &&
    WRITE_METHODS.has(method) &&
    typeof req.headers['content-type'] === 'string' &&
    req.headers['content-type'] !== '' &&
    !isJsonContentType(req)
  ) {
    const fault = faults.unsupportedMediaType();
    sendJson(res, fault.status, fault.body());
    return;
  }
  if (WRITE_METHODS.has(method) && !sameOrigin(req)) {
    const fault = faults.crossOrigin();
    sendJson(res, fault.status, fault.body());
    return;
  }
  if (!matched) {
    const fault = faults.notFound();
    sendJson(res, fault.status, fault.body());
    return;
  }

  const body = WRITE_METHODS.has(method) ? await readBody(req, limit) : new Uint8Array(0);
  const ctx = new Ctx(req, res, url, body);
  Object.assign(ctx.params, matched.params);
  if (!matched.route.open) await ctx.requireAccount();
  const reply = await matched.route.handler(ctx);
  sendReply(req, res, reply);
}

async function handlePage(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const file = await staticFile(url.pathname);
  if (file) {
    res.writeHead(200, {
      'content-type': file.contentType,
      'content-length': String(file.bytes.length),
      'cache-control': file.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : Buffer.from(file.bytes));
    return;
  }
  const shell = await appShell();
  const status = isClientRoute(url.pathname) ? 200 : 404;
  res.writeHead(status, {
    'content-type': shell.contentType,
    'content-length': String(shell.bytes.length),
    'cache-control': 'no-cache',
  });
  res.end(req.method === 'HEAD' ? undefined : Buffer.from(shell.bytes));
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  const work = url.pathname.startsWith('/api/')
    ? handleApi(req, res, url)
    : handlePage(req, res, url);
  void work.catch((error: unknown) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof Fault) {
      if (error.status === 499) {
        res.destroy();
        return;
      }
      sendJson(res, error.status, error.body());
      return;
    }
    const fault = new Fault(500, 'server_error', 'Something went wrong on the bench.');
    sendJson(res, fault.status, fault.body());
  });
});

server.on('clientError', (_error, socket) => {
  socket.destroy();
});

server.listen(config.port, '0.0.0.0', () => {
  startStatusWatch();
  startOutboxWorker();
  void (async () => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        await applySchema();
        await seed();
        break;
      } catch {
        await new Promise((done) => setTimeout(done, 2_000));
      }
    }
  })();
  void ensureBucket().catch(() => undefined);
});
