import http from 'node:http';
import { config, LIMITS } from './config';
import { nowDate } from './clock';
import { ApiError } from './errors';
import { applySchema } from './schema';
import { applySeed } from './seed';
import { resolveSession } from './domain/sessions';
import { eventHub, pruneEventLog } from './domain/events';
import { flushRemovalQueue } from './domain/removalQueue';
import { startHealthChecks } from './services/health';
import { ensureBucket } from './services/storage';
import { flushOutbox } from './services/outbox';
import { fireDueScheduledPosts } from './jobs/scheduler';
import { runDigests } from './jobs/digest';
import { matchRoute, type Route } from './http/router';
import { assetPath, sendAsset, sendShell } from './http/assets';
import { sendJson, type RequestContext } from './http/context';
import { sessionRoutes } from './routes/session';
import { workspaceRoutes } from './routes/workspace';
import { channelRoutes } from './routes/channels';
import { messageRoutes } from './routes/messages';
import { photoRoutes } from './routes/photos';
import { searchRoutes } from './routes/search';
import { scheduledRoutes } from './routes/scheduled';
import { eventRoutes } from './routes/events';

const routes: Route[] = [
  ...sessionRoutes,
  ...workspaceRoutes,
  ...channelRoutes,
  ...messageRoutes,
  ...photoRoutes,
  ...searchRoutes,
  ...scheduledRoutes,
  ...eventRoutes,
];

const SHELL_PREFIXES = ['/c/', '/join/'];

function isShellAddress(pathname: string): boolean {
  if (pathname === '/') return true;
  return SHELL_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function sendApiError(ctx: RequestContext, error: ApiError): void {
  if (ctx.res.headersSent) {
    ctx.res.end();
    return;
  }
  sendJson(ctx, error.status, error.body(), error.headers);
}

function crossOrigin(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined || origin === 'null') return false;
  const host = req.headers.host;
  if (host === undefined) return false;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const method = req.method ?? 'GET';
  const contentType = req.headers['content-type'] ?? '';
  const isMultipart = contentType.toLowerCase().startsWith('multipart/form-data');

  const ctx: RequestContext = {
    req,
    res,
    method,
    path: url.pathname,
    url,
    params: {},
    isMultipart,
    user: null,
  };

  if (!url.pathname.startsWith('/api/')) {
    if (method !== 'GET' && method !== 'HEAD') {
      sendApiError(ctx, new ApiError('not_found'));
      return;
    }
    const file = url.pathname === '/' ? null : assetPath(url.pathname);
    if (file !== null) {
      sendAsset(res, file);
      return;
    }
    if (isShellAddress(url.pathname)) {
      sendShell(res);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', date: nowDate().toUTCString() });
    res.end('Not found');
    return;
  }

  try {
    const hasBody = method === 'POST' || method === 'PATCH';
    if (hasBody) {
      const limit = isMultipart ? LIMITS.multipartBodyBytes : LIMITS.jsonBodyBytes;
      const declared = Number(req.headers['content-length'] ?? '0');
      if (Number.isFinite(declared) && declared > limit) throw new ApiError('payload_too_large');
    }

    const match = matchRoute(routes, method, url.pathname);

    if (hasBody) {
      const acceptsMultipart = match?.route.acceptsMultipart === true;
      const isJson = contentType.toLowerCase().startsWith('application/json');
      if (!(isMultipart && acceptsMultipart) && !isJson) throw new ApiError('unsupported_media_type');
    }

    if (method === 'POST' || method === 'PATCH' || method === 'DELETE') {
      if (crossOrigin(req)) throw new ApiError('cross_origin');
    }

    ctx.user = await resolveSession(req);
    if (match === null) {
      if (ctx.user === null) throw new ApiError('unauthenticated');
      throw new ApiError('not_found');
    }
    if (!match.route.anonymous && ctx.user === null) throw new ApiError('unauthenticated');

    ctx.params = match.params;
    await match.route.handler(ctx);
  } catch (error) {
    if (error instanceof ApiError) {
      sendApiError(ctx, error);
      return;
    }
    sendApiError(ctx, new ApiError('internal_error'));
  }
}

function startBackgroundJobs(): void {
  eventHub.start();
  const every = (ms: number, task: () => Promise<void>): void => {
    const timer = setInterval(() => {
      void task().catch(() => undefined);
    }, ms);
    timer.unref();
  };
  every(2_000, fireDueScheduledPosts);
  every(2_000, runDigests);
  every(30_000, flushOutbox);
  every(30_000, flushRemovalQueue);
  every(60_000, pruneEventLog);
}

/** Applies the schema and seed, retrying until PostgreSQL answers. */
async function prepareDatabase(): Promise<void> {
  for (;;) {
    try {
      await applySchema();
      await applySeed();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}

async function main(): Promise<void> {
  const prepared = prepareDatabase();
  await Promise.race([prepared, new Promise((resolve) => setTimeout(resolve, 15_000))]);
  await ensureBucket().catch(() => undefined);
  startHealthChecks();
  startBackgroundJobs();

  const server = http.createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'internal_error', message: 'Something went wrong on our side. Try again.' }));
    });
  });
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  server.listen(config.port, '0.0.0.0');
}

void main();
