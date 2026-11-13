import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { config } from './config';
import { applySchema, pool, waitForDatabase } from './db/pool';
import { applySeed } from './db/seed';
import { findCompanyBySlug, projectCompany } from './domain/projection';
import { ApiError } from './errors';
import { readJsonBody, readMultipartBody, readRawBody } from './http/body';
import { Context, loadSessionUser, readCookies, SESSION_COOKIE, type ReadBody } from './http/context';
import { sendApiError, sendJson } from './http/respond';
import { HANDLED, Router, type BodyKind } from './http/router';
import { registerApplicationRoutes } from './routes/applications';
import { registerAuthRoutes } from './routes/auth';
import { registerChannelRoutes } from './routes/channels';
import { registerCompanyRoutes } from './routes/companies';
import { registerEmployerRoutes } from './routes/employer';
import { registerFounderRoutes } from './routes/founder';
import { registerGradingRoutes } from './routes/grading';
import { registerJobRoutes } from './routes/jobs';
import { registerModerationRoutes } from './routes/moderation';
import { registerPostRoutes } from './routes/posts';
import { startDueJobLoop } from './services/due';
import { openStream, setPayloadRenderer, startListener } from './services/live';
import * as search from './services/search';
import * as storage from './services/storage';
import { reindexAll } from './services/sync';
import { pageStatus, serveAsset, serveDocument } from './static';

const router = new Router();
registerAuthRoutes(router);
registerCompanyRoutes(router);
registerPostRoutes(router);
registerModerationRoutes(router);
registerEmployerRoutes(router);
registerJobRoutes(router);
registerApplicationRoutes(router);
registerChannelRoutes(router);
registerFounderRoutes(router);
registerGradingRoutes(router);

router.get('/api/live', async (ctx: Context) => {
  await openStream(ctx.res, ctx.user, ctx.header('last-event-id') ?? ctx.url.searchParams.get('last_event_id'));
  return HANDLED;
});

/** The company payload depends on what that viewer may see. */
setPayloadRenderer(async (event, viewer) => {
  if (event.type !== 'company.changed') return event.payload;
  const slug = String(event.payload['slug'] ?? '');
  const company = await findCompanyBySlug(slug);
  if (!company) return null;
  return { slug, company: await projectCompany(company, viewer) };
});

let databaseReady = false;

async function healthBody(): Promise<{ status: string }> {
  const [searchUp, storageUp] = await Promise.all([search.isAvailable(), storage.isAvailable()]);
  return { status: searchUp && storageUp ? 'ok' : 'unavailable' };
}

async function readBody(req: IncomingMessage, kind: BodyKind): Promise<ReadBody> {
  switch (kind) {
    case 'none':
      return { kind: 'none' };
    case 'json':
      return { kind: 'json', fields: await readJsonBody(req) };
    case 'multipart':
      return { kind: 'multipart', form: await readMultipartBody(req, config.resumeMaxBytes + 1048576) };
    case 'raw':
      return { kind: 'raw', bytes: await readRawBody(req, config.markMaxBytes + 1048576) };
  }
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === (req.headers.host ?? '');
  } catch {
    return false;
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const ctx = new Context(req, res);
  const pathname = ctx.url.pathname;

  if (pathname === '/api/health' || pathname === '/health') {
    if (!databaseReady) {
      sendJson(res, 503, { status: 'starting' });
      return;
    }
    sendJson(res, 200, await healthBody());
    return;
  }

  if (!databaseReady) {
    sendJson(res, 503, { status: 'starting' });
    return;
  }

  const route = router.match(ctx.method, pathname);
  if (route) {
    ctx.params = route.params;
    ctx.body = await readBody(req, route.body);
    if (ctx.method !== 'GET' && ctx.method !== 'HEAD' && !sameOrigin(req)) {
      sendApiError(res, new ApiError('forbidden'));
      return;
    }
    ctx.user = await loadSessionUser(readCookies(req.headers.cookie)[SESSION_COOKIE], await ctx.now());
    const answer = await route.handler(ctx);
    if (answer !== HANDLED) sendJson(res, route.status, answer);
    return;
  }

  if (ctx.method !== 'GET' && ctx.method !== 'HEAD' && !sameOrigin(req)) {
    sendApiError(res, new ApiError('forbidden'));
    return;
  }
  ctx.user = await loadSessionUser(readCookies(req.headers.cookie)[SESSION_COOKIE], await ctx.now());

  if (pathname.startsWith('/api/')) {
    sendApiError(res, new ApiError('not_found'));
    return;
  }

  if (ctx.method === 'GET' && serveAsset(pathname, res)) return;
  if (ctx.method === 'GET' || ctx.method === 'HEAD') {
    serveDocument(res, pageStatus(pathname, ctx.user));
    return;
  }
  sendApiError(res, new ApiError('not_found'));
}

const server = createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof ApiError) {
      sendApiError(res, error);
      return;
    }
    sendJson(res, 500, { error: 'not_found', message: 'We could not find that.' });
  });
});

async function start(): Promise<void> {
  server.listen(config.port, '0.0.0.0');
  await waitForDatabase();
  await applySchema();
  await applySeed();
  databaseReady = true;
  await startListener();
  startDueJobLoop();

  /** The indexes and the bucket are brought up to date without blocking serving. */
  void (async () => {
    for (;;) {
      try {
        await search.ensureIndexes();
        await reindexAll();
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  })();
  void (async () => {
    for (;;) {
      try {
        await storage.ensureBucket();
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  })();
}

void start();

process.on('SIGTERM', () => {
  server.close();
  void pool.end();
});
