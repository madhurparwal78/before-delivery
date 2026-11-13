import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { applySchema, pingStore, query } from './db.js';
import { ApiError } from './errors.js';
import { addClient, heartbeat, onPresenceChange, publish, removeClient } from './events.js';
import { Router, checkSameOrigin, parseCookies, parseJsonBody, readBody, sendJson, type Ctx } from './http.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerClubRoutes } from './routes/clubs.js';
import { registerGradingRoutes } from './routes/grading.js';
import { registerMeRoutes } from './routes/me.js';
import { pairTickets, registerPlayRoutes } from './routes/play.js';
import { registerShopRoutes } from './routes/shop.js';
import { friendIdsOf, registerSocialRoutes } from './routes/social.js';
import { advanceTournaments, registerTournamentRoutes } from './routes/tournaments.js';
import { applySeed } from './seed.js';
import { currentSession } from './session.js';
import { killbillReachable } from './services/killbill.js';
import { mailReachable, retryOutbox } from './services/mail.js';
import { tick } from './tables.js';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, 'public');

const router = new Router();
registerAuthRoutes(router);
registerMeRoutes(router);
registerPlayRoutes(router);
registerShopRoutes(router);
registerSocialRoutes(router);
registerClubRoutes(router);
registerTournamentRoutes(router);
registerGradingRoutes(router);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

interface Health {
  status: 'ok' | 'unavailable';
  at: number;
}

let health: Health | null = null;
let healthRunning = false;

async function refreshHealth(): Promise<Health> {
  const [store, payments, mail] = await Promise.all([pingStore(), killbillReachable(), mailReachable()]);
  health = { status: store && payments && mail ? 'ok' : 'unavailable', at: Date.now() };
  return health;
}

async function healthBody(): Promise<{ status: string }> {
  if (!health) return { status: (await refreshHealth()).status };
  if (Date.now() - health.at > 5000 && !healthRunning) {
    healthRunning = true;
    void refreshHealth().finally(() => {
      healthRunning = false;
    });
  }
  return { status: health.status };
}

async function serveStatic(res: ServerResponse, pathname: string): Promise<boolean> {
  const relative = normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^\/+/, '');
  if (relative.includes('..')) return false;
  const file = join(publicDir, relative);
  if (!file.startsWith(publicDir)) return false;
  try {
    const info = await stat(file);
    if (!info.isFile()) return false;
    const type = MIME[extname(file)] ?? 'application/octet-stream';
    res.writeHead(200, {
      'content-type': type,
      'content-length': info.size,
      'cache-control': extname(file) === '.html' ? 'no-store' : 'no-cache',
    });
    createReadStream(file).pipe(res);
    return true;
  } catch {
    return false;
  }
}

/** Anything that names a file, or a source directory, is never answered with the shell. */
function looksLikeFile(pathname: string): boolean {
  const last = pathname.split('/').pop() ?? '';
  if (last.includes('.')) return true;
  return ['/src', '/node_modules', '/dist', '/scripts', '/.git'].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

async function serveShell(res: ServerResponse): Promise<void> {
  const served = await serveStatic(res, 'index.html');
  if (!served) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>Long Rail Headstring</title>');
  }
}

async function handleEvents(ctx: Ctx): Promise<void> {
  const session = await currentSession(ctx).catch(() => null);
  const requested = (ctx.url.searchParams.get('topics') ?? '').split(',').map((topic) => topic.trim()).filter(Boolean);
  const topics = requested.filter((topic) => !topic.startsWith('player:') || topic === `player:${session?.player.id}`);
  const client = addClient(ctx.res, topics, session?.player.id ?? null, session?.sessionId ?? null);
  ctx.req.on('close', () => removeClient(client));
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  void handle(req, res);
});

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const host = req.headers.host ?? `127.0.0.1:${config.port}`;
  const url = new URL(req.url ?? '/', `http://${host}`);
  const ctx: Ctx = {
    req,
    res,
    url,
    method: req.method ?? 'GET',
    params: {},
    body: undefined,
    rawBodyPresent: false,
    cookies: parseCookies(req.headers.cookie),
    origin: `http://${host}`,
  };

  try {
    if (url.pathname === '/api/health') {
      sendJson(res, 200, await healthBody());
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      const raw = await readBody(req);
      ctx.rawBodyPresent = raw.length > 0;
      ctx.body = parseJsonBody(raw, req.headers['content-type']);
      checkSameOrigin(ctx);

      if (url.pathname === '/api/events' && ctx.method === 'GET') {
        await handleEvents(ctx);
        return;
      }

      const matched = router.match(ctx.method, url.pathname);
      if (!matched) throw ApiError.notFound();
      ctx.params = matched.params;
      const reply = await matched.handler(ctx);
      if (!reply) return;
      if (reply.status === 204) {
        res.writeHead(204, reply.headers ?? {});
        res.end();
        return;
      }
      sendJson(res, reply.status, reply.body, reply.headers ?? {});
      return;
    }

    if (ctx.method !== 'GET' && ctx.method !== 'HEAD') {
      sendJson(res, 404, { error: 'not_found', message: 'Not found.' });
      return;
    }

    if (url.pathname !== '/' && (await serveStatic(res, url.pathname))) return;
    if (looksLikeFile(url.pathname)) {
      sendJson(res, 404, { error: 'not_found', message: 'Not found.' });
      return;
    }
    await serveShell(res);
  } catch (error) {
    if (error instanceof ApiError) {
      sendJson(res, error.status, error.body(), error.headers ?? {});
      return;
    }
    sendJson(res, 500, { error: 'server_error', message: 'Something went wrong at the table.' });
  }
}

onPresenceChange((playerId) => {
  void (async () => {
    const friends = await friendIdsOf(playerId).catch(() => []);
    for (const friendId of friends) publish(`player:${friendId}`, 'friends', { changed: true });
  })();
});

async function bootstrap(): Promise<void> {
  try {
    await applySchema();
    await applySeed();
  } catch {
    setTimeout(() => void bootstrap(), 10000);
  }
}

server.listen(config.port, '0.0.0.0', () => {
  void bootstrap();
  void refreshHealth();
});

setInterval(() => void pairTickets().catch(() => undefined), 500);
setInterval(() => void tick().catch(() => undefined), 1000);
setInterval(() => void advanceTournaments().catch(() => undefined), 1000);
setInterval(() => void retryOutbox().catch(() => undefined), 30000);
setInterval(() => heartbeat(), 15000);
setInterval(() => void query(`DELETE FROM signin_failures WHERE created_at < now() - interval '10 minutes'`).catch(() => undefined), 60000);
