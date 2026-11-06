import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escalateAlerts, evaluateLinkStates } from './alerts.js';
import { config } from './config.js';
import { applySchemaAndSeed, pool } from './db.js';
import { parseScreen } from './domain/landing.js';
import { ApiError, internal, notFound, unauthenticated } from './errors.js';
import {
  ClientGone,
  cookies,
  dispatch,
  Router,
  sendApiError,
  SESSION_COOKIE,
  type Ctx,
} from './http.js';
import { moveInfillOffLostVessels } from './infillMoves.js';
import { flushOutbox } from './outbox.js';
import { startProbes } from './probes.js';
import { writePendingReports } from './report.js';
import { findUserById } from './repo.js';
import { registerAlertRoutes } from './routes/alerts.js';
import { registerCoverageRoutes } from './routes/coverage.js';
import { registerFlagRoutes } from './routes/flags.js';
import { registerIngestRoutes } from './routes/ingest.js';
import { registerLineRoutes } from './routes/lines.js';
import { registerMissionOpsRoutes } from './routes/missionOps.js';
import { registerMissionRoutes } from './routes/missions.js';
import { registerSessionRoutes } from './routes/session.js';
import { registerVesselRoutes } from './routes/vessels.js';

const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

const router = new Router();
registerSessionRoutes(router);
registerVesselRoutes(router);
registerIngestRoutes(router);
registerMissionRoutes(router);
registerCoverageRoutes(router);
registerMissionOpsRoutes(router);
registerLineRoutes(router);
registerAlertRoutes(router);
registerFlagRoutes(router);

const authenticator = {
  /** Each session is a revocable record; a revoked or expired cookie answers 401. */
  async session(ctx: Ctx): Promise<void> {
    const id = cookies(ctx.req)[SESSION_COOKIE];
    if (!id) throw unauthenticated();
    const result = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM sessions
       WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw unauthenticated();
    const user = await findUserById(pool, row.user_id);
    if (!user) throw unauthenticated();
    ctx.user = user;
    ctx.sessionId = id;
  },
  /** Ingest takes no session; the logger's key alone identifies its vessel. */
  async ingest(): Promise<void> {
    // The key is read by the ingest handlers, which answer 401 invalid_ingest_key.
  },
};

async function serveStatic(pathname: string, res: ServerResponse): Promise<boolean> {
  const relative = normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^\/+/, '');
  const target = resolve(PUBLIC_DIR, relative);
  if (!target.startsWith(PUBLIC_DIR)) return false;
  try {
    const info = await stat(target);
    if (!info.isFile()) return false;
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(target)] ?? 'application/octet-stream',
      'content-length': String(info.size),
      'cache-control': extname(target) === '.woff2' ? 'public, max-age=31536000' : 'no-cache',
    });
    createReadStream(target).pipe(res);
    return true;
  } catch {
    return false;
  }
}

async function serveApp(res: ServerResponse): Promise<void> {
  const index = resolve(PUBLIC_DIR, 'index.html');
  const info = await stat(index);
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': String(info.size),
    'cache-control': 'no-cache',
  });
  createReadStream(index).pipe(res);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/api' || pathname.startsWith('/api/')) {
    await dispatch(router, authenticator, req, res, pathname, url.searchParams);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') throw notFound();

  if (pathname !== '/' && (await serveStatic(pathname, res))) return;

  // Screen addresses render the app; anything else outside the build answers 404.
  if (pathname === '/' || pathname === '/sign-in' || parseScreen(pathname) !== null) {
    await serveApp(res);
    return;
  }
  if (extname(pathname) !== '') throw notFound();
  await serveApp(res);
}

const server = createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    if (error instanceof ClientGone || res.writableEnded || res.headersSent) {
      if (!res.writableEnded && res.headersSent) res.end();
      return;
    }
    if (error instanceof ApiError) {
      sendApiError(res, error);
      return;
    }
    console.error('unexpected request failure', error);
    sendApiError(res, internal());
  });
});

server.headersTimeout = 60_000;
server.requestTimeout = 120_000;

function startTimers(): void {
  const every = (ms: number, run: () => Promise<void>): void => {
    setInterval(() => {
      void run().catch(() => undefined);
    }, ms).unref();
  };
  every(2000, async () => {
    const now = new Date();
    await evaluateLinkStates(pool, now);
    await moveInfillOffLostVessels(now);
  });
  every(5000, async () => {
    await escalateAlerts(pool, new Date());
  });
  every(5000, flushOutbox);
  every(10_000, writePendingReports);
  every(3_600_000, async () => {
    await pool.query(`DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours'`);
  });
}

async function main(): Promise<void> {
  await applySchemaAndSeed();
  startProbes();
  startTimers();
  server.listen(config.port, '0.0.0.0');
}

void main();
