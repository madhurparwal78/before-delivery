import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import { readConfig, Storage, Mailer, KillBill, type Config } from './providers.js';
import { createPool, type Db } from './db.js';
import { ApiError, NOT_FOUND_BODY, errorBody } from '../domain/errors.js';
import { buildApp, loadSession, type AppState, setSessionCookie, clearSessionCookie } from './app.js';
import { registerAuthRoutes } from './routes-auth.js';
import { registerDropRoutes } from './routes-drops.js';
import { registerPublicRoutes, clientIpOf } from './routes-public.js';
import { registerAllocationRoutes } from './routes-allocations.js';
import { registerStockistRoutes } from './routes-stockists.js';
import { registerContentRoutes } from './routes-content.js';
import { registerMultipartRoutes } from './routes-multipart.js';
import { runSweep } from './sweep.js';
import { applySchema } from './startup.js';
import { seed } from './seed.js';
import { isCrossOriginWrite } from './http.js';
import { drawLook } from './images.js';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.map': 'application/json'
};

async function boot(): Promise<void> {
  const cfg = readConfig(process.env);
  const db = createPool(cfg.databaseUrl);
  // When Postgres is unreachable at boot, keep retrying and do not answer health
  // until it connects.
  for (;;) {
    try { await db.query('SELECT 1'); break; } catch { await new Promise(r => setTimeout(r, 1000)); }
  }
  await applySchema(db);
  await seed(db);

  const state: AppState = {
    cfg, db,
    storage: new Storage(cfg.s3),
    mailer: new Mailer(cfg, cfg.mailFrom),
    killbill: new KillBill(cfg.killbill),
    sessions: new Map()
  };

  const app: FastifyInstance = buildApp(state);
  app.log.level = process.env.NODE_ENV === 'production' ? 'warn' : 'info';
  await app.register(multipart, { attachFieldsToBody: false, limits: { fileSize: 8100000, files: 2, fields: 10 } });

  app.setNotFoundHandler(async (req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.split('?')[0];
    if (path.startsWith('/api/') || path === '/sitemap.xml') {
      reply.code(404).header('content-type', 'application/json').send(NOT_FOUND_BODY);
      return;
    }
    await serveIndex(reply);
  });

  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.url.startsWith('/api/') || req.url === '/sitemap.xml') {
      // Ladder step 2: cross-origin writes.
      const write = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
      if (write && isCrossOriginWrite(cfg, req)) throw new ApiError('cross_origin');
    }
  });

  app.addHook('onSend', async (req: FastifyRequest, reply: FastifyReply, payload: unknown) => {
    void req;
    void reply;
    return payload;
  });

  app.get('/api/health', async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.code(200).header('content-type', 'application/json').send({ status: 'ok' });
  });

  app.get('/sitemap.xml', async (_req: FastifyRequest, reply: FastifyReply) => {
    const res = await db.query("SELECT slug FROM drops WHERE status IN ('scheduled', 'live', 'sold_out')");
    const urls = ['', ...res.rows.map((r: { slug: string }) => `/drops/${r.slug}`)]
      .map(u => `  <url><loc>${cfg.appPublicUrl}${u}</loc></url>`).join('\n');
    reply.code(200).header('content-type', 'application/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
    );
  });

  registerAuthRoutes(app);
  registerDropRoutes(app);
  registerPublicRoutes(app);
  registerAllocationRoutes(app);
  registerStockistRoutes(app);
  registerContentRoutes(app);
  registerMultipartRoutes(app);

  // Error shapes: every API error leaves through one shape.
  app.setErrorHandler(async (err: unknown, req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.split('?')[0];
    if (!(path.startsWith('/api/') || path === '/sitemap.xml')) {
      if (err instanceof ApiError && err.status === 429) {
        reply.header('retry-after', String(err.retryAfterSeconds ?? 1));
      }
      await serveIndex(reply);
      return;
    }
    if (err instanceof ApiError) {
      const body = errorBody(err);
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (err.retryAfterSeconds !== undefined) headers['retry-after'] = String(err.retryAfterSeconds);
      reply.code(err.status).headers(headers).send(body);
      return;
    }
    const anyErr = err as { statusCode?: number; code?: string; message?: string };
    if (anyErr?.statusCode === 415 || anyErr?.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || anyErr?.code === 'FST_ERR_CTP_EMPTY_JSON_BODY') {
      reply.code(415).header('content-type', 'application/json')
        .send({ error: { code: 'unsupported_media_type', message: 'Unsupported media type.' } });
      return;
    }
    if (anyErr?.statusCode === 413 || anyErr?.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || anyErr?.code === 'FST_ERR_FILES_TOO_LARGE') {
      reply.code(413).header('content-type', 'application/json')
        .send({ error: { code: 'too_large', message: 'Too large.' } });
      return;
    }
    reply.code(503).header('content-type', 'application/json').send({ error: { code: 'unreachable', message: "Hourline can't be reached. Nothing was saved. Check your connection and try again." } });
  });

  // Method not allowed: for listed paths, other methods answer 405 with Allow.
  const listed = new Set([
    '/', '/api/auth/sign-in', '/api/auth/sign-out', '/api/auth/session',
    '/api/auth/password-reset', '/api/auth/password-reset/complete', '/api/auth/invitations/accept',
    '/api/members', '/api/members/invitations', '/api/public/drops', '/api/public/waitlist/confirm',
    '/api/drops', '/api/drops/checks', '/api/price-lists', '/api/stockists', '/api/stockists.csv',
    '/api/allocations'
  ]);
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.split('?')[0];
    if (path.startsWith('/api/') && !listed.has(path) &&
      !parametric405Paths.some(([p]) => matchParametric(p, path))) return;
    const allowed = allowedMethodsFor(path);
    if (!allowed.includes(req.method)) {
      reply.code(405).header('allow', allowed.join(', ')).header('content-type', 'application/json')
        .send({ error: { code: 'method_not_allowed', message: 'Method not allowed.' } });
    }
  });

  // Static assets and screens.
  app.get('/assets/*', async (req: FastifyRequest, reply: FastifyReply) => {
    const rel = req.url.split('?')[0].slice('/assets/'.length);
    if (rel.includes('..')) { reply.code(404).send(); return; }
    const file = join('public', 'assets', rel);
    if (!existsSync(file)) { reply.code(404).send(); return; }
    reply.code(200).header('content-type', MIME[extname(file)] ?? 'application/octet-stream').send(readFileSync(file));
  });

  await app.listen({ port: cfg.port, host: '0.0.0.0' });

  // Image seeding retries at each sweep until it succeeds.
  void seedLookImages(state).catch(() => undefined);
  const sweepTimer = setInterval(() => { void runSweep(state); }, 2000);
  const imageTimer = setInterval(() => { void seedLookImages(state).catch(() => undefined); }, 30000);
  sweepTimer.unref?.();
  imageTimer.unref?.();
}

