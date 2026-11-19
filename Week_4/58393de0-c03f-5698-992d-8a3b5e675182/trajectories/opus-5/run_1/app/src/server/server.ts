import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { ApiError, notFound } from './errors.js';
import {
  EXPORT_LIMIT,
  JSON_LIMIT,
  PROJECT_LIMIT,
  checkOrigin,
  makeContext,
  parseJsonBody,
  readBody,
  sendError,
  sendJson,
  type RequestContext,
} from './http.js';
import { databaseAnswers, databaseReady, startDatabase, query } from './db.js';
import { storageAnswers, ensureBucket } from './storage.js';
import { loadCaller, signedOutError, type Caller } from './sessions.js';
import { openStream, startStreamClock } from './stream.js';
import { sweepOrphanObjects } from './cleanup.js';
import * as auth from './routes/auth.js';
import * as joinRoutes from './routes/join.js';
import * as classroomRoutes from './routes/classrooms.js';
import * as projectRoutes from './routes/projects.js';
import * as exportRoutes from './routes/exports.js';
import * as grading from './routes/grading.js';

type Params = Record<string, string>;

interface Route {
  method: string;
  segments: string[];
  limit?: number;
  run: (ctx: RequestContext, caller: Caller, params: Params, body: Buffer) => Promise<void> | void;
}

const publicDir = join(fileURLToPath(new URL('.', import.meta.url)), 'public');

