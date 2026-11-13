import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join, normalize, resolve } from 'node:path';
import type { Bootstrap } from '../shared/types';
import { linkAccess, loadBoardRow } from './boards';
import { accessBoard, callerOf } from './context';
import { applySchema, pool, waitForDatabase } from './db';
import { env } from './env';
import { ApiError, notFound } from './errors';
import { Ctx, Router } from './http';
import { pageBootstrap, renderPage } from './pages';
import { registerAttachmentRoutes } from './routes/attachments';
import { registerAuthRoutes, loadUser } from './routes/auth';
import { registerBoardRoutes } from './routes/boards';
import { registerGradingRoutes } from './routes/grading';
import { registerLinkRoutes } from './routes/links';
import { registerMemberRoutes } from './routes/members';
import { registerPostRoutes } from './routes/posts';
import { landingFrames, seedDemoData } from './seed';
import { runServiceChecks, serviceStatus, startBackgroundWork } from './services';
import { ensureBucket } from './storage';

const router = new Router();
registerAuthRoutes(router);
registerBoardRoutes(router);
registerPostRoutes(router);
registerMemberRoutes(router);
registerLinkRoutes(router);
registerAttachmentRoutes(router);
registerGradingRoutes(router);
router.add('GET', '/api/health', (ctx) => {
  const services = serviceStatus();
  const ok = services.storage && services.mail && services.push;
  ctx.sendJson(200, { status: ok ? 'ok' : 'unavailable' });
});

const publicDir = resolve(join(__dirname, '..', 'public'));

const STATIC_TYPES: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
};

const serveStatic = (ctx: Ctx): boolean => {
  const path = ctx.url.pathname;
  const raw = ctx.req.url ?? '';
  if (raw.includes('%2f') || raw.includes('%2F') || raw.includes('%5c') || raw.includes('%5C') || path.includes('\\')) {
    return false;
  }
  const extension = Object.keys(STATIC_TYPES).find((suffix) => path.endsWith(suffix));
  if (extension === undefined) return false;
  const target = resolve(join(publicDir, normalize(path)));
  if (!target.startsWith(`${publicDir}/`) || !existsSync(target) || !statSync(target).isFile()) return false;
  ctx.res.writeHead(200, {
    'Content-Type': STATIC_TYPES[extension],
    'Cache-Control': 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  });
  createReadStream(target).pipe(ctx.res);
  return true;
};

const sendPage = (ctx: Ctx, status: number, bootstrap: Bootstrap, title: string): void => {
  ctx.send(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, Buffer.from(renderPage(bootstrap, title), 'utf8'));
};

const notFoundPage = async (ctx: Ctx): Promise<void> => {
  const user = ctx.userId === null ? null : await loadUser(ctx.userId);
  sendPage(ctx, 404, pageBootstrap(user, { name: 'not_found' }), 'Board not found');
};

const screenForBoard = async (ctx: Ctx, boardId: string): Promise<Bootstrap['screen']> => {
  try {
    await accessBoard(pool, ctx, boardId);
    return { name: 'board', board_id: boardId };
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return { name: 'password', board_id: boardId, token: null };
    throw error;
  }
};

const screenForLink = async (ctx: Ctx, token: string, embed: boolean): Promise<Bootstrap['screen']> => {
  try {
    await linkAccess(pool, callerOf(ctx), token, embed ? 'embed' : 'share');
    return embed ? { name: 'embed', token, embed: true } : { name: 'share', token, embed: false };
  } catch (error) {
    if (error instanceof ApiError && error.status === 403 && !embed) {
      return { name: 'password', board_id: null, token };
    }
    throw error;
  }
};

const handlePage = async (ctx: Ctx): Promise<void> => {
  const path = ctx.url.pathname;
  const user = ctx.userId === null ? null : await loadUser(ctx.userId);

  if (path === '/') {
    if (user === null) {
      sendPage(ctx, 200, pageBootstrap(null, { name: 'landing', frames: await landingFrames() }), 'Pinsheet');
      return;
    }
    sendPage(ctx, 200, pageBootstrap(user, { name: 'dashboard' }), 'Pinsheet');
    return;
  }
  if (path === '/signin' || path === '/signup') {
    sendPage(ctx, 200, pageBootstrap(user, { name: path === '/signin' ? 'signin' : 'signup' }), 'Pinsheet');
    return;
  }

  const boardMatch = /^\/b\/([^/]+)$/.exec(path);
  if (boardMatch !== null) {
    const boardId = decodeURIComponent(boardMatch[1]);
    const screen = await screenForBoard(ctx, boardId);
    const board = await loadBoardRow(pool, boardId);
    sendPage(ctx, 200, pageBootstrap(user, screen), screen.name === 'board' && board !== null ? board.title : 'Pinsheet');
    return;
  }

  const shareMatch = /^\/s\/([^/]+)$/.exec(path);
  if (shareMatch !== null) {
    const screen = await screenForLink(ctx, decodeURIComponent(shareMatch[1]), false);
    sendPage(ctx, 200, pageBootstrap(user, screen), 'Pinsheet');
    return;
  }

  const embedMatch = /^\/embed\/([^/]+)$/.exec(path);
  if (embedMatch !== null) {
    const screen = await screenForLink(ctx, decodeURIComponent(embedMatch[1]), true);
    sendPage(ctx, 200, pageBootstrap(user, screen), 'Pinsheet');
    return;
  }

  const inviteMatch = /^\/invite\/([^/]+)$/.exec(path);
  if (inviteMatch !== null) {
    const token = decodeURIComponent(inviteMatch[1]);
    const invite = await pool.query('select 1 from invites where token = $1', [token]);
    if (invite.rowCount === 0) throw notFound();
    sendPage(ctx, 200, pageBootstrap(user, { name: 'invite', token }), 'Pinsheet');
    return;
  }

  throw notFound();
};

const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
  const ctx = new Ctx(request, response);
  const isApi = ctx.url.pathname.startsWith('/api/');
  try {
    ctx.checkOrigin();
    const route = router.match(ctx.method, ctx.url.pathname);
    if (route !== null) {
      ctx.params = route.params;
      await route.handler(ctx);
      return;
    }
    if (isApi) throw notFound();
    if (ctx.method !== 'GET') throw notFound();
    if (serveStatic(ctx)) return;
    await handlePage(ctx);
  } catch (error) {
    const apiError = error instanceof ApiError ? error : null;
    if (apiError === null) {
      process.stderr.write(`request failed: ${String(error)}\n`);
      if (isApi) ctx.sendJson(500, { error: 'server_error' });
      else ctx.send(500, { 'Content-Type': 'text/plain; charset=utf-8' }, Buffer.from('server error', 'utf8'));
      return;
    }
    if (isApi) {
      ctx.sendJson(apiError.status, apiError.body);
      return;
    }
    await notFoundPage(ctx);
  }
};

const start = async (): Promise<void> => {
  await waitForDatabase();
  await applySchema();
  await seedDemoData();
  try {
    await ensureBucket();
  } catch {
    process.stderr.write('storage unavailable at boot\n');
  }
  void runServiceChecks();
  startBackgroundWork();
  createServer((request, response) => void handle(request, response)).listen(env.port, '0.0.0.0', () => {
    process.stdout.write(`pinsheet listening on ${env.port}\n`);
  });
};

void start();
