import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { accessRoutes } from './api/access.js';
import { costRoutes } from './api/costsapi.js';
import { itemRoutes } from './api/items.js';
import { jobRoutes } from './api/jobs.js';
import { noteRoutes } from './api/notes.js';
import { peopleRoutes } from './api/people.js';
import { photoRoutes } from './api/photos.js';
import { planRoutes } from './api/plan.js';
import { sessionRoutes } from './api/session.js';
import { syncRoutes } from './api/sync.js';
import { visitRoutes } from './api/visitsapi.js';
import { db, startNoticeListener, waitForDatabase } from './db.js';
import { config } from './env.js';
import { ApiError } from './errors.js';
import { startEventStream } from './events.js';
import {
  checkOrigin,
  matchRoute,
  readBody,
  requireAccount,
  resolveAccount,
  route,
  sendJson,
  type Ctx,
  type Route,
} from './http.js';
import { requireJob } from './jobctx.js';
import { startOutboxSender } from './mail.js';
import { applySchema } from './schema.js';
import { applySeed } from './seed.js';
import { serveStatic } from './static.js';
import { startSummaryScheduler } from './summary.js';
import { ensureBucket, StorageUnavailable } from './services/objectstore.js';

const eventRoute: Route = route('GET', '/api/jobs/:jobId/events', async (ctx: Ctx) => {
  const account = requireAccount(ctx);
  const jobCtx = await requireJob(db, account, ctx.params.jobId);
  const header = ctx.req.headers['last-event-id'];
  const afterQuery = ctx.query.get('after');
  const raw = typeof header === 'string' && header !== '' ? header : afterQuery;
  const resumeFrom = raw === null || raw === '' || !/^\d+$/.test(raw) ? null : Number(raw);
  await startEventStream(
    ctx.res,
    jobCtx.job.id,
    account.person.id,
    account.session,
    resumeFrom,
  );
});

const ROUTES: Route[] = [
  ...sessionRoutes,
  ...jobRoutes,
  ...planRoutes,
  ...peopleRoutes,
  ...visitRoutes,
  ...accessRoutes,
  ...itemRoutes,
  ...noteRoutes,
  ...photoRoutes,
  ...costRoutes,
  ...syncRoutes,
  eventRoute,
];

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? 'GET';
  const segments = url.pathname.split('/').filter((part) => part !== '');
  let rawBody: Buffer | null = null;
  if (BODY_METHODS.has(method)) rawBody = await readBody(req);
  checkOrigin(req);
  const matched = matchRoute(ROUTES, method, segments);
  const account = await resolveAccount(req, matched !== null && !matched.route.anonymous);
  if (matched === null) {
    if (account === null && !url.pathname.startsWith('/api/health')) {
      throw new ApiError('unauthenticated');
    }
    throw new ApiError('not_found');
  }
  const ctx: Ctx = {
    req,
    res,
    method,
    path: url.pathname,
    query: url.searchParams,
    params: matched.params,
    account,
    rawBody,
  };
  await matched.route.handler(ctx);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (!url.pathname.startsWith('/api/')) {
    void serveStatic(res, url.pathname).catch(() => {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Server error');
    });
    return;
  }
  void handleApi(req, res, url).catch((error: unknown) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof ApiError) {
      sendJson(res, error.status, error.body);
      return;
    }
    if (error instanceof StorageUnavailable) {
      sendJson(res, 503, new ApiError('storage_unavailable').body);
      return;
    }
    process.stderr.write(`${String(error)}\n`);
    sendJson(res, 500, { error: 'not_found', message: 'Not found.' });
  });
});

server.keepAliveTimeout = 76_000;
server.headersTimeout = 80_000;
server.requestTimeout = 0;

async function start(): Promise<void> {
  await waitForDatabase();
  await applySchema();
  await applySeed();
  try {
    await ensureBucket();
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
  }
  startNoticeListener();
  startOutboxSender();
  startSummaryScheduler();
  server.listen(config.port, '0.0.0.0');
}

void start().catch((error: unknown) => {
  process.stderr.write(`Snaglight failed to start: ${String(error)}\n`);
  process.exit(1);
});
