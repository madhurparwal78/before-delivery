import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { ensureSchema } from './db/schema.js';
import { findSessionUser } from './db/users.js';
import { readCookie, SESSION_COOKIE, type RequestContext } from './http/context.js';
import { ApiError, notFound, ValidationError } from './http/errors.js';
import { sendNotFoundPage } from './http/pages.js';
import { sendApiFailure, sendRedirect } from './http/respond.js';
import { matchRoute } from './http/router.js';
import { serveStatic } from './http/static.js';
import { markDatabaseReached } from './http/api/system.js';
import { serverToday } from './services/clock.js';
import { DEMO_KEY_PREFIX, DEMO_SET } from './seed/demo.js';
import { databaseInitialised, loadSeed, markDemoLoaded } from './seed/engine.js';
import { ensureBucket, StorageUnavailableError } from './storage/s3.js';

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const method = req.method ?? 'GET';

  if (method === 'GET' && (await serveStatic(url.pathname, res))) return;

  const match = matchRoute(method, url.pathname);
  const sessionId = readCookie(req, SESSION_COOKIE);
  const isApi = url.pathname.startsWith('/api/');
  const ctx: RequestContext = {
    req,
    res,
    url,
    params: match?.params ?? {},
    user: null,
    sessionId,
    today: config.appToday,
  };

  try {
    ctx.today = await serverToday();
    if (sessionId) ctx.user = await findSessionUser(pool, sessionId);
    if (!match) throw notFound();
    await match.route.handler(ctx);
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    const kind = match?.route.kind ?? (isApi ? 'api' : 'page');
    if (kind === 'api') {
      sendApiFailure(res, error);
      return;
    }
    if (error instanceof ApiError && error.status === 401) {
      sendRedirect(res, '/sign-in');
      return;
    }
    if (error instanceof ApiError || error instanceof ValidationError) {
      sendNotFoundPage(ctx);
      return;
    }
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Something went wrong.');
  }
}

async function connectDatabase(): Promise<void> {
  for (;;) {
    try {
      await ensureSchema();
      markDatabaseReached();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function prepareStorage(): Promise<void> {
  try {
    await ensureBucket();
  } catch (error) {
    if (!(error instanceof StorageUnavailableError)) throw error;
  }
}

async function main(): Promise<void> {
  const server = createServer((req, res) => {
    void handle(req, res);
  });
  server.listen(config.publicPort, '0.0.0.0');

  await connectDatabase();
  await prepareStorage();
  if (!(await databaseInitialised())) {
    await loadSeed(DEMO_SET, DEMO_KEY_PREFIX);
    await markDemoLoaded();
  }
}

void main();
