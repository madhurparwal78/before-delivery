import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { can, type Permission, type Role } from '../shared/domain.js';
import { AppError, forbidden } from './errors.js';
import { asDatabaseError, one, pool } from './db.js';
import { config } from './config.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

const BODY_LIMIT = 100_000;
export const SESSION_COOKIE = 'rb_session';

export interface Staff {
  id: string;
  clinicId: string;
  name: string;
  email: string;
  role: Role;
  clinic: { id: string; name: string; slug: string };
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const candidate = await scrypt(password, Buffer.from(salt, 'hex'), 32);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export class Ctx {
  readonly url: URL;
  params: Record<string, string> = {};
  private cached: Promise<unknown> | undefined;
  private staff: Staff | null | undefined;

  constructor(
    readonly req: IncomingMessage,
    readonly res: ServerResponse,
  ) {
    this.url = new URL(req.url ?? '/', 'http://local');
  }

  get method(): string {
    return this.req.method ?? 'GET';
  }

  get query(): URLSearchParams {
    return this.url.searchParams;
  }

  get address(): string {
    return this.req.socket.remoteAddress ?? '';
  }

  cookie(name: string): string | undefined {
    for (const part of (this.req.headers.cookie ?? '').split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === name) return v.join('=');
    }
    return undefined;
  }

  /** Raw request bytes, at most `limit`; a larger body is 413. */
  async raw(limit = BODY_LIMIT): Promise<Buffer> {
    const declared = Number(this.req.headers['content-length']);
    const chunks: Buffer[] = [];
    let size = 0;
    let over = declared > limit;
    for await (const chunk of this.req) {
      size += (chunk as Buffer).length;
      if (size > limit) over = true;
      else chunks.push(chunk as Buffer);
    }
    if (over) throw new AppError('payload_too_large');
    return Buffer.concat(chunks);
  }

  /** The parsed JSON object body. Read at most once. */
  json(): Promise<Record<string, unknown>> {
    this.cached ??= this.raw().then((buf) => {
      if (buf.length === 0) return {};
      let parsed: unknown;
      try {
        // Control characters (NUL included) are each field's validator's to refuse, so the 422 names that field.
        parsed = JSON.parse(buf.toString('utf8'));
      } catch {
        throw new AppError('validation_failed', 'body is not valid.', 'body');
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new AppError('validation_failed', 'body is not valid.', 'body');
      }
      return parsed;
    });
    return this.cached as Promise<Record<string, unknown>>;
  }

  async user(): Promise<Staff> {
    const found = await this.maybeUser();
    if (!found) throw new AppError('unauthenticated');
    return found;
  }

  /** The signed-in person. Role and status are read from Postgres on every request, never from the cookie. */
  async maybeUser(): Promise<Staff | null> {
    if (this.staff !== undefined) return this.staff;
    const token = this.cookie(SESSION_COOKIE);
    this.staff = null;
    if (token) {
      const row = await one<{ id: string; clinic_id: string; name: string; email: string; role: Role; cname: string; slug: string }>(
        pool,
        `SELECT u.id, u.clinic_id, u.name, u.email, u.role, c.name AS cname, c.slug
           FROM sessions s JOIN users u ON u.id = s.user_id JOIN clinics c ON c.id = u.clinic_id
          WHERE s.token_hash = $1 AND s.expires_at > clock_timestamp() AND u.status = 'Active'`,
        [sha256(token)],
      );
      if (row) {
        this.staff = {
          id: row.id,
          clinicId: row.clinic_id,
          name: row.name,
          email: row.email,
          role: row.role,
          clinic: { id: row.clinic_id, name: row.cname, slug: row.slug },
        };
      }
    }
    return this.staff;
  }

  /** Permission check: the single path every endpoint takes. */
  allow(user: Staff, permission: Permission): void {
    if (!can(user.role, permission)) throw forbidden();
  }

  send(status: number, body: unknown, headers: Record<string, string> = {}): void {
    const data = JSON.stringify(body);
    this.res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(data),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    });
    this.res.end(data);
  }

  redirect(location: string, headers: Record<string, string> = {}): void {
    this.res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...headers });
    this.res.end();
  }

  clearSessionCookie(): string {
    return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
  }

  setSessionCookie(token: string): string {
    return `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`;
  }
}

type Handler = (ctx: Ctx) => Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  names: string[];
  handler: Handler;
}

const routes: Route[] = [];

export function route(method: string, path: string, handler: Handler): void {
  const names: string[] = [];
  const source = path.replace(/[.]/g, '\\.').replace(/:([A-Za-z]+)/g, (_m, name: string) => {
    names.push(name);
    return '([^/]+)';
  });
  routes.push({ method, pattern: new RegExp(`^${source}$`), names, handler });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

async function serveStatic(ctx: Ctx, webRoot: string): Promise<void> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(ctx.url.pathname);
  } catch {
    throw new AppError('not_found');
  }
  const clean = normalize(decoded).replace(/^([/\\])+/, '');
  let file = join(webRoot, clean);
  let info = await stat(file).catch(() => null);
  if (!info || !info.isFile()) {
    if (extname(clean) !== '') {
      ctx.res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      ctx.res.end('Not found');
      return;
    }
    file = join(webRoot, 'index.html');
    info = await stat(file);
  }
  const type = MIME[extname(file)] ?? 'application/octet-stream';
  const immutable = file.includes(`${join(webRoot, 'assets')}`);
  ctx.res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': info.size,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  createReadStream(file).pipe(ctx.res);
}

/** A path segment, decoded. A malformed escape or a NUL names nothing: not found, never a lookup. */
function pathParam(raw: string): string {
  let value: string;
  try {
    value = decodeURIComponent(raw);
  } catch {
    throw new AppError('not_found');
  }
  if (value.includes('\u0000')) throw new AppError('not_found');
  return value;
}

interface Gate {
  ready: () => boolean;
}

export async function dispatch(req: IncomingMessage, res: ServerResponse, webRoot: string, gate: Gate): Promise<void> {
  const ctx = new Ctx(req, res);
  try {
    const path = ctx.url.pathname;
    const isApi = path.startsWith('/api/') || path.startsWith('/auth/');
    if (isApi) {
      const hit = routes.find((r) => r.method === ctx.method && r.pattern.test(path));
      if (hit && (gate.ready() || path === '/api/health')) {
        const match = hit.pattern.exec(path)!;
        ctx.params = Object.fromEntries(hit.names.map((n, i) => [n, pathParam(match[i + 1]!)]));
        if (ctx.url.search.toLowerCase().includes('%00')) throw new AppError('validation_failed', 'query is not valid.', 'query');
        await hit.handler(ctx);
        return;
      }
      if (hit) throw new AppError('database_unavailable');
      throw new AppError('not_found');
    }
    if (ctx.method !== 'GET' && ctx.method !== 'HEAD') throw new AppError('not_found');
    await serveStatic(ctx, webRoot);
  } catch (raw) {
    const error = asDatabaseError(raw);
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof AppError) {
      ctx.send(error.status, error.body());
      return;
    }
    console.error(error);
    ctx.send(500, { error: 'internal_error', message: 'Something went wrong.' });
  }
}

export const gradingTokenOk = (ctx: Ctx): boolean => {
  const given = ctx.req.headers['x-grading-token'];
  return typeof given === 'string' && given.length > 0 && given === config.gradingToken;
};
