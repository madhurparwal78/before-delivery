import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { config } from './config';
import { migrateAndSeed } from './db/seed';
import {
  DEFAULT_BODY_LIMIT,
  parseCookies,
  readBody,
  sendJson,
  type RequestContext,
} from './http/context';
import { ApiError, crossOrigin, notFound, ValidationError } from './http/errors';
import { isCrossSiteStateChange } from './http/origin';
import { Router } from './http/router';
import { serveWeb } from './http/static';
import { accessRoutes } from './routes/access';
import { figureRoutes } from './routes/figures';
import { linkRoutes } from './routes/links';
import { projectRoutes } from './routes/projects';
import { readingRoutes } from './routes/readings';
import { sessionRoutes } from './routes/session';
import { flushAlerts, startAlertLoop } from './services/alerts';
import { ensureBucket } from './services/storage';

const router = new Router();
router.add(sessionRoutes);
router.add(projectRoutes);
router.add(figureRoutes);
router.add(linkRoutes);
router.add(readingRoutes);
router.add(accessRoutes);

function sendError(context: RequestContext, error: unknown): void {
  if (error instanceof ApiError) {
    sendJson(context, error.status, error.body(), error.headers);
    return;
  }
  if (error instanceof ValidationError) {
    sendJson(context, 422, error.body());
    return;
  }
  process.stderr.write(`unhandled request failure: ${String(error)}\n`);
  sendJson(context, 500, { error: 'internal_error' });
}

async function handleApi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  const method = request.method ?? 'GET';
  const context: RequestContext = {
    request,
    response,
    method,
    path: url.pathname,
    query: url.searchParams,
    params: {},
    body: {},
    cookies: parseCookies(request.headers.cookie),
  };
  try {
    const limit = router.limitFor(method, url.pathname, DEFAULT_BODY_LIMIT);
    const body = await readBody(request, limit);
    if (isCrossSiteStateChange(request)) throw crossOrigin();
    const matched = router.match(method, url.pathname);
    if (matched === null) throw notFound();
    await matched.route.handler({ ...context, body, params: matched.params });
  } catch (error) {
    sendError(context, error);
  }
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    void handleApi(request, response, url);
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Method not allowed\n');
    return;
  }
  void serveWeb(url.pathname, response);
});

async function start(): Promise<void> {
  await migrateAndSeed();
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`Fluxseal listening on port ${config.port}\n`);
  });
  startAlertLoop();
  void flushAlerts();
  try {
    await ensureBucket();
  } catch {
    // The object store may be unreachable at boot; seals then answer with their 503.
  }
}

void start().catch((error: unknown) => {
  process.stderr.write(`Fluxseal could not start: ${String(error)}\n`);
  process.exit(1);
});
