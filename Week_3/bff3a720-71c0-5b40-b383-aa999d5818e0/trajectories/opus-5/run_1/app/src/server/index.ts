import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { applySchema, databaseReachable, db, waitForDatabase } from './db.js';
import { loadClockOffset } from './clock.js';
import { valkeyReachable, waitForValkey } from './valkey.js';
import { ensureBucket, storageReachable } from './storage.js';
import { mailReachable } from './mail.js';
import { ApiError, errors } from './errors.js';
import {
  Ctx,
  Router,
  assertContentType,
  maxBytesFor,
  readBody,
  type MemberRow,
  type Reply,
} from './http.js';
import { isPagePath, shell } from './pages.js';
import { seedIfEmpty } from './seed.js';
import { startJobLoop } from './jobs.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerMemberRoutes } from './routes/members.js';
import { registerRideRoutes } from './routes/rides.js';
import { registerBookingRoutes } from './routes/bookings.js';
import { registerMessageRoutes } from './routes/messages.js';
import { registerRatingRoutes } from './routes/ratings.js';
import { registerWalletRoutes } from './routes/wallet.js';
import { registerEarningsRoutes } from './routes/earnings.js';
import { registerFileRoutes } from './routes/files.js';
import { registerFounderRoutes } from './routes/founder.js';
import { registerLiveRoute } from './routes/live.js';
import { registerGradingRoutes } from './routes/grading.js';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, 'public');

const router = new Router();
registerAuthRoutes(router);
registerMemberRoutes(router);
registerRideRoutes(router);
registerBookingRoutes(router);
registerMessageRoutes(router);
registerRatingRoutes(router);
registerWalletRoutes(router);
registerEarningsRoutes(router);
registerFileRoutes(router);
registerFounderRoutes(router);
registerLiveRoute(router);
registerGradingRoutes(router);

const ASSETS: Record<string, string> = {
  '/app.js': 'text/javascript; charset=utf-8',
  '/styles.css': 'text/css; charset=utf-8',
};

async function sessionMember(ctx: Ctx): Promise<MemberRow | null> {
  const token = ctx.cookie('ls_session');
  if (!token) return null;
  const { rows } = await db.query<MemberRow>(
    `select m.id, m.display_name, m.email, m.roles, m.id_state, m.photo_file_id
       from sessions s join members m on m.id = s.member_id where s.token = $1`,
    [token],
  );
  return rows[0] ?? null;
}

function sendJson(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { ...(reply.headers ?? {}) };
  if (reply.noContent) {
    res.writeHead(reply.status, headers);
    res.end();
    return;
  }
  if (reply.raw) {
    headers['Content-Type'] = reply.contentType ?? 'application/octet-stream';
    headers['Content-Length'] = String(reply.raw.byteLength);
    res.writeHead(reply.status, headers);
    res.end(reply.raw);
    return;
  }
  const payload = Buffer.from(JSON.stringify(reply.body ?? null), 'utf8');
  headers['Content-Type'] = 'application/json; charset=utf-8';
  headers['Content-Length'] = String(payload.byteLength);
  res.writeHead(reply.status, headers);
  res.end(payload);
}

function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof ApiError) {
    sendJson(res, { status: error.status, body: error.body(), headers: error.headers });
    return;
  }
  process.stderr.write(`Unhandled request failure: ${String(error)}\n`);
  sendJson(res, {
    status: 500,
    body: { error: 'not_found', message: 'We could not find that.' },
  });
}

/** Same origin only: a cross-origin state-changing request is refused. */
function crossOrigin(ctx: Ctx): boolean {
  if (ctx.method === 'GET' || ctx.method === 'HEAD') return false;
  const origin = ctx.header('origin');
  if (!origin) return false;
  const host = ctx.header('host');
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

async function handleApi(ctx: Ctx, pathname: string): Promise<void> {
  const matched = router.match(ctx.method, pathname);
  if (!matched) throw errors.notFound();
  const { route } = matched;
  ctx.params = matched.params;

  // 1. body size and content type
  await readBody(ctx, maxBytesFor(route.kind));
  assertContentType(ctx, route.kind);
  if (crossOrigin(ctx)) throw errors.forbidden();

  // 2. authentication
  ctx.member = await sessionMember(ctx);
  if (route.auth === 'member' && !ctx.member) throw errors.unauthenticated();

  const reply = await route.handler(ctx);
  if (reply.handled) return;
  sendJson(ctx.res, reply);
}

async function serveAsset(res: ServerResponse, pathname: string): Promise<boolean> {
  const contentType = ASSETS[pathname];
  if (!contentType) return false;
  const bytes = await readFile(join(publicDir, pathname.slice(1))).catch(() => null);
  if (!bytes) return false;
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': String(bytes.byteLength),
    'Cache-Control': 'no-cache',
  });
  res.end(bytes);
  return true;
}

async function health(res: ServerResponse): Promise<void> {
  const [database, valkey, storage, mail] = await Promise.all([
    databaseReachable(),
    valkeyReachable(),
    storageReachable(),
    mailReachable(),
  ]);
  const status = database && valkey && storage && mail ? 'ok' : 'unavailable';
  const payload = Buffer.from(JSON.stringify({ status }), 'utf8');
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(payload.byteLength),
  });
  res.end(payload);
}

function sendPage(res: ServerResponse, status: number): void {
  const body = Buffer.from(shell(), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': String(body.byteLength),
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;

  if (pathname === '/health') {
    await health(res);
    return;
  }
  if (pathname.startsWith('/api/')) {
    const ctx = new Ctx(req, res, url, {});
    try {
      await handleApi(ctx, pathname);
    } catch (error) {
      if (!res.headersSent) sendError(res, error);
      else res.end();
    }
    return;
  }
  if (await serveAsset(res, pathname)) return;
  sendPage(res, isPagePath(pathname) ? 200 : 404);
}

async function main(): Promise<void> {
  await waitForDatabase();
  await waitForValkey();
  await applySchema();
  await loadClockOffset();
  await ensureBucket();
  await seedIfEmpty();
  startJobLoop();

  const server = createServer((req, res) => {
    void handle(req, res).catch((error) => {
      process.stderr.write(`Request crashed: ${String(error)}\n`);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`Longseat is listening on 0.0.0.0:${config.port}\n`);
  });
}

main().catch((error) => {
  process.stderr.write(`Longseat could not start: ${String(error)}\n`);
  process.exit(1);
});
