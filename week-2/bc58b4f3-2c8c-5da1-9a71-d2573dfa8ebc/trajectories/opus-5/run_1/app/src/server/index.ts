import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { MAX_JSON_BODY_BYTES, MAX_UPLOAD_BODY_BYTES } from '../shared/contract.js';
import { assignmentRoutes } from './api/assignments.js';
import { billingRoutes } from './api/billing.js';
import { coverageRoutes } from './api/coverage.js';
import { fileRoutes } from './api/files.js';
import { healthRoutes } from './api/health.js';
import { orgRoutes } from './api/org.js';
import { seatRoutes } from './api/seats.js';
import { sessionRoutes } from './api/session.js';
import { loadSession, parseCookies, SESSION_COOKIE } from './auth/sessions.js';
import { config } from './config.js';
import { applySchemaAndSeed } from './db/seed.js';
import { ApiError } from './http/errors.js';
import { matchRoute, type AnyRoute, type AuthenticatedContext, type Reply, type RequestContext } from './http/router.js';
import { serveClient } from './http/static.js';
import { retryQueuedInvoices } from './services/billing.js';
import { flushOutbox } from './services/mail.js';

const ROUTES: readonly AnyRoute[] = [
  ...healthRoutes,
  ...sessionRoutes,
  ...assignmentRoutes,
  ...seatRoutes,
  ...coverageRoutes,
  ...billingRoutes,
  ...orgRoutes,
  ...fileRoutes,
];

const STATE_CHANGING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const OUTBOX_INTERVAL_MS = 5000;

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let overflowed = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > limit) {
        if (!overflowed) {
          overflowed = true;
          chunks.length = 0;
          reject(new ApiError('payload_too_large'));
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function assertSameOrigin(req: IncomingMessage): void {
  const origin = req.headers.origin;
  if (origin === undefined || origin === 'null') {
    return;
  }
  const host = req.headers.host ?? '';
  let originHost = '';
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ApiError('cross_origin');
  }
  if (originHost !== host) {
    throw new ApiError('cross_origin');
  }
}

function assertContentType(req: IncomingMessage, kind: 'json' | 'multipart', body: Buffer): void {
  const header = req.headers['content-type'];
  const value = (Array.isArray(header) ? header[0] : header) ?? '';
  const mime = value.split(';')[0]?.trim().toLowerCase() ?? '';
  if (kind === 'json') {
    if (mime === 'application/json') {
      return;
    }
    if (mime === '' && body.byteLength === 0) {
      return;
    }
    throw new ApiError('unsupported_media_type');
  }
  if (mime !== 'multipart/form-data') {
    throw new ApiError('unsupported_media_type');
  }
}

function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { ...reply.headers };
  let payload = Buffer.alloc(0);
  if (reply.raw !== undefined) {
    payload = reply.raw;
  } else if (reply.body !== undefined) {
    payload = Buffer.from(JSON.stringify(reply.body), 'utf8');
    headers['content-type'] = headers['content-type'] ?? 'application/json; charset=utf-8';
  }
  if (payload.byteLength > 0) {
    headers['content-length'] = String(payload.byteLength);
  }
  res.writeHead(reply.status, headers);
  res.end(reply.status === 204 ? undefined : payload);
}

function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof ApiError) {
    send(res, { status: error.status, body: error.toBody() });
    return;
  }
  process.stderr.write(`unhandled request failure: ${String(error)}\n`);
  send(res, {
    status: 500,
    body: { error: { code: 'internal', message: 'Something went wrong on our side.' } },
  });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (STATE_CHANGING_METHODS.has(method)) {
    assertSameOrigin(req);
  }

  const matched = matchRoute(ROUTES, method, url.pathname);
  if (matched === null) {
    if (method === 'GET' && !url.pathname.startsWith('/api/')) {
      const asset = await serveClient(url.pathname);
      if (asset !== null) {
        send(res, asset);
        return;
      }
    }
    throw new ApiError('not_found');
  }

  const { route, params } = matched;
  const limit = route.body === 'multipart' ? MAX_UPLOAD_BODY_BYTES : MAX_JSON_BODY_BYTES;
  const rawBody = route.body === 'none' ? Buffer.alloc(0) : await readBody(req, limit);
  if (route.body !== 'none') {
    assertContentType(req, route.body, rawBody);
  }

  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const session = token === undefined ? null : await loadSession(token);
  const context: RequestContext = {
    req,
    res,
    method,
    path: url.pathname,
    query: url.searchParams,
    params,
    rawBody,
    session,
    headers: req.headers,
  };

  if (!route.auth) {
    send(res, await route.handler(context));
    return;
  }
  if (session === null) {
    throw new ApiError('unauthenticated');
  }
  const authenticated: AuthenticatedContext = { ...context, session };
  send(res, await route.handler(authenticated));
}

function startBackgroundLoop(name: string, intervalMs: number, run: () => Promise<void>): void {
  const tick = async (): Promise<void> => {
    try {
      await run();
    } catch (error) {
      process.stderr.write(`${name} loop: ${String(error)}\n`);
    }
  };
  setInterval(() => void tick(), intervalMs).unref();
  void tick();
}

async function applySchemaWhenPostgresAnswers(): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await applySchemaAndSeed();
      return;
    } catch (error) {
      if (attempt >= 30) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function main(): Promise<void> {
  await applySchemaWhenPostgresAnswers();

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => sendError(res, error));
  });
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`Teamseat listening on port ${config.port}\n`);
  });

  startBackgroundLoop('outbox', OUTBOX_INTERVAL_MS, flushOutbox);
  startBackgroundLoop('billing', config.billingRetrySeconds * 1000, retryQueuedInvoices);
}

void main();
