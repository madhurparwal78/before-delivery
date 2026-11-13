import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { loadConfig } from './config.js';
import type { Config } from './config.js';
import { connectWithRetry } from './db.js';
import type { Db } from './db.js';
import { Services } from './services.js';
import { EventHub } from './events.js';
import { Router, sendJson, sendError, readBody, assertSameOrigin, isWrite, type RequestContext } from './http.js';
import { parseCookies, serializeCookie, encodePassCookie, decodePassCookie, SESSION_COOKIE, PASS_COOKIE } from './cookies.js';
import { createSignedToken, verifySignedToken, getUserBySessionToken } from './sessions.js';
import { notFound, passwordRequired } from './errors.js';
import * as auth from './auth.js';
import * as boards from './boards.js';
import * as members from './members.js';
import * as posts from './posts.js';
import * as links from './links.js';
import * as exportCsv from './export.js';
import * as fixture from './fixture.js';
import { accessToBoard, membershipRole } from './access.js';
import { seedDemoData } from './seed.js';
import type { App } from './app.js';

const JSON_MAX = 64_000;
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

export async function main(): Promise<void> {
  const config = loadConfig();
  const db = await connectWithRetry(config.databaseUrl, (msg) => console.error(msg));
  const services = new Services(config);
  const events = new EventHub(db);
  const app: App = {
    db,
    config,
    services,
    events,
    passUnlocks(ctx) {
      const raw = verifySignedToken(ctx.cookies[PASS_COOKIE]);
      return decodePassCookie(raw ?? undefined);
    },
    addPassUnlock(ctx, boardId, generation) {
      const current = this.passUnlocks(ctx).filter((u) => u.boardId !== boardId);
      current.push({ boardId, generation });
      const signed = createSignedToken(encodePassCookie(current));
      const cookie = serializeCookie(PASS_COOKIE, signed);
      appendSetCookie(ctx, cookie);
    },
    setSessionCookie(ctx, value) {
      const cookie = value
        ? serializeCookie(SESSION_COOKIE, value)
        : serializeCookie(SESSION_COOKIE, '', { maxAge: null, expires: null });
      appendSetCookie(ctx, cookie);
    },
    setPassCookie(ctx, value) {
      appendSetCookie(ctx, serializeCookie(PASS_COOKIE, value));
    },
  };
  await seedDemoData(db, services.storage);
  services.startChecking();
  startBackgroundJobs(app);

  const router = new Router();
  router.get('/api/health', async (ctx) => {
    const state = services.state;
    const ok = state.storage && state.mail && state.push;
    sendJson(ctx.res, 200, { status: ok ? 'ok' : 'unavailable' });
  });
  router.post('/api/auth/signup', (ctx) => auth.handleSignup(app, ctx));
  router.post('/api/auth/verify', (ctx) => auth.handleVerify(app, ctx));
  router.post('/api/auth/signin', (ctx) => auth.handleSignin(app, ctx));
  router.post('/api/auth/signout', (ctx) => auth.handleSignout(app, ctx));
  router.get('/api/me', (ctx) => auth.handleMe(app, ctx));
  router.get('/api/boards', (ctx) => boards.handleListBoards(app, ctx));
  router.post('/api/boards', (ctx) => boards.handleCreateBoard(app, ctx));
  router.get('/api/boards/:id', (ctx) => boards.handleGetBoard(app, ctx));
  router.patch('/api/boards/:id', (ctx) => boards.handlePatchBoard(app, ctx));
  router.post('/api/boards/:id/rotate-link', (ctx) => boards.handleRotateLink(app, ctx));
  router.delete('/api/boards/:id', (ctx) => boards.handleDeleteBoard(app, ctx));
  router.post('/api/boards/:id/unlock', (ctx) => boards.handleUnlock(app, ctx));
  router.get('/api/boards/:id/posts', (ctx) => boards.handleBoardPosts(app, ctx));
  router.get('/api/boards/:id/export.csv', (ctx) => exportCsv.handleExportCsv(app, ctx));
  router.get('/api/boards/:id/members', (ctx) => members.handleListMembers(app, ctx));
  router.patch('/api/boards/:id/members/:userId', (ctx) => members.handlePatchMember(app, ctx));
  router.delete('/api/boards/:id/members/:userId', (ctx) => members.handleRemoveMember(app, ctx));
  router.post('/api/boards/:id/invites', (ctx) => members.handleInvite(app, ctx));
  router.get('/api/invites/:token', (ctx) => members.handleGetInvite(app, ctx));
  router.post('/api/invites/:token/accept', (ctx) => members.handleAcceptInvite(app, ctx));
  router.get('/api/links/:token', (ctx) => links.handleGetLink(app, ctx));
  router.post('/api/links/:token/unlock', (ctx) => links.handleLinkUnlock(app, ctx));
  router.post('/api/links/:token/join', (ctx) => links.handleLinkJoin(app, ctx));
  router.post('/api/boards/:id/posts', (ctx) => posts.handleCreatePost(app, ctx));
  router.get('/api/posts/:id', (ctx) => posts.handleGetPost(app, ctx));
  router.patch('/api/posts/:id', (ctx) => posts.handlePatchPost(app, ctx));
  router.patch('/api/posts/:id/move', (ctx) => posts.handleMovePost(app, ctx));
  router.delete('/api/posts/:id', (ctx) => posts.handleDeletePost(app, ctx));
  router.post('/api/posts/:id/approve', (ctx) => posts.handleApprovePost(app, ctx));
  router.post('/api/posts/:id/reject', (ctx) => posts.handleRejectPost(app, ctx));
  router.put('/api/posts/:id/like', (ctx) => posts.handleLike(app, ctx, true));
  router.delete('/api/posts/:id/like', (ctx) => posts.handleLike(app, ctx, false));
  router.put('/api/posts/:id/vote', (ctx) => posts.handleVote(app, ctx, readVoteValue(ctx)));
  router.delete('/api/posts/:id/vote', (ctx) => posts.handleVote(app, ctx, null));
  router.get('/api/posts/:id/comments', (ctx) => posts.handleListComments(app, ctx));
  router.post('/api/posts/:id/comments', (ctx) => posts.handleCreateComment(app, ctx));
  router.get('/api/attachments/:id', (ctx) => posts.handleGetAttachment(app, ctx));
  router.post('/api/grading/fixture', (ctx) => fixture.handleGradingFixture(app, ctx));
  router.get('/api/boards/:id/events', (ctx) => handleBoardEvents(app, ctx));
  router.get('/api/links/:token/events', (ctx) => handleLinkEvents(app, ctx));

  const staticRoot = resolve('dist/static');
  const indexHtml = readFileSync(join(staticRoot, 'index.html'), 'utf8');

  const server = http.createServer(async (req, res) => {
    try {
      await handleRequest(app, router, staticRoot, indexHtml, req, res);
    } catch (err) {
      sendError(res, err);
    }
  });

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`pinsheet listening on ${config.port}`);
  });
}

