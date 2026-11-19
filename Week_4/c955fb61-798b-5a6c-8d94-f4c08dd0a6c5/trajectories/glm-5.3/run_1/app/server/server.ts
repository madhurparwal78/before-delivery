// The server: one origin for pages, assets, the API and the live channel.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPool } from './store/db.ts';
import * as q from './store/queries.ts';
import { readConfig, type Config } from './config.ts';
import { ApiError, notFound, serverError, unauthenticated } from './http/errors.ts';
import { checkPrecedence, readCookie, sendJson, sendError, type RequestCtx } from './http/plumbing.ts';
import { FileStorage } from './services/storage.ts';
import { Mailer } from './services/mailer.ts';
import { NoticeQueue } from './services/notices.ts';
import { LiveHub } from './services/live.ts';
import { readProject } from './services/projects.ts';
import * as routes from './http/routes.ts';
import * as routes2 from './http/routes2.ts';
import * as routes3 from './http/routes3.ts';
import * as exportRoutes from './http/exports-routes.ts';
import { gradingSetup } from './http/grading.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = Number.parseInt(process.env.APP_PUBLIC_PORT || '4173', 10);

const config: Config = readConfig();
const pool = await openPool(process.env.DATABASE_URL || '');
const storage = new FileStorage({
  endpoint: process.env.S3_ENDPOINT || '',
  region: process.env.S3_REGION || 'us-east-1',
  bucket: process.env.S3_BUCKET || '',
  forcePathStyle: (process.env.S3_FORCE_PATH_STYLE || 'true') === 'true',
  accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
});
const mailer = new Mailer({ host: process.env.SMTP_HOST || '', port: Number.parseInt(process.env.SMTP_PORT || '1025', 10), from: config.mailFrom });
const notices = new NoticeQueue(pool, mailer, config);
const live = new LiveHub(config.presenceTimeoutSeconds);

// Edits to one project apply one at a time, in the order the server receives them.
const projectLocks = new Map<string, Promise<unknown>>();

async function withProjectLock<T>(projectId: string, work: () => Promise<T>): Promise<T> {
  const prior = projectLocks.get(projectId) ?? Promise.resolve();
  const next = prior.then(work, work);
  projectLocks.set(projectId, next);
  try {
    return await next;
  } finally {
    if (projectLocks.get(projectId) === next) projectLocks.delete(projectId);
  }
}

interface LiveUser {
  userId: string;
  name: string;
}

const deps: routes.RouteDeps = {
  pool,
  config,
  today: () => config.today,
  requireProject: async (ctx, projectId) => {
    const userId = routes.requireSession(ctx);
    const project = await q.projectById(pool, projectId);
    if (project === null) throw notFound();
    const role = await q.memberRole(pool, project.workspaceId, userId);
    if (role === null) throw notFound();
    return { project, role };
  },
  requireWorkspace: async (ctx, workspaceId) => {
    const userId = routes.requireSession(ctx);
    const role = await q.memberRole(pool, workspaceId, userId);
    if (role === null) throw notFound();
  },
  afterEdit: async (projectId, by, kind, item) => {
    const snapshot = await readProject(pool, projectId, config.today);
    const byName = await q.personById(pool, by);
    live.publish(projectId, {
      kind: 'project',
      payload: { project: snapshot?.project ?? null, by: byName?.name ?? '', kind, item: item ?? null, at: new Date().toISOString() },
    });
  },
  afterComment: async (projectId, by, itemId, comment) => {
    const byName = await q.personById(pool, by);
    live.publish(projectId, {
      kind: 'comment',
      payload: {
        itemId,
        comment: {
          id: comment.id,
          author: { userId: comment.authorId, name: byName?.name ?? '' },
          text: comment.text,
          createdAt: comment.createdAt.toISOString(),
        },
      },
    });
  },
  afterExport: async (projectId) => {
    const rows = await q.storedExports(pool, projectId);
    live.publish(projectId, {
      kind: 'export',
      payload: {
        exports: rows.map((row) => ({
          id: row.id,
          format: row.format,
          filename: row.filename,
          downloadUrl: `/api/exports/${row.id}/download`,
          createdAt: (row.storedAt ?? row.createdAt).toISOString(),
        })),
      },
    });
  },
  notices,
};