function allowedMethodsFor(path: string): string[] {
  const exact: Record<string, string[]> = {
    '/': ['GET', 'HEAD'],
    '/api/health': ['GET'],
    '/api/auth/sign-in': ['POST'],
    '/api/auth/sign-out': ['POST'],
    '/api/auth/session': ['GET'],
    '/api/auth/password-reset': ['POST'],
    '/api/auth/password-reset/complete': ['POST'],
    '/api/auth/invitations/accept': ['POST'],
    '/api/members': ['GET'],
    '/api/members/invitations': ['POST'],
    '/api/public/drops': ['GET'],
    '/api/public/waitlist/confirm': ['POST'],
    '/api/drops': ['GET', 'POST'],
    '/api/drops/checks': ['POST'],
    '/api/price-lists': ['GET', 'POST'],
    '/api/stockists': ['GET', 'POST'],
    '/api/stockists.csv': ['GET'],
    '/api/allocations': ['GET', 'POST']
  };
  for (const [pattern, methods] of parametric405Paths) {
    if (matchParametric(pattern, path)) return methods;
  }
  return exact[path] ?? ['GET'];
}

const parametric405Paths: [RegExp, string[]][] = [
  [/^\/api\/drops\/[^/]+\/line-sheet\/import$/, ['POST']],
  [/^\/api\/press\/[^/]+$/, ['GET']],
  [/^\/api\/press\/[^/]+\/zip$/, ['GET']],
  [/^\/api\/press\/[^/]+\/looks\/[^/]+\/image$/, ['GET']]
];

function matchParametric(pattern: RegExp, path: string): boolean {
  return pattern.test(path);
}

async function serveIndex(reply: FastifyReply): Promise<void> {
  const file = 'public/index.html';
  if (!existsSync(file)) { reply.code(500).send('missing build'); return; }
  reply.code(200).header('content-type', 'text/html; charset=utf-8').send(readFileSync(file));
}

// Seed look images: drawn by the app's own code and stored in MinIO, retried
// while it is down.
async function seedLookImages(state: AppState): Promise<void> {
  const looks = await state.db.query(
    'SELECT l.*, d.palette FROM looks l JOIN drops d ON d.id = l.drop_id WHERE l.size_bytes = 0'
  );
  if (looks.rows.length === 0) return;
  await state.db.query('SELECT pg_advisory_lock(902300)');
  try {
    for (const look of looks.rows) {
      const palette = Array.isArray(look.palette)
        ? look.palette as string[]
        : String(look.palette).replace(/^\[|\]$/g, '').split(',').map(s => s.trim());
      const png = await drawLook((look.position + look.drop_id.length) % 14, palette);
      await state.storage.put(`looks/${look.drop_id}/${look.id}.png`, png, 'image/png');
      await state.db.query('UPDATE looks SET size_bytes = $1 WHERE id = $2', [png.length, look.id]);
    }
  } finally {
    await state.db.query('SELECT pg_advisory_unlock(902300)');
  }
}


boot().catch(err => {
  console.error('boot failed', err);
  process.exit(1);
});
