import { IncomingMessage, ServerResponse, createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BODY_LIMIT, SETUP_BODY_LIMIT, config } from './config';
import { applySchema, databaseReachable } from './db';
import { seed } from './bootstrap';
import { ApiError, notFound } from './errors';
import {
  Ctx,
  checkOrigin,
  parseBody,
  parseCookies,
  readBody,
  sendBytes,
  sendError,
  sendJson,
  setCookie,
} from './http';
import { userOfSession } from './auth';
import { StorageUnavailable, storageReachable } from './storage';
import { STORAGE_DOWNLOAD_MESSAGE, storageUnavailable } from './errors';
import { renderNotFound, renderPage } from './pages';
import { serveEventStream } from './events';
import * as auth from './routes/auth';
import * as parts from './routes/parts';
import * as evaluate from './routes/evaluate';
import * as rooms from './routes/rooms';
import * as grading from './routes/grading';

type Handler = (ctx: Ctx) => Promise<void> | void;
type Route = { method: string; segments: string[]; handler: Handler; limit: number };

function route(method: string, pattern: string, handler: Handler, limit = BODY_LIMIT): Route {
  return { method, segments: pattern.split('/').filter((part) => part.length > 0), handler, limit };
}

const ROUTES: Route[] = [
  route('GET', '/api/health', health),
  route('GET', '/api/config', serveConfig),
  route('POST', '/api/auth/signup', auth.signup),
  route('POST', '/api/auth/signin', auth.signin),
  route('POST', '/api/auth/signout', auth.signout),
  route('GET', '/api/me', auth.me),
  route('GET', '/api/parts', parts.listParts),
  route('POST', '/api/parts', parts.publishPart),
  route('GET', '/api/parts/:slug', parts.getPart),
  route('GET', '/api/parts/:slug/revisions', parts.getRevisions),
  route('POST', '/api/parts/:slug/revisions', parts.saveRevision),
  route('POST', '/api/parts/:slug/copies', parts.copyPart),
  route('POST', '/api/parts/:slug/revisions/:id/restore', parts.restoreRevision),
  route('POST', '/api/parts/:slug/rooms', rooms.createRoom),
  route('PUT', '/api/parts/:slug/like', parts.likePart),
  route('DELETE', '/api/parts/:slug/like', parts.unlikePart),
  route('POST', '/api/revisions/:id/fork', parts.forkRevision),
  route('GET', '/api/revisions/:id/tape', parts.getTape),
  route('GET', '/api/revisions/:id/archive.zip', withFormat(parts.getArchive, 'zip')),
  route('GET', '/api/revisions/:id/archive.tar', withFormat(parts.getArchive, 'tar')),
  route('GET', '/api/solids/:digest', parts.getSolid),
  route('GET', '/api/solids/:digest/thumbnail.svg', parts.getThumbnail),
  route('POST', '/api/evaluations', evaluate.postEvaluation),
  route('POST', '/api/evaluations/cancel', evaluate.cancelEvaluation),
  route('GET', '/api/evaluations/:id', evaluate.getEvaluation),
  route('POST', '/api/preflight', evaluate.postPreflight),
  route('GET', '/api/compare', evaluate.getCompare),
  route('GET', '/api/rooms/:id', rooms.getRoom),
  route('POST', '/api/rooms/:id/comments', rooms.postComment),
  route('POST', '/api/rooms/:id/approvals', rooms.postApproval),
  route('POST', '/api/rooms/:id/close', rooms.closeRoom),
  route('GET', '/api/dashboard', parts.dashboard),
  route('GET', '/api/events', serveEventStream),
  route('POST', '/api/grading/setup', grading.gradingSetup, SETUP_BODY_LIMIT),
  route('POST', '/api/grading/evaluator-delay', grading.gradingEvaluatorDelay),
  route('GET', '/api/grading/evaluations', grading.gradingEvaluations),
  route('POST', '/api/grading/drop-streams', grading.gradingDropStreams),
  route('GET', '/auth/verify', auth.verify),
];

function withFormat(handler: Handler, format: string): Handler {
  return (ctx) => {
    ctx.params.format = format;
    return handler(ctx);
  };
}