// ---------------------------------------------------------------------------
// Presence over the live channel

async function sessionUser(token: string | null): Promise<LiveUser | null> {
  if (token === null) return null;
  const result = await pool.query('select user_id as "userId" from sessions where token = $1', [token]);
  const userId: string | undefined = result.rows[0]?.userId;
  if (userId === undefined) return null;
  const person = await q.personById(pool, userId);
  return person === null ? null : { userId: person.id, name: person.name };
}

async function publishPresence(projectId: string): Promise<void> {
  const people = live.peopleHere(projectId);
  const named: { userId: string; name: string; selected: string | null }[] = [];
  for (const person of people) {
    const record = await q.personById(pool, person.userId);
    named.push({ userId: person.userId, name: record?.name ?? '', selected: person.selected });
  }
  live.publish(projectId, { kind: 'presence', payload: { people: named } });
}

setInterval(() => {
  live.sweep();
}, 1000);

setInterval(() => {
  void notices.deliverOnce();
}, 1000);

// ---------------------------------------------------------------------------
// Routing

function matchRoute(method: string, path: string, pattern: string): string[] | null {
  const patternParts = pattern.split('/').filter((p) => p !== '');
  const pathParts = path.split('/').filter((p) => p !== '');
  if (patternParts.length !== pathParts.length) return null;
  const params: string[] = [];
  for (let i = 0; i < patternParts.length; i += 1) {
    if (patternParts[i].startsWith('<') && patternParts[i].endsWith('>')) params.push(decodeURIComponent(pathParts[i]));
    else if (patternParts[i] !== pathParts[i]) return null;
  }
  return params;
}

interface RouteSpec {
  method: string;
  pattern: string;
  public: boolean;
  handler: (ctx: RequestCtx, ...params: string[]) => Promise<void>;
  lock: 'project' | null;
}