function readVoteValue(ctx: RequestContext): number | null {
  const body = ctx.jsonBody as Record<string, unknown>;
  return body.value === 1 ? 1 : body.value === -1 ? -1 : null;
}

function appendSetCookie(ctx: RequestContext, cookie: string): void {
  const existing = ctx.res.getHeader('Set-Cookie');
  const current = typeof existing === 'string' ? [existing] : (existing as string[] | undefined) ?? [];
  current.push(cookie);
  ctx.res.setHeader('Set-Cookie', current);
}

async function handleRequest(
  app: App,
  router: Router,
  staticRoot: string,
  indexHtml: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const cookies = parseCookies(req.headers.cookie);
  const user = await getUserBySessionToken(app.db, cookies[SESSION_COOKIE]).catch(() => null);
  const ctx: RequestContext = {
    req,
    res,
    url,
    params: { id: '', token: '', userId: '' },
    cookies,
    rawBody: null,
    jsonBody: null,
    userId: user?.id ?? null,
  };

  if (isWrite(req.method ?? 'GET')) {
    assertSameOrigin(req);
  }

  if (url.pathname.startsWith('/api/')) {
    const matched = router.match(req.method ?? 'GET', url.pathname);
    if (!matched) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    ctx.params = { id: matched.params.id ?? '', token: matched.params.token ?? '', userId: matched.params.userId ?? '' };
    const contentType = String(req.headers['content-type'] ?? '');
    if (contentType.startsWith('multipart/form-data')) {
      ctx.rawBody = await readBody(req, app.config.uploadMaxBytes + JSON_MAX);
    } else if (contentType.startsWith('application/json') || contentType.startsWith('text/')) {
      const raw = await readBody(req, JSON_MAX);
      ctx.rawBody = raw;
      if (raw.length > 0) {
        try {
          ctx.jsonBody = JSON.parse(raw.toString('utf8'));
        } catch {
          sendJson(res, 400, { error: 'bad_request' });
          return;
        }
      }
    }
    try {
      await matched.handler(ctx);
    } catch (err) {
      sendError(res, err);
    }
    return;
  }

  await servePage(app, staticRoot, indexHtml, url.pathname, ctx);
}