const routes: Route[] = [
  { method: 'POST', segments: ['api', 'auth', 'signup'], limit: JSON_LIMIT, run: (ctx, caller, _p, body) => auth.signup(ctx, caller, parseJsonBody(ctx, body)) },
  { method: 'POST', segments: ['api', 'auth', 'signin'], limit: JSON_LIMIT, run: (ctx, caller, _p, body) => auth.signin(ctx, caller, parseJsonBody(ctx, body)) },
  { method: 'POST', segments: ['api', 'auth', 'signout'], limit: JSON_LIMIT, run: (ctx, caller) => auth.signout(ctx, caller) },
  { method: 'GET', segments: ['api', 'session'], run: (ctx, caller) => auth.session(ctx, caller) },
  { method: 'POST', segments: ['api', 'auth', 'verify'], limit: JSON_LIMIT, run: (ctx, caller, _p, body) => auth.verify(ctx, caller, parseJsonBody(ctx, body)) },
  { method: 'POST', segments: ['api', 'auth', 'resend-verification'], limit: JSON_LIMIT, run: (ctx, caller) => auth.resendVerification(ctx, caller) },
  { method: 'GET', segments: ['api', 'config'], run: (ctx) => auth.clientConfig(ctx) },

  { method: 'POST', segments: ['api', 'join', 'code'], limit: JSON_LIMIT, run: (ctx, caller, _p, body) => joinRoutes.joinWithCode(ctx, caller, parseJsonBody(ctx, body)) },
  { method: 'POST', segments: ['api', 'join', 'nickname'], limit: JSON_LIMIT, run: (ctx, caller, _p, body) => joinRoutes.joinWithNickname(ctx, caller, parseJsonBody(ctx, body)) },
  { method: 'GET', segments: ['api', 'class'], run: (ctx, caller) => joinRoutes.studentClass(ctx, caller) },

  { method: 'GET', segments: ['api', 'classrooms'], run: (ctx, caller) => classroomRoutes.listClassrooms(ctx, caller) },
  { method: 'POST', segments: ['api', 'classrooms'], limit: JSON_LIMIT, run: (ctx, caller, _p, body) => classroomRoutes.createClassroom(ctx, caller, parseJsonBody(ctx, body)) },
  { method: 'GET', segments: ['api', 'classrooms', ':id'], run: (ctx, caller, params) => classroomRoutes.getClassroom(ctx, caller, params) },
  { method: 'PATCH', segments: ['api', 'classrooms', ':id'], limit: JSON_LIMIT, run: (ctx, caller, params, body) => classroomRoutes.patchClassroom(ctx, caller, params, parseJsonBody(ctx, body)) },
  { method: 'POST', segments: ['api', 'classrooms', ':id', 'join-code'], limit: JSON_LIMIT, run: (ctx, caller, params) => classroomRoutes.replaceJoinCode(ctx, caller, params) },
  { method: 'POST', segments: ['api', 'classrooms', ':id', 'hand-in'], limit: JSON_LIMIT, run: (ctx, caller, params) => classroomRoutes.handInClassroom(ctx, caller, params) },
  { method: 'POST', segments: ['api', 'classrooms', ':id', 'archive'], limit: JSON_LIMIT, run: (ctx, caller, params) => classroomRoutes.archiveClassroom(ctx, caller, params) },
  { method: 'PATCH', segments: ['api', 'classrooms', ':id', 'students', ':studentId'], limit: JSON_LIMIT, run: (ctx, caller, params, body) => classroomRoutes.renameStudent(ctx, caller, params, parseJsonBody(ctx, body)) },
  { method: 'DELETE', segments: ['api', 'classrooms', ':id', 'students', ':studentId'], run: (ctx, caller, params) => classroomRoutes.removeStudent(ctx, caller, params) },
  { method: 'POST', segments: ['api', 'classrooms', ':id', 'educators'], limit: JSON_LIMIT, run: (ctx, caller, params, body) => classroomRoutes.addEducator(ctx, caller, params, parseJsonBody(ctx, body)) },
  { method: 'DELETE', segments: ['api', 'classrooms', ':id', 'educators', ':educatorId'], run: (ctx, caller, params) => classroomRoutes.removeEducator(ctx, caller, params) },
  { method: 'GET', segments: ['api', 'classrooms', ':id', 'exports'], run: (ctx, caller, params) => classroomRoutes.classroomExports(ctx, caller, params) },

  { method: 'GET', segments: ['api', 'projects'], run: (ctx, caller) => projectRoutes.listProjects(ctx, caller) },
  { method: 'POST', segments: ['api', 'projects'], limit: PROJECT_LIMIT, run: (ctx, caller, _p, body) => projectRoutes.postProject(ctx, caller, parseJsonBody(ctx, body)) },
  { method: 'GET', segments: ['api', 'projects', ':id'], run: (ctx, caller, params) => projectRoutes.getProject(ctx, caller, params) },
  { method: 'PUT', segments: ['api', 'projects', ':id'], limit: PROJECT_LIMIT, run: (ctx, caller, params, body) => projectRoutes.putProject(ctx, caller, params, body) },
  { method: 'POST', segments: ['api', 'projects', ':id', 'hand-in'], limit: JSON_LIMIT, run: (ctx, caller, params) => projectRoutes.postHandIn(ctx, caller, params) },

  { method: 'GET', segments: ['api', 'exports'], run: (ctx, caller) => exportRoutes.listExports(ctx, caller) },
  { method: 'POST', segments: ['api', 'exports'], limit: EXPORT_LIMIT, run: (ctx, caller, _p, body) => exportRoutes.postExport(ctx, caller, body) },
  { method: 'GET', segments: ['api', 'exports', ':id', 'download'], run: (ctx, caller, params) => exportRoutes.downloadExport(ctx, caller, params) },

  { method: 'GET', segments: ['api', 'stream'], run: (ctx, caller) => streamRoute(ctx, caller) },

  { method: 'POST', segments: ['api', 'grading', 'seed'], limit: JSON_LIMIT, run: (ctx) => grading.gradingSeed(ctx) },
  { method: 'GET', segments: ['api', 'grading', 'session'], run: (ctx) => grading.gradingSession(ctx) },
  { method: 'POST', segments: ['api', 'grading', 'clock'], limit: JSON_LIMIT, run: (ctx, _caller, _p, body) => grading.gradingClock(ctx, parseJsonBody(ctx, body)) },
];

const streamRoute = async (ctx: RequestContext, caller: Caller): Promise<void> => {
  const account = caller.account;
  if (!account) throw signedOutError(caller);
  let classroomIds: string[] = [];
  if (account.kind === 'educator') {
    const rows = await query<{ classroom_id: string }>(
      'select classroom_id from classroom_educators where educator_id = $1',
      [account.id],
    );
    classroomIds = rows.map((row) => row.classroom_id);
  } else if (account.kind === 'student' && account.classroom_id) {
    classroomIds = [account.classroom_id];
  }
  openStream(ctx.res, { id: account.id, kind: account.kind }, classroomIds);
};

