import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { config } from './config.js';
import { migrate } from './migrate.js';
import api from './api.js';
import { healthBody, sameOriginGuard, sizeLimit } from './http.js';
import { loadUser } from './auth.js';
import { ApiError, dbUnavailable, tooLarge } from './errors.js';
import { dbUp, pool } from './db.js';
import { checkValkey } from './valkey.js';
import { checkMinio, ensureBucket } from './minio.js';
import { checkMail } from './mail.js';
import { startMailQueue } from './mailer-queue.js';
import { settleSession } from './session-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.disable('x-powered-by');
app.use(cookieParser());
app.use(sameOriginGuard);

/* Health: always 200, with each service's state from its one availability source. */
app.get('/api/health', async (_req, res) => {
  const body = await healthBody();
  res.status(200).json(body);
});

/* API under /api, with the one body-size limit and precedence order. */
app.use('/api', sizeLimit(config.limits.multipart), (req: Request, res: Response, next: NextFunction) => {
  // JSON bodies except the multipart upload, downloads and empty bodies.
  const isMultipart = (req.headers['content-type'] ?? '').startsWith('multipart/form-data');
  const hasBody = (Number(req.headers['content-length'] ?? 0) > 0) || req.headers['transfer-encoding'] === 'chunked';
  if (!isMultipart && hasBody && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
    express.json({ limit: config.limits.json, strict: false })(req, res, (err?: unknown) => {
      if (err && (err as { status?: number; type?: string }).type === 'entity.too.large') {
        next(tooLarge());
        return;
      }
      if (err) { next(err); return; }
      next();
    });
    return;
  }
  next();
});

app.use('/api', async (req: Request, _res: Response, next: NextFunction) => {
  if (req.path === '/health') { next(); return; }
  if (await dbUp()) { next(); return; }
  next(dbUnavailable());
});

app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    try {
      // capability-token paths skip the cookie auth
      if (req.path.startsWith('/pack/') || req.path.startsWith('/play/')) {
        await api(req as never, res as never, next);
        return;
      }
      await loadUser(req, res, async () => {
        await api(req as never, res as never, next);
      });
    } catch (e) {
      next(e);
    }
  })();
});

// The one error shape.
app.use('/api', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) { err.send(res); return; }
  if (err instanceof SyntaxError) {
    res.status(400).json({ error: 'invalid_json' });
    return;
  }
  console.error('unhandled:', err);
  res.status(500).json({ error: 'internal' });
});

/* Static frontend. Only the built assets. */
const distDir = path.join(__dirname, '..', 'dist');
app.use(express.static(distDir, { index: false, fallthrough: true }));
const INDEX = fs.existsSync(path.join(distDir, 'index.html')) ? fs.readFileSync(path.join(distDir, 'index.html'), 'utf8') : '';

const sendIndex = (_req: Request, res: Response): void => {
  res.status(200).type('html').end(INDEX);
};
app.get('/', sendIndex);
app.get('/signin', sendIndex);
app.get('/app', sendIndex);
app.get('/app/rooms/:roomId', sendIndex);
app.get('/play/:token', sendIndex);
app.get('/pack/:token', sendIndex);

// Unknown paths answer 404 (the app shows the not-found copy at known routes).
app.use((_req: Request, res: Response) => {
  res.status(404).type('html').end(`<!doctype html><html><head><meta charset="utf-8"><title>Not found</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>`);
});

const port = config.port;
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`[${config.instance}] keyway-bench on :${port}`);
});

/* Boot without dependencies; retry each missing service every 5 seconds. */
async function boot(): Promise<void> {
  try { await migrate(); } catch (e) { console.error('migrate failed (retrying):', (e as Error).message); }
  try { await ensureBucket(); } catch { /* retried below */ }
  startMailQueue();
  setInterval(async () => {
    try { await migrate(); } catch { /* idempotent */ }
    await checkValkey();
    await checkMinio();
    await checkMail();
  }, 5_000).unref();

  // The playtest deadline: end any session whose time has run out (DP-29).
  setInterval(async () => {
    try {
      const r = await pool.query(
        `SELECT id FROM sessions WHERE state = 'running' AND started_at IS NOT NULL
           AND started_at + (duration_seconds || ' seconds')::interval <= now()`
      );
      for (const row of r.rows) await settleSession(row.id as string);
    } catch { /* retried next tick */ }
  }, 5_000).unref();
}

void boot();

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
