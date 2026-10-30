import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { config } from './config.js';
import { ensureSchema, Unavailable } from './db.js';
import { ApiError } from './errors.js';
import { readRequest, sendJson, type Reply, type RequestContext } from './http.js';
import { flushOutbox } from './domain/outbox.js';
import { runDueReminders } from './domain/reminders.js';
import { NOT_FOUND_PAGE, sendServed, serveStatic } from './static.js';
import { savePlan } from './routes/plans.js';
import {
  createMyShare,
  deleteMe,
  editMyPlan,
  readMyPlan,
  removeMyShare,
} from './routes/me.js';
import { requestSignInLink, signOut, verifySignInLink } from './routes/session.js';
import { deleteTestClock, health, putTestClock, readSharedPlan, tonight } from './routes/public.js';

type Handler = (ctx: RequestContext) => Reply | Promise<Reply>;

interface Route {
  path: string | RegExp;
  handlers: Partial<Record<string, Handler>>;
}

const routes: Route[] = [
  { path: '/api/health', handlers: { GET: health } },
  { path: '/api/tonight', handlers: { GET: tonight } },
  { path: '/api/plans', handlers: { POST: savePlan } },
  { path: '/api/session/request', handlers: { POST: requestSignInLink } },
  { path: '/api/session/verify', handlers: { POST: verifySignInLink } },
  { path: '/api/session/end', handlers: { POST: signOut } },
  { path: '/api/me/plan', handlers: { GET: readMyPlan, PATCH: editMyPlan } },
  { path: '/api/me/share', handlers: { POST: createMyShare, DELETE: removeMyShare } },
  { path: '/api/me', handlers: { DELETE: deleteMe } },
  { path: /^\/api\/share\/[^/]+$/, handlers: { GET: readSharedPlan } },
];

if (config.testClockEnabled) {
  routes.push({ path: '/api/test/clock', handlers: { PUT: putTestClock, DELETE: deleteTestClock } });
}

function findRoute(path: string): Route | undefined {
  return routes.find((route) =>
    typeof route.path === 'string' ? route.path === path : route.path.test(path),
  );
}

function replyForError(error: unknown): Reply {
  if (error instanceof ApiError) {
    return { status: error.status, body: error.body(), headers: error.headers };
  }
  if (error instanceof Unavailable) {
    const unavailable = new ApiError('unavailable');
    return { status: unavailable.status, body: unavailable.body() };
  }
  const internal = new ApiError('internal');
  process.stderr.write(`stillhour: ${error instanceof Error ? error.message : 'unknown failure'}\n`);
  return { status: internal.status, body: internal.body() };
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? 'GET';
  try {
    const route = findRoute(url.pathname);
    if (!route) throw new ApiError('not_found');
    const wanted = method === 'HEAD' && route.handlers['GET'] ? 'GET' : method;
    const handler = route.handlers[wanted];
    if (!handler) throw new ApiError('method_not_allowed');
    const ctx = await readRequest(req, url);
    const reply = await handler(ctx);
    sendJson(res, method === 'HEAD' ? { ...reply, body: undefined } : reply);
  } catch (error) {
    sendJson(res, replyForError(error));
  }
}

async function handlePage(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? 'GET';
  if (method === 'GET' || method === 'HEAD') {
    const served = await serveStatic(url.pathname, req.headers.range);
    if (served) {
      sendServed(res, served, method);
      return;
    }
  }
  const page = Buffer.from(NOT_FOUND_PAGE, 'utf8');
  res.writeHead(404, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': String(page.length),
    'cache-control': 'no-store',
  });
  res.end(method === 'HEAD' ? undefined : page);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const work = url.pathname.startsWith('/api') ? handleApi(req, res, url) : handlePage(req, res, url);
  void work.catch(() => {
    if (!res.headersSent) sendJson(res, replyForError(new Error('request failed')));
    else res.end();
  });
});

server.headersTimeout = 15_000;
server.requestTimeout = 20_000;

server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`stillhour listening on ${config.port}\n`);
});

const repeat = (work: () => Promise<void>, millis: number): void => {
  const tick = (): void => {
    work()
      .catch(() => undefined)
      .finally(() => setTimeout(tick, millis).unref());
  };
  setTimeout(tick, millis).unref();
};

// The database and the mail service may be absent at boot; both are picked up as they answer.
void ensureSchema().catch(() => undefined);
repeat(flushOutbox, 15_000);
repeat(runDueReminders, 30_000);

const shutDown = (): void => {
  server.close(() => process.exit(0));
};
process.on('SIGTERM', shutDown);
process.on('SIGINT', shutDown);