const matchRoute = (method: string, segments: string[]): { route: Route; params: Params } | null => {
  for (const route of routes) {
    if (route.method !== method || route.segments.length !== segments.length) continue;
    const params: Params = {};
    let ok = true;
    for (let index = 0; index < segments.length; index += 1) {
      const pattern = route.segments[index];
      if (pattern.startsWith(':')) params[pattern.slice(1)] = decodeURIComponent(segments[index]);
      else if (pattern !== segments[index]) {
        ok = false;
        break;
      }
    }
    if (ok) return { route, params };
  }
  return null;
};

const health = async (ctx: RequestContext): Promise<void> => {
  const [database, storage] = await Promise.all([databaseAnswers(), storageAnswers()]);
  sendJson(ctx, 200, { status: database && storage ? 'ok' : 'unavailable' });
};

const PAGE_PATHS = ['/', '/signin', '/signup', '/verify', '/join', '/dashboard', '/projects', '/class'];

const isPagePath = (pathname: string): boolean =>
  PAGE_PATHS.includes(pathname) ||
  /^\/classrooms\/[^/]+$/.test(pathname) ||
  /^\/editor\/[^/]+$/.test(pathname);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

const serveAsset = async (ctx: RequestContext, pathname: string): Promise<boolean> => {
  const relative = normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
  if (relative === '' || relative.includes('..')) return false;
  const file = join(publicDir, relative);
  if (!file.startsWith(publicDir)) return false;
  try {
    const info = await stat(file);
    if (!info.isFile()) return false;
    const body = await readFile(file);
    const type = MIME[extname(file)] ?? 'application/octet-stream';
    ctx.res.writeHead(200, {
      'content-type': type,
      'content-length': body.length,
      'cache-control': extname(file) === '.html' ? 'no-store' : 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    });
    ctx.res.end(body);
    return true;
  } catch {
    return false;
  }
};

const servePage = async (ctx: RequestContext): Promise<void> => {
  const caller = await loadCaller(ctx).catch(() => null);
  if (caller?.pendingClassroomId && ctx.url.pathname !== '/join') {
    ctx.res.writeHead(302, { location: '/join', 'cache-control': 'no-store' });
    ctx.res.end();
    return;
  }
  const html = await readFile(join(publicDir, 'index.html'));
  ctx.res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': html.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  ctx.res.end(html);
};

const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const ctx = makeContext(req, res);
  const pathname = ctx.url.pathname;
  try {
    checkOrigin(ctx);
    if (pathname === '/api/health') {
      await health(ctx);
      return;
    }
    const segments = pathname.split('/').filter((part) => part !== '');
    if (segments[0] === 'api') {
      const matched = matchRoute(ctx.method, segments);
      if (!matched) throw notFound();
      if (!databaseReady()) throw new ApiError(503, 'database_unavailable');
      const body = matched.route.limit === undefined ? Buffer.alloc(0) : await readBody(ctx, matched.route.limit);
      const caller = await loadCaller(ctx);
      await matched.route.run(ctx, caller, matched.params, body);
      return;
    }
    if (ctx.method !== 'GET' && ctx.method !== 'HEAD') throw notFound();
    if (await serveAsset(ctx, pathname)) return;
    if (isPagePath(pathname)) {
      await servePage(ctx);
      return;
    }
    throw notFound();
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof ApiError) {
      sendError(ctx, error);
      return;
    }
    process.stderr.write(`[quarkyard] ${String(error)}\n`);
    sendJson(ctx, 500, { error: 'validation', message: 'Check the highlighted fields.' });
  }
};

startDatabase();
startStreamClock();
void ensureBucket()
  .then(() => sweepOrphanObjects())
  .catch(() => undefined);

createServer((req, res) => {
  void handle(req, res);
}).listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`[quarkyard] listening on http://0.0.0.0:${config.port}\n`);
});
