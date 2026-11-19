import express, { type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import { boot, type Ctx } from './boot.ts';
import { matchRoute, routes } from './api.ts';
import { serveNotFoundPage, servePage } from './pages.ts';
import { authenticate, unauthenticated } from './auth.ts';
import { Refusal } from '../domain/failure.ts';
import { words } from '../domain/words.ts';
import { json, notFound } from './api-core.ts';
import type { Caller } from './caller.ts';


const ctx: Ctx = await boot();

const app = express();
app.disable('x-powered-by');
app.use(cookieParser());
app.use(express.static('public', { index: false, extensions: [], setHeaders: (res) => { res.setHeader('cache-control', 'private, no-store'); } }));

const JSON_LIMIT = 65536;
const PHOTO_LIMIT = 5000000;

app.use((_req, res, next) => {
  res.setHeader('cache-control', 'private, no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('content-security-policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'none'");
  next();
});

// API dispatch with the single refusal ladder.
app.use('/api', (req: Request, res: Response) => {
  void handleApi(req, res);
});

// Every other address serves the single-page shell. Source files and dotfiles answer the
// not-found page, as do assets that do not exist.
const PROTECTED = /^(\/|.*\/)(run\.json|package\.json|package-lock\.json|tsconfig(\.[a-z]*)?\.json|THIRD_PARTY_NOTICES\.md|AGENTS\.md|\.env.*|.*\.env|\.git.*|.*\.map)$/;
app.use((req: Request, res: Response) => {
  const path = req.path.replace(/\/$/, '');
  const base = path.split('/').pop() ?? '';
  if (PROTECTED.test(path) || base.startsWith('.') || base.endsWith('.map') || base.endsWith('.ts')) {
    serveNotFoundPage(res);
    return;
  }
  if (isAsset(path)) { serveNotFoundPage(res); return; }
  servePage(req, res);
});

function isAsset(path: string): boolean {
  if (!path.startsWith('/css/') && !path.startsWith('/js/') && !path.startsWith('/fonts/')) return false;
  const base = path.split('/').pop() ?? '';
  return !/^[A-Za-z0-9._-]+$/.test(base) || !/\.(css|js|ttf|svg)$/.test(base);
}

async function handleApi(req: Request, res: Response): Promise<void> {
  const method = req.method.toUpperCase();
  const fullPath = req.baseUrl + req.path;
  const path = fullPath.replace(/\/+$/, '') || '/';
  const matched = matchRoute(method, path);
  if (!matched) { notFound(res); return; }
  if (!ctx.dbUp) { json(res, 503, { error: 'database_unavailable', message: words.errors.database_unavailable }); return; }
  try {
    // Transport refusals first: 413 then 415.
    const isPhoto = path.startsWith('/api/measurements/') && path.endsWith('/photo');
    if (isPhoto && method === 'PUT') {
      const type = String(req.header('content-type') ?? '');
      if (type !== 'image/jpeg' && type !== 'image/png') {
        throw new Refusal(415, 'unsupported_media', words.errors.unsupported_media);
      }
      return await readRaw(req, PHOTO_LIMIT, async (body) => {
        (req as unknown as { body: unknown }).body = body;
        await authorizeAndRun(matched, req, res);
      });
    }
    if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
      const type = String(req.header('content-type') ?? '');
      if (!type.startsWith('application/json')) {
        throw new Refusal(415, 'unsupported_media', words.errors.unsupported_media);
      }
      return await readRaw(req, JSON_LIMIT, async (body) => {
        (req as unknown as { body: unknown }).body = parseJson(body);
        await authorizeAndRun(matched, req, res);
      });
    }
    await authorizeAndRun(matched, req, res);
  } catch (err) {
    sendRefusal(res, err);
  }
}

async function authorizeAndRun(matched: { route: (typeof routes)[number]; params: Record<string, string> }, req: Request, res: Response): Promise<void> {
  const method = req.method.toUpperCase();
  const publicAddress = (matched.route.method === 'GET' && matched.route.path === '/api/health')
    || (matched.route.method === 'POST' && matched.route.path === '/api/session')
    || (matched.route.method === 'GET' && matched.route.path === '/api/session');
  let caller: Caller | null = null;
  if (!publicAddress) {
    if (method !== 'GET' && !hasBearer(req)) throw unauthenticated();
    caller = await authenticate(ctx, req);
    if (!caller) throw unauthenticated();
    if (matched.route.roles.length > 0 && !matched.route.roles.includes(caller.role)) {
      if (matched.route.path.includes(':')) throw notFoundRefusalApi();
      throw new Refusal(403, 'forbidden', words.errors.forbidden);
    }
  }
  (req as unknown as { params: Record<string, string> }).params = { ...(req.params as Record<string, string>), ...matched.params };
  await matched.route.handler(req, res, ctx, caller as Caller);
}

function hasBearer(req: Request): boolean {
  return Boolean(req.headers.authorization?.startsWith('Bearer '));
}

function notFoundRefusalApi(): Refusal {
  return new Refusal(404, 'not_found', words.errors.not_found);
}

function parseJson(body: Buffer): unknown {
  if (body.length === 0) return {};
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new Refusal(422, 'invalid', words.errors.invalid);
  }
}

function readRaw(req: Request, limit: number, next: (body: Buffer) => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        done = true;
        reject(new Refusal(413, 'too_large', words.errors.too_large));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      next(Buffer.concat(chunks)).then(resolve, reject);
    });
    req.on('error', (err) => {
      if (done) return;
      done = true;
      reject(err);
    });
  });
}

function sendRefusal(res: Response, err: unknown): void {
  if (res.headersSent) return;
  if (err instanceof Refusal) {
    const headers: Record<string, string> = {};
    if (err.code === 'rate_limited') headers['retry-after'] = String((err as RateLimitedLike).retryAfter ?? 1);
    json(res, err.status, err.failure.body, headers);
    return;
  }
  if ((err as { status?: number }).status === 404) { notFound(res); return; }
  const pgCode = (err as { code?: string }).code;
  if (pgCode === '23505') {
    json(res, 409, { error: 'email_taken', message: words.errors.email_taken });
    return;
  }
  if (pgCode === '42P01' || pgCode === '42703' || pgCode === '22P02' || pgCode === '23503' || pgCode === '23514' || pgCode === '23000') {
    console.error('database error:', (err as Error).message);
    json(res, 500, { error: 'database_unavailable', message: words.errors.database_unavailable });
    return;
  }
  console.error('unhandled error:', err);
  json(res, 503, { error: 'database_unavailable', message: words.errors.database_unavailable });
}

interface RateLimitedLike extends Refusal { retryAfter?: number }

export { app, ctx };