function match(method: string, path: string): { route: Route; params: Record<string, string> } | null {
  const parts2 = path.split('/').filter((part) => part.length > 0);
  for (const candidate of ROUTES) {
    if (candidate.method !== method) continue;
    if (candidate.segments.length !== parts2.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let index = 0; index < candidate.segments.length; index += 1) {
      const segment = candidate.segments[index];
      const value = parts2[index];
      if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(value);
      else if (segment !== value) {
        ok = false;
        break;
      }
    }
    if (ok) return { route: candidate, params };
  }
  return null;
}

let ready = false;

async function health(ctx: Ctx): Promise<void> {
  if (!ready || !(await databaseReachable())) {
    sendJson(ctx, 503, { status: 'unavailable', database: 'down' });
    return;
  }
  if (!(await storageReachable())) {
    sendJson(ctx, 200, { status: 'unavailable', storage: 'down' });
    return;
  }
  sendJson(ctx, 200, { status: 'ok' });
}

function serveConfig(ctx: Ctx): void {
  sendJson(ctx, 200, {
    evalDebounceMs: config.evalDebounceMs,
    slowEvalNoticeMs: config.slowEvalNoticeMs,
    commentMaxChars: config.commentMaxChars,
    requiredApprovals: config.requiredApprovals,
    preflightSignedOutLimit: config.preflightSignedOutLimit,
  });
}

const STATIC_TYPES: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

const PUBLIC_DIR = join(__dirname, '..', '..', 'public');

async function serveStatic(ctx: Ctx): Promise<boolean> {
  const path = ctx.url.pathname;
  const allowed =
    path === '/app.js' || path === '/app.css' || /^\/fonts\/[a-z0-9-]+\.woff2$/.test(path);
  if (!allowed) return false;
  const extension = path.slice(path.lastIndexOf('.'));
  try {
    const bytes = await readFile(join(PUBLIC_DIR, path));
    sendBytes(ctx, 200, bytes, STATIC_TYPES[extension] ?? 'application/octet-stream', {
      'cache-control': 'public, max-age=3600',
    });
    return true;
  } catch {
    return false;
  }
}

const server = createServer((req, res) => {
  void handle(req, res);
});

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const cookies = parseCookies(req.headers.cookie);
  const controller = new AbortController();
  req.on('close', () => controller.abort());

  const ctx: Ctx = {
    req,
    res,
    method,
    url,
    params: {},
    cookies,
    bodyText: '',
    raw: null,
    body: {},
    user: null,
    visitorId: cookies.tw_visitor ?? randomUUID(),
    aborted: () => controller.signal.aborted,
    signal: controller.signal,
  };

  if (!cookies.tw_visitor) setCookie(res, 'tw_visitor', ctx.visitorId, 60 * 60 * 24 * 365);

  try {
    checkOrigin(req, method);

    const found = match(method, url.pathname);
    if (found) {
      ctx.params = found.params;
      if (method !== 'GET' && method !== 'HEAD') {
        ctx.bodyText = await readBody(req, found.route.limit);
        const parsed = parseBody(ctx.bodyText);
        ctx.raw = parsed.raw;
        ctx.body = parsed.body;
      }
      if (url.pathname !== '/api/health') {
        ctx.user = await userOfSession(cookies.tw_session);
      }
      await found.route.handler(ctx);
      return;
    }

    if (url.pathname.startsWith('/api/')) throw notFound();

    if (method === 'GET' && (await serveStatic(ctx))) return;

    if (method === 'GET') {
      ctx.user = await userOfSession(cookies.tw_session);
      await renderPage(ctx);
      return;
    }
    throw notFound();
  } catch (error) {
    if (error instanceof ApiError) {
      sendError(ctx, error);
      return;
    }
    if (error instanceof StorageUnavailable) {
      sendError(ctx, storageUnavailable(STORAGE_DOWNLOAD_MESSAGE));
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      sendJson(ctx, 500, { error: 'server_error', message: 'Something went wrong.' });
      return;
    }
    renderNotFound(ctx);
  }
}

async function boot(): Promise<void> {
  server.listen(config.port, '0.0.0.0');
  for (;;) {
    if (await databaseReachable()) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  await applySchema();
  try {
    await seed();
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
  }
  ready = true;
}

void boot();