async function servePage(
  app: App,
  staticRoot: string,
  indexHtml: string,
  pathname: string,
  ctx: RequestContext,
): Promise<void> {
  if (pathname.startsWith('/assets/') || pathname.startsWith('/fonts/') || pathname === '/favicon.svg' || pathname === '/index.js') {
    const safe = pathname.replace(/^\/+/, '');
    if (safe.includes('..') || safe.includes('\\') || safe.includes('%2f') || safe.includes('%2F')) {
      ctx.res.writeHead(404, { 'Content-Type': 'text/plain' });
      ctx.res.end('not found');
      return;
    }
    const file = join(staticRoot, safe);
    if (!file.startsWith(staticRoot) || !existsSync(file) || statSync(file).isDirectory()) {
      ctx.res.writeHead(404, { 'Content-Type': 'text/plain' });
      ctx.res.end('not found');
      return;
    }
    const type = MIME[extname(file)] ?? 'application/octet-stream';
    const bytes = readFileSync(file);
    ctx.res.writeHead(200, { 'Content-Type': type, 'Content-Length': bytes.length });
    ctx.res.end(bytes);
    return;
  }

  if (pathname === '/package.json' || pathname === '/package-lock.json' || pathname.startsWith('/src/') || pathname === '/run.json' || pathname === '/tsconfig.json' || pathname === '/.env' || pathname === '/.git/config' || pathname.startsWith('/dist/server')) {
    ctx.res.writeHead(404, { 'Content-Type': 'text/plain' });
    ctx.res.end('not found');
    return;
  }

  const notFoundRoutes = [/^\/b\/[^/]+$/, /^\/s\/[^/]+$/, /^\/embed\/[^/]+$/, /^\/invite\/[^/]+$/];
  if (notFoundRoutes.some((pattern) => pattern.test(pathname))) {
    const route = parsePageRoute(pathname);
    const gate = await pageGate(app, ctx, route);
    if (gate === 'missing') {
      ctx.res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      ctx.res.end(indexHtml);
      return;
    }
  }

  ctx.res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  ctx.res.end(indexHtml);
}

interface PageRoute {
  kind: 'landing' | 'signin' | 'signup' | 'board' | 'share' | 'embed' | 'invite' | 'unknown';
  id: string;
}

function parsePageRoute(pathname: string): PageRoute {
  const boardMatch = /^\/b\/([^/]+)$/.exec(pathname);
  if (boardMatch) return { kind: 'board', id: boardMatch[1]! };
  const shareMatch = /^\/s\/([^/]+)$/.exec(pathname);
  if (shareMatch) return { kind: 'share', id: shareMatch[1]! };
  const embedMatch = /^\/embed\/([^/]+)$/.exec(pathname);
  if (embedMatch) return { kind: 'embed', id: embedMatch[1]! };
  const inviteMatch = /^\/invite\/([^/]+)$/.exec(pathname);
  if (inviteMatch) return { kind: 'invite', id: inviteMatch[1]! };
  return { kind: 'unknown', id: '' };
}