const ROUTES: RouteSpec[] = [
  { method: 'GET', pattern: '/api/health', public: true, handler: async (ctx) => sendJson(ctx.res, 200, { status: 'ok' }), lock: null },
  { method: 'GET', pattern: '/api/config', public: true, handler: async (ctx) => sendJson(ctx.res, 200, {
    today: config.today,
    timeZone: config.timeZone,
    assignNoticeDelaySeconds: config.assignNoticeDelaySeconds,
    presenceTimeoutSeconds: config.presenceTimeoutSeconds,
    knockOnMs: config.knockOnMs,
    knockOnStaggerMs: config.knockOnStaggerMs,
    finishMotionMs: config.finishMotionMs,
  }), lock: null },
  { method: 'POST', pattern: '/api/grading/setup', public: true, handler: (ctx) => gradingSetup(pool, config, ctx), lock: null },
  { method: 'POST', pattern: '/api/signup', public: true, handler: (ctx) => routes.signup(deps, ctx), lock: null },
  { method: 'POST', pattern: '/api/session', public: true, handler: (ctx) => routes.signin(deps, ctx), lock: null },
  { method: 'DELETE', pattern: '/api/session', public: false, handler: (ctx) => routes.signout(deps, ctx), lock: null },
  { method: 'GET', pattern: '/api/me', public: false, handler: (ctx) => routes.me(deps, ctx), lock: null },
  { method: 'GET', pattern: '/api/projects', public: false, handler: (ctx) => routes.listProjects(deps, ctx), lock: null },
  { method: 'POST', pattern: '/api/projects', public: false, handler: (ctx) => routes.createProject(deps, ctx), lock: null },
  { method: 'GET', pattern: '/api/projects/<id>', public: false, handler: (ctx, id) => routes.getProject(deps, ctx, id), lock: null },
  { method: 'POST', pattern: '/api/projects/<id>/items', public: false, handler: (ctx, id) => withProjectLock(id, () => routes.createItem(deps, ctx, id)), lock: null },
  { method: 'PATCH', pattern: '/api/items/<id>', public: false, handler: (ctx, id) => withProjectLockOfItem(id, () => routes.patchItem(deps, ctx, id)), lock: null },
  { method: 'DELETE', pattern: '/api/items/<id>', public: false, handler: (ctx, id) => withProjectLockOfItem(id, () => routes.deleteItem(deps, ctx, id)), lock: null },
  { method: 'POST', pattern: '/api/items/<id>/reorder', public: false, handler: (ctx, id) => withProjectLockOfItem(id, () => routes3.reorderItem(deps, ctx, id)), lock: null },
  { method: 'PUT', pattern: '/api/items/<id>/predecessors', public: false, handler: (ctx, id) => withProjectLockOfItem(id, () => routes2.putPredecessors(deps, ctx, id)), lock: null },
  { method: 'POST', pattern: '/api/projects/<id>/links', public: false, handler: (ctx, id) => withProjectLock(id, () => routes2.createLink(deps, ctx, id)), lock: null },
  { method: 'DELETE', pattern: '/api/links/<id>', public: false, handler: (ctx, id) => withProjectLockOfLink(id, () => routes2.deleteLink(deps, ctx, id)), lock: null },
  { method: 'POST', pattern: '/api/projects/<id>/holidays', public: false, handler: (ctx, id) => withProjectLock(id, () => routes2.addHoliday(deps, ctx, id)), lock: null },
  { method: 'DELETE', pattern: '/api/projects/<id>/holidays/<date>', public: false, handler: (ctx, id) => withProjectLock(id, () => routes2.removeHoliday(deps, ctx, id, ctx.path.split('/')[5] ?? '')), lock: null },
  { method: 'POST', pattern: '/api/projects/<id>/baseline', public: false, handler: (ctx, id) => withProjectLock(id, () => routes2.saveBaseline(deps, ctx, id)), lock: null },
  { method: 'POST', pattern: '/api/items/<id>/assignees', public: false, handler: (ctx, id) => withProjectLockOfItem(id, () => routes2.addAssignee(deps, ctx, id)), lock: null },
  { method: 'DELETE', pattern: '/api/items/<id>/assignees/<userId>', public: false, handler: (ctx, id) => withProjectLockOfItem(id, () => routes2.removeAssignee(deps, ctx, id, id)), lock: null },
  { method: 'GET', pattern: '/api/items/<id>/comments', public: false, handler: (ctx, id) => routes2.listComments(deps, ctx, id), lock: null },
  { method: 'POST', pattern: '/api/items/<id>/comments', public: false, handler: (ctx, id) => routes2.postComment(deps, ctx, id), lock: null },
  { method: 'GET', pattern: '/api/workspaces/<id>/workload', public: false, handler: (ctx, id) => routes2.workload(deps, ctx, id), lock: null },
  { method: 'GET', pattern: '/api/projects/<id>/presence', public: false, handler: (ctx, id) => presenceRoute(deps, ctx, id), lock: null },
  { method: 'POST', pattern: '/api/projects/<id>/exports', public: false, handler: (ctx, id) => exportRoutes.createExport({ ...deps, storage }, ctx, id), lock: null },
  { method: 'GET', pattern: '/api/projects/<id>/exports', public: false, handler: (ctx, id) => exportRoutes.listExports(deps, ctx, id), lock: null },
  { method: 'GET', pattern: '/api/exports/<id>/download', public: false, handler: (ctx, id) => exportRoutes.downloadExport({ ...deps, storage }, ctx, id), lock: null },
  { method: 'GET', pattern: '/api/projects/<id>/live', public: false, handler: (ctx, id) => liveRoute(ctx, id), lock: null },
];

async function withProjectLockOfItem(itemId: string, work: () => Promise<void>): Promise<void> {
  const item = await q.itemById(pool, itemId);
  if (item === null) throw notFound();
  await withProjectLock(item.projectId, work);
}

async function withProjectLockOfLink(linkId: string, work: () => Promise<void>): Promise<void> {
  const link = await q.linkById(pool, linkId);
  if (link === null) throw notFound();
  await withProjectLock(link.projectId, work);
}

// ---------------------------------------------------------------------------
// SSE live channel

