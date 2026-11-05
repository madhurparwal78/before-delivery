import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { config } from './config.js';
import { Router, type RequestContext, type RouteDef } from './http/types.js';
import { parseCookies } from './http/cookies.js';
import { ApiError } from './errors.js';
import { readRawBody, parseJsonBody, readMultipart, JSON_BODY_LIMIT } from './http/body.js';
import { ensureSchema } from './db/schema.js';
import { initSecrets } from './db/session-store.js';
import { setSessionSecret, sessionSecret } from './server-context.js';
import { registerSessionRoutes } from './api/session.js';
import { registerPublicRoutes } from './api/public.js';
import { registerCheckoutRoutes } from './api/checkout.js';
import { registerStudioRoutes } from './api/studio.js';
import { registerContribRoutes } from './api/contrib.js';
import { registerStaffRoutes } from './api/staff.js';
import { registerReadApiRoutes } from './api/readapi.js';
import { registerPageRoutes } from './pages/routes.js';
import { tickQueue, queueCounts } from './queue/runner.js';
import { reconcileAllIndexes } from './domain/models.js';
import { refreshPlanFromBilling, applyDueDowngrades } from './domain/plan-service.js';
import { flushEmails } from './providers/email.js';
import { checkOnce, serviceSnapshot } from './providers/availability.js';
import { pingStorage } from './providers/storage.js';
import { pingSearch } from './providers/search.js';
import { pingBilling } from './providers/billing.js';
import { pingMail } from './providers/mail.js';
import { query } from './db/db.js';

let pageRenderer: { renderErrorPage: (err: ApiError) => string } | null = null;

export function registerPageRenderer(renderer: { renderErrorPage: (err: ApiError) => string }): void {
  pageRenderer = renderer;
}

const router = new Router();

registerSessionRoutes(router);
registerPublicRoutes(router);
registerCheckoutRoutes(router);
registerStudioRoutes(router);
registerContribRoutes(router);
registerStaffRoutes(router);
registerReadApiRoutes(router);
registerPageRoutes(router);

router.add({
  method: 'GET',
  pattern: '/api/health',
  allowedParams: [],
  handler: ctx => {
    ctx.res.statusCode = 200;
    ctx.res.setHeader('Content-Type', 'application/json');
    ctx.res.end('{"status":"ok"}');
  },
});

function isOwnOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  const host = new URL(origin).host;
  const publicHost = new URL(config.publicUrl).host;
  return host === `${new URL(config.publicUrl).hostname}:${config.port}` || host === publicHost || origin.startsWith(config.publicUrl);
}

const stateChanging = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname.replace(/\/{2,}/g, '/');
  const method = req.method ?? 'GET';
  const cookies = parseCookies(req.headers['cookie']);

  const ctx: RequestContext = {
    req,
    res,
    method,
    path,
    query: url.searchParams,
    params: {},
    cookies,
    idempotencyKey: req.headers['idempotency-key'] as string | undefined,
  };

  try {
    if (!path.startsWith('/api/health')) {
      await sessionSecret();
    }
    if (path.startsWith('/api/') && !path.startsWith('/api/health')) {
      if (!routeKnown(method, path)) {
        throw new ApiError(404, 'not_found');
      }
    }
    const match = router.match(method, path);
    if (match === null) {
      // Unknown page routes render the 404 page; API 404s were thrown above.
      throw new ApiError(404, 'not_found');
    }
    if ('allowedMethods' in match) {
      res.setHeader('Allow', match.allowedMethods.join(', '));
      throw new ApiError(405, 'method_not_allowed');
    }
    const route = match.def as RouteDef;
    ctx.params = match.params;

    if (route.allowedParams !== null) {
      for (const name of url.searchParams.keys()) {
        if (!route.allowedParams.includes(name)) {
          throw new ApiError(400, 'unknown_parameter', { name });
        }
      }
    }
    if (stateChanging.has(method) && !isOwnOrigin(req.headers['origin'] as string | undefined)) {
      throw new ApiError(403, 'cross_origin');
    }
    if (route.json) {
      const contentType = req.headers['content-type'] ?? '';
      if (!contentType.includes('application/json')) {
        throw new ApiError(415, 'unsupported_media_type');
      }
      const raw = await readRawBody(req, JSON_BODY_LIMIT);
      ctx.body = { json: parseJsonBody(raw), fields: new Map() };
    } else if (route.multipart) {
      const contentType = req.headers['content-type'] ?? '';
      if (!contentType.includes('multipart/form-data')) {
        throw new ApiError(415, 'unsupported_media_type');
      }
    } else if (path.startsWith('/api/') && method === 'GET') {
      if ((req.headers['content-type'] ?? '') !== '' || (req.headers['content-length'] ?? '0') !== '0') {
        // Read API GETs with a body or content type answer 415.
        if (path.startsWith('/api/v1/')) {
          throw new ApiError(415, 'unsupported_media_type');
        }
      }
    }
    await route.handler(ctx);
    if (!res.writableEnded) {
      throw new ApiError(404, 'not_found');
    }
  } catch (err) {
    handleError(res, path, err);
  }
}