async function pageGate(app: App, ctx: RequestContext, route: PageRoute): Promise<'open' | 'password' | 'missing'> {
  if (route.kind === 'board') {
    const access = await accessToBoard(app.db, route.id, { userId: ctx.userId, passUnlocks: app.passUnlocks(ctx) });
    if (access.kind === 'open') return 'open';
    if (access.kind === 'password') return 'password';
    return 'missing';
  }
  if (route.kind === 'invite') {
    const res = await app.db.query('SELECT board_id FROM invites WHERE token = $1', [route.id]);
    const row = res.rows[0] as { board_id: string } | undefined;
    return row ? 'open' : 'missing';
  }
  if (route.kind === 'share' || route.kind === 'embed') {
    const link = await links.linkBoard(app, route.id);
    if (link === 'missing') return 'missing';
    const { board } = link;
    const isEmbed = route.kind === 'embed';
    if (isEmbed && board.privacy !== 'public') return 'missing';
    const role = await membershipRole(app.db, board.id, ctx.userId);
    if (!role && board.privacy === 'password') {
      const unlocked = app.passUnlocks(ctx).some((u) => u.boardId === board.id && u.generation === board.pass_gen);
      if (!unlocked) return 'password';
    }
    return 'open';
  }
  return 'open';
}

async function handleBoardEvents(app: App, ctx: RequestContext): Promise<void> {
  const access = await accessToBoard(app.db, ctx.params.id, {
    userId: ctx.userId,
    passUnlocks: app.passUnlocks(ctx),
  });
  if (access.kind === 'missing') throw notFound();
  if (access.kind === 'password') throw passwordRequired();
  startStream(app, ctx, access.board.id);
}

async function handleLinkEvents(app: App, ctx: RequestContext): Promise<void> {
  const link = await links.linkBoard(app, ctx.params.token);
  if (link === 'missing') throw notFound();
  const { board } = link;
  const role = await membershipRole(app.db, board.id, ctx.userId);
  if (!role && board.privacy === 'password') {
    const unlocked = app.passUnlocks(ctx).some((u) => u.boardId === board.id && u.generation === board.pass_gen);
    if (!unlocked) throw passwordRequired();
  }
  startStream(app, ctx, board.id);
}

function startStream(app: App, ctx: RequestContext, boardId: string): void {
  const res = ctx.res;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const lastEventId = Number(ctx.req.headers['last-event-id'] ?? 0);
  let lastSent = Number.isFinite(lastEventId) ? lastEventId : 0;
  const keepAlive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15_000);
  void app.events
    .replaySince(boardId, lastSent)
    .then((rows) => {
      for (const row of rows) {
        app.events.writeEvent(res, row.id, row.payload);
        lastSent = row.id;
      }
      const listener = {
        boardId,
        check: async () => null,
        res,
        lastSentId: lastSent,
        keepAlive,
      };
      app.events.subscribe(listener);
      res.on('close', () => {
        app.events.unsubscribe(listener);
      });
    })
    .catch(() => {
      clearTimeout(keepAlive);
      res.end();
    });
}

function startBackgroundJobs(app: App): void {
  setInterval(() => {
    void retryPendingPushes(app);
  }, 10_000);
  setInterval(() => {
    void retryStorageDeletes(app);
  }, 10_000);
}

async function retryPendingPushes(app: App): Promise<void> {
  const res = await app.db.query(
    `SELECT p.id, p.title, p.board_id, b.title AS board_title
       FROM push_retries pr JOIN posts p ON p.id = pr.post_id JOIN boards b ON b.id = p.board_id
      WHERE pr.next_at <= now() AND p.state = 'awaiting_approval'`,
  );
  for (const row of res.rows) {
    const r = row as { id: string; title: string; board_id: string; board_title: string };
    const ok = await app.services.push.publish(r.board_id, r.board_title, r.title);
    if (ok) {
      await app.db.query('UPDATE posts SET push_state = $1 WHERE id = $2', ['sent', r.id]);
      await app.db.query('DELETE FROM push_retries WHERE post_id = $1', [r.id]);
      await app.events.publish(r.board_id, { type: 'push_sent', post_id: r.id });
    } else {
      await app.db.query("UPDATE push_retries SET next_at = now() + interval '10 seconds' WHERE post_id = $1", [r.id]);
    }
  }
}

async function retryStorageDeletes(app: App): Promise<void> {
  const res = await app.db.query('SELECT id, prefix FROM storage_retries WHERE next_at <= now()');
  for (const row of res.rows) {
    const r = row as { id: string; prefix: string };
    const ok = await app.services.storage.deletePrefix(r.prefix);
    if (ok) {
      await app.db.query('DELETE FROM storage_retries WHERE id = $1', [r.id]);
    } else {
      await app.db.query("UPDATE storage_retries SET next_at = now() + interval '10 seconds' WHERE id = $1", [r.id]);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
