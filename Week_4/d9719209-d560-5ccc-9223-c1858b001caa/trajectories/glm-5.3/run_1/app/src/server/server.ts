/* The Moothall app server: one origin serving the API, the pages, the media
   and the live stream. Postgres is the source of truth; storage holds images;
   Valkey carries live fan-out and the rate counters; Mailpit receives mail. */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, makeMailTransport, makeStorage, type AppConfig } from '../config.js';
import { json, errorJson, ApiError, notFound } from './errors.js';
import { SCHEMA_SQL } from './schema.js';
import { Valkey } from './valkey.js';
import { Mailer } from './mail.js';
import { parseCookies, cookieHeader, checkOrigin, type Ctx, type Account } from './context.js';
import pg from 'pg';
import { S3Client } from '@aws-sdk/client-s3';
import { applySchemaAndSeed, type Db } from './db.js';
import { registerRoutes, type RouteTable } from './routes.js';
import { PageRenderer } from './pages.js';

type Boot = {
  cfg: AppConfig;
  db: Db;
  valkey: Valkey;
  mailer: Mailer;
  storage: S3Client;
  routes: RouteTable;
  pages: PageRenderer;
  state: { pgUp: boolean; storageUp: boolean; valkeyUp: boolean };
};

const JSON_BODY_LIMIT = 100_000;

async function main(): Promise<void> {
  const cfg = loadConfig();
  const db = new pg.Client({ connectionString: cfg.databaseUrl }) as unknown as Db;
  const valkey = new Valkey(cfg.valkeyUrl, cfg.valkeyKeyPrefix);
  const mailer = new Mailer(cfg, makeMailTransport(cfg));
  const storage = makeStorage(cfg);
  const state = { pgUp: false, storageUp: false, valkeyUp: false };

  const boot: Boot = { cfg, db, valkey, mailer, storage, state, routes: { list: [] }, pages: null as unknown as PageRenderer };
  boot.routes = registerRoutes(boot as Services);
  boot.pages = new PageRenderer();

  const server = http.createServer((req, res) => {
    void handle(boot, req, res);
  });
  server.listen(cfg.port, '0.0.0.0', () => {
    console.log(`moothall listening on 0.0.0.0:${cfg.port}`);
  });
  startLockSweeper(boot);
  void startup(boot);
}

export type Services = Boot;

async function startup(boot: Boot): Promise<void> {
  // Schema, seed and the bucket are applied idempotently before serving, and
  // Postgres being down only marks health unavailable, never stops the listen.
  const tryDb = async (): Promise<void> => {
    try {
      await boot.db.connect();
      await applySchemaAndSeed(boot.db, boot.cfg);
      boot.state.pgUp = true;
    } catch {
      boot.state.pgUp = false;
      setTimeout(() => void tryDb(), 2000);
    }
  };
  await tryDb();
  try {
    await boot.valkey.connect();
    boot.state.valkeyUp = true;
  } catch {
    boot.state.valkeyUp = false;
  }
  try {
    await ensureBucket(boot);
    boot.state.storageUp = true;
  } catch {
    boot.state.storageUp = false;
  }
}

async function ensureBucket(boot: Boot): Promise<void> {
  const { CreateBucketCommand, HeadBucketCommand } = await import('@aws-sdk/client-s3');
  try {
    await boot.storage.send(new HeadBucketCommand({ Bucket: boot.cfg.s3.bucket }));
  } catch {
    await boot.storage.send(new CreateBucketCommand({ Bucket: boot.cfg.s3.bucket }));
  }
}