function routeKnown(method: string, path: string): boolean {
  const match = router.match(method, path);
  if (match === null) {
    const anyMethod = router.match(method === 'GET' ? 'POST' : 'GET', path);
    return anyMethod !== null;
  }
  return true;
}

export function handleError(res: ServerResponse, path: string, err: unknown): void {
  if (res.writableEnded) return;
  const apiStyle = path.startsWith('/api/') || path.startsWith('/media/');
  if (err instanceof ApiError) {
    const body: Record<string, unknown> = { error: err.code, message: err.message };
    if (err.fields !== undefined) body['fields'] = err.fields;
    res.statusCode = err.status;
    if (err.code === 'method_not_allowed') {
      const allow = res.getHeader('Allow');
      if (allow === undefined) res.setHeader('Allow', 'GET, HEAD');
    }
    for (const [name, value] of Object.entries(err.extraHeaders ?? {})) {
      res.setHeader(name, value);
    }
    if (apiStyle) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    } else if (pageRenderer !== null) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(pageRenderer.renderErrorPage(err));
    } else {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<!doctype html><html><body><h1>Not found.</h1></body></html>');
    }
    return;
  }
  console.error('unhandled error', err);
  res.statusCode = 500;
  if (apiStyle) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'not_found', message: 'Not found.' }));
  } else {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><html><body><h1>Server error</h1></body></html>');
  }
}

export async function start(): Promise<void> {
  const secret = await initSecrets();
  setSessionSecret(secret);
  await ensureSchema();
  void (async () => {
    for (;;) {
      try {
        const { runSeed } = await import('./seed/seed.js');
        await runSeed();
        break;
      } catch (err) {
        console.error('seed retry', err instanceof Error ? err.message : err);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  })();

  const server = createServer((req, res) => {
    void handleRequest(req, res);
  });

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`turnstone studio listening on port ${config.port}`);
  });

  setInterval(() => {
    void tickQueue().catch(() => undefined);
  }, 1000);
  setInterval(() => {
    void reconcileAllIndexes().catch(() => undefined);
  }, 1000);
  setInterval(() => {
    void flushEmails(config.queueRetrySeconds).catch(() => undefined);
  }, 2000);
  setInterval(() => {
    void (async () => {
      await checkOnce('storage', pingStorage);
      await checkOnce('search', pingSearch);
      await checkOnce('billing', pingBilling);
      await checkOnce('mail', pingMail);
      try {
        await query('SELECT 1');
        (await import('./providers/availability.js')).markService('database', true);
      } catch {
        (await import('./providers/availability.js')).markService('database', false);
      }
    })();
  }, 2000);
  setInterval(() => {
    void (async () => {
      await refreshPlanFromBilling().catch(() => undefined);
      await applyDueDowngrades().catch(() => undefined);
    })();
  }, 10_000);
  void serviceSnapshot();
  void queueCounts();
}

void start().catch(err => {
  console.error("startup failed", err);
  process.exit(1);
});