async function liveRoute(ctx: RequestCtx, projectId: string): Promise<void> {
  const user = await sessionUser(ctx.session?.token ?? null);
  if (user === null) throw unauthenticated();
  const role = await (async () => {
    const project = await q.projectById(pool, projectId);
    if (project === null) return null;
    return q.memberRole(pool, project.workspaceId, user.userId);
  })();
  if (role === null) throw notFound();
  ctx.res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  ctx.res.write(':\n\n');
  live.subscribe(projectId, user.userId, ctx.res);
  ctx.res.write(`data: ${JSON.stringify({ kind: 'hello', payload: { userId: user.userId } })}\n\n`);
  await publishPresence(projectId);
  ctx.raw.on('close', () => {
    live.unsubscribe(projectId, user.userId, ctx.res);
    void publishPresence(projectId);
  });
}

async function presenceRoute(deps2: routes.RouteDeps, ctx: RequestCtx, projectId: string): Promise<void> {
  routes.requireSession(ctx);
  await deps2.requireProject(ctx, projectId);
  const token = ctx.session?.token ?? null;
  const user = await sessionUser(token);
  if (user === null) throw unauthenticated();
  live.heartbeat(projectId, user.userId);
  const selectedParam = ctx.query.get('selected');
  live.select(projectId, user.userId, selectedParam === null ? null : selectedParam);
  const people = live.peopleHere(projectId);
  const named: { userId: string; name: string; selected: string | null }[] = [];
  for (const person of people) {
    const record = await q.personById(pool, person.userId);
    named.push({ userId: person.userId, name: record?.name ?? '', selected: person.selected });
  }
  sendJson(ctx.res, 200, { people: named.map((p) => ({ userId: p.userId, name: p.name, selected: p.selected })) });
  await publishPresence(projectId);
}

// ---------------------------------------------------------------------------
// Static assets and pages

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const PAGES = ['/', '/signin', '/signup'];

function serveAsset(res: http.ServerResponse, file: string): void {
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR)) {
    res.writeHead(404);
    res.end();
    return;
  }
  fs.readFile(full, (error, data) => {
    if (error !== null) {
      res.writeHead(404);
      res.end();
      return;
    }
    const type = MIME[path.extname(full)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

// ---------------------------------------------------------------------------
// The request handler

const server = http.createServer((req, res) => {
  void handle(req, res);
});

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathName = url.pathname;

    if (pathName.startsWith('/api/')) {
      const token = readCookie(req, 'sw_session');
      const user = await sessionUser(token);
      const precedence = await checkPrecedence(req, config);
      if (precedence instanceof ApiError) {
        sendError(res, precedence);
        return;
      }
      const ctx: RequestCtx = {
        method: req.method ?? 'GET',
        path: pathName,
        query: url.searchParams,
        body: precedence.body,
        hasBody: precedence.hasBody,
        session: user === null ? null : { token: token!, userId: user.userId },
        raw: req,
        res,
      };
      const route = ROUTES.find((spec) => spec.method === ctx.method && matchRoute(ctx.method, pathName, spec.pattern) !== null);
      if (route === undefined) {
        sendError(res, notFound());
        return;
      }
      const params = matchRoute(ctx.method, pathName, route.pattern)!;
      try {
        await route.handler(ctx, ...params);
      } catch (error) {
        if (error instanceof ApiError) sendError(res, error);
        else {
          console.error(error);
          sendError(res, serverError());
        }
      }
      return;
    }

    // Live channel without the /api prefix is not used; pages and assets follow.
    if (PAGES.includes(pathName)) {
      serveAsset(res, pathName === '/' ? 'index.html' : `${pathName.slice(1)}.html`);
      return;
    }
    if (pathName.startsWith('/projects/')) {
      serveAsset(res, 'project.html');
      return;
    }
    if (pathName === '/sw.js' || pathName === '/manifest.json') {
      serveAsset(res, pathName.slice(1));
      return;
    }
    if (!pathName.includes('..')) {
      serveAsset(res, pathName.slice(1));
      return;
    }
    res.writeHead(404);
    res.end();
  } catch (error) {
    console.error(error);
    if (!res.headersSent) sendError(res, serverError());
    else res.end();
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`slackwater plan listening on ${PORT}`);
});