async function handle(boot: Boot, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const method = (req.method ?? 'GET').toUpperCase();
  const setCookies: string[] = [];
  const ctx: Ctx = {
    req,
    res,
    method,
    path: decodeURIComponent(url.pathname),
    url,
    params: {},
    cookies: parseCookies(req.headers.cookie),
    sessionToken: null,
    account: null,
    body: null,
    rawBody: null,
    isGrading: false,
    setCookie: (v: string) => setCookies.push(v),
    status: 200,
  };
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (boot.state.pgUp === false) throw new ApiError('SERVICE_UNAVAILABLE', 'Service starting');
    if (method === 'OPTIONS') {
      res.writeHead(204, { Allow: 'GET,POST,PUT,PATCH,DELETE,OPTIONS' });
      res.end();
      return;
    }
    const session = ctx.cookies['mh_session'] ?? null;
    if (session !== null) {
      ctx.sessionToken = session;
      try {
        ctx.account = await resolveAccount(boot, session);
      } catch (err) {
        if (err instanceof ApiError && err.code === 'SUSPENDED') {
          // API calls answer 403 SUSPENDED; a page clears the stale cookie so
          // the tab shows the signed-out state.
          if (ctx.path.startsWith('/api/')) throw err;
          res.setHeader('Set-Cookie', 'mh_session=; Path=/; Max-Age=0; SameSite=Lax');
        }
        ctx.account = null;
      }
    }
    if (ctx.path.startsWith('/api/')) {
      await handleApi(boot, ctx, setCookies);
    } else if (ctx.path.startsWith('/media/')) {
      await handleMedia(boot, ctx);
    } else {
      await handlePage(boot, ctx);
    }
  } catch (err) {
    const apiErr = err instanceof ApiError ? err : new ApiError('SERVICE_UNAVAILABLE', 'Service unavailable');
    if (!(err instanceof ApiError)) console.error('internal error:', err);
    if (!res.headersSent) {
      if (ctx.path.startsWith('/api/')) {
        for (const c of setCookies) res.setHeader('Set-Cookie', c);
        errorJson(res, apiErr);
      } else {
        res.writeHead(apiErr.status, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><html><body><h1>Error</h1></body></html>`);
      }
    } else {
      res.end();
    }
  }
}

async function handleApi(boot: Boot, ctx: Ctx, setCookies: string[]): Promise<void> {
  const grading = boot.cfg.gradingKey;
  const gradingPath = ctx.path.startsWith('/api/grading/');
  if (gradingPath) {
    const key = ctx.req.headers['x-grading-key'];
    if (grading === null || key !== grading) {
      json(ctx.res, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
      return;
    }
    ctx.isGrading = true;
  }
  checkOrigin(ctx, boot.cfg.publicUrl);
  let handler: { run: (ctx: Ctx) => Promise<{ status: number; body: unknown } | undefined>; wantsBody: 'json' | 'multipart' | 'none' | 'stream' } | null = null;
  for (const r of boot.routes.list) {
    const m = r.pattern.exec(ctx.path);
    if (m === null) continue;
    if (r.method !== ctx.method) continue;
    for (const [name, groupIndex] of Object.entries(r.paramNames)) {
      ctx.params[name] = decodeURIComponent(m[groupIndex + 1] as string);
    }
    handler = { run: r.run, wantsBody: r.wantsBody };
    break;
  }
  if (handler === null) throw notFound();
  if (ctx.account !== null && ctx.account.suspended) throw new ApiError('SUSPENDED', 'This account is suspended');
  await readBody(boot, ctx, handler.wantsBody);
  const result = await handler.run(ctx);
  if (result === undefined) return; // the handler wrote the response itself
  for (const c of setCookies) ctx.res.setHeader('Set-Cookie', c);
  json(ctx.res, result.status, result.body);
}

async function readBody(boot: Boot, ctx: Ctx, wantsBody: 'json' | 'multipart' | 'none' | 'stream'): Promise<void> {
  if (wantsBody === 'none') return;
  if (wantsBody === 'stream') return;
  const chunks: Buffer[] = [];
  let size = 0;
  let tooBig = false;
  const limit = wantsBody === 'json' ? JSON_BODY_LIMIT : boot.cfg.limits.maxImageBytes + 100_000;
  await new Promise<void>((resolve) => {
    ctx.req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        tooBig = true;
        // Drain the rest so the client sees a complete response, then answer.
        ctx.req.removeAllListeners('data');
        return;
      }
      chunks.push(chunk);
    });
    ctx.req.on('end', () => resolve());
    ctx.req.on('error', () => resolve());
  });
  if (tooBig) {
    throw new ApiError('VALIDATION', wantsBody === 'multipart' ? 'This image is too large' : 'Body too large', {
      fields: wantsBody === 'multipart' ? { file: 'This image is too large' } : {},
      status: 413,
    });
  }
  const raw = Buffer.concat(chunks);
  ctx.rawBody = raw;
  if (wantsBody === 'multipart') {
    const ct = ctx.req.headers['content-type'] ?? '';
    if (!ct.startsWith('multipart/form-data')) {
      throw new ApiError('VALIDATION', 'Unsupported media type', { fields: { file: 'Use a JPEG, PNG or WebP image' }, status: 415 });
    }
    return;
  }
  if (raw.length === 0) {
    ctx.body = {};
    return;
  }
  const ct = ctx.req.headers['content-type'] ?? '';
  if (!ct.includes('application/json')) {
    throw new ApiError('VALIDATION', 'Unsupported media type', { fields: {}, status: 415 });
  }
  try {
    ctx.body = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new ApiError('VALIDATION', 'Malformed JSON body');
  }
}

async function resolveAccount(boot: Boot, token: string): Promise<Account | null> {
  // A session revoked by a suspension still answers 403 SUSPENDED: the token
  // is remembered as belonging to the suspended account.
  const revoked = await boot.db.query(`SELECT account_id FROM revoked_sessions WHERE token = $1`, [token]);
  if (revoked.rows.length > 0) throw new ApiError('SUSPENDED', 'This account is suspended');
  const rows = await boot.db.query(
    `SELECT a.id, a.username, a.email, a.email_verified, a.totp_enabled, a.role, a.suspended, a.created_at
     FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token = $1`,
    [token]
  );
  if (rows.rows.length === 0) return null;
  const r = rows.rows[0] as { id: string; username: string; email: string; email_verified: boolean; totp_enabled: boolean; role: string; suspended: boolean; created_at: Date };
  return {
    id: Number(r.id),
    username: r.username,
    email: r.email,
    emailVerified: r.email_verified,
    totpEnabled: r.totp_enabled,
    role: r.role === 'admin' ? 'admin' : 'user',
    suspended: r.suspended,
    createdAt: new Date(r.created_at),
  };
}

async function handleMedia(boot: Boot, ctx: Ctx): Promise<void> {
  const m = /^\/media\/(\d+)\/(320|640|1080|original)\.webp$/.exec(ctx.path);
  if (m === null) throw notFound();
  const { serveMedia } = await import('./routes/media.js');
  await serveMedia(boot as unknown as import('./routes.js').Services, ctx, Number(m[1]), (m[2] as string));
}

/* Page and static-asset serving. Source, configuration, dependency folders and
   environment files are never served; those paths answer 404. */
const PUBLIC_DIR = path.resolve('public');
const FORBIDDEN_PREFIXES = ['/src/', '/node_modules/', '/dist/', '/.git/'];
const FORBIDDEN_FILES = new Set(['/package.json', '/package-lock.json', '/run.json', '/tsconfig.json', '/tsconfig.build.json', '/.env', '/THIRD_PARTY_NOTICES.md', '/npm-shrinkwrap.json']);

const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const CACHEABLE = new Set(['.woff2', '.woff', '.ttf', '.svg', '.png', '.webp']);

async function handlePage(boot: Boot, ctx: Ctx): Promise<void> {
  if (ctx.path.startsWith('/assets/')) {
    await serveAsset(ctx);
    return;
  }
  if (FORBIDDEN_PREFIXES.some((p) => ctx.path.startsWith(p)) || FORBIDDEN_FILES.has(ctx.path) || ctx.path.startsWith('/.')) {
    throw notFound();
  }
  const html = boot.pages.render(ctx);
  const nonce = crypto.randomBytes(16).toString('base64');
  ctx.res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  ctx.res.end(html.replace(/__NONCE__/g, nonce));
}

async function serveAsset(ctx: Ctx): Promise<void> {
  const rel = ctx.path.slice('/assets/'.length);
  if (rel.includes('..') || rel.includes('\0')) throw notFound();
  const file = path.join(PUBLIC_DIR, 'assets', rel);
  if (!file.startsWith(path.join(PUBLIC_DIR, 'assets') + path.sep)) throw notFound();
  let data: Buffer;
  try {
    data = await fs.promises.readFile(file);
  } catch {
    throw notFound();
  }
  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext];
  if (type === undefined) throw notFound();
  const headers: Record<string, string> = {
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
  };
  if (CACHEABLE.has(ext)) headers['Cache-Control'] = 'public, max-age=86400';
  ctx.res.writeHead(200, headers);
  ctx.res.end(data);
}

/* Timed locks end on the server's clock with no client action; this sweeper
   emits the post-state event within 3 seconds of each lock ending. */
function startLockSweeper(boot: Boot): void {
  setInterval(() => {
    if (!boot.state.pgUp) return;
    void (async () => {
      const rows = await boot.db.query(
        `SELECT p.id, p.locked, p.locked_until, p.state, p.version, c.name AS community_name
         FROM posts p JOIN communities c ON c.id = p.community_id
         WHERE p.locked AND p.locked_until IS NOT NULL AND p.locked_until <= now()`
      ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
      for (const row of rows.rows as unknown as { id: string; state: string; version: number; community_name: string; locked_until: Date }[]) {
        const postId = Number(row.id);
        await boot.db.query(`UPDATE posts SET locked = false, locked_until = NULL WHERE id = $1`, [postId]).catch(() => undefined);
        await boot.valkey.publish({
          topics: ['home', `community:${row.community_name.toLowerCase()}`, `post:${postId}`],
          event: 'post-state',
          data: {
            postId,
            communityName: row.community_name,
            state: row.state,
            publicReason: null,
            locked: false,
            lockedUntil: null,
            pinned: false,
            version: row.version,
          },
        }).catch(() => undefined);
      }
    })();
  }, 1000);
}

main().catch((err) => {
  console.error('boot failure', err);
  process.exit(1);
});
