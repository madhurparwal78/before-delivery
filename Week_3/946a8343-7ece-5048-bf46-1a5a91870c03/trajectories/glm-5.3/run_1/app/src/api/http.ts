import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PoolClient } from 'pg';
import { AppError } from '../core/errors.js';
import type { Ctx, RequestCtx, Handler } from './ctx.js';
import { loadUser } from './ctx.js';

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  needsAuth: boolean;
  bodyKind: 'json' | 'commit' | 'import' | 'none';
  idempotent: boolean;
  write: boolean;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, path: string, handler: Handler, opts: Partial<Pick<Route, 'needsAuth' | 'bodyKind' | 'idempotent' | 'write'>> = {}): void {
    const keys: string[] = [];
    const source = path.replace(/:([A-Za-z_]+)/g, (_m, k) => {
      keys.push(k);
      return '([^/]+)';
    });
    this.routes.push({
      method,
      pattern: new RegExp(`^${source}$`),
      keys,
      handler,
      needsAuth: opts.needsAuth ?? true,
      bodyKind: opts.bodyKind ?? 'json',
      idempotent: opts.idempotent ?? false,
      write: opts.write ?? ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method),
    });
  }

  match(method: string, path: string): { route: Route; params: Record<string, string> } | { methodMismatch: true } | null {
    let sawPath = false;
    for (const r of this.routes) {
      const m = r.pattern.exec(path);
      if (!m) continue;
      sawPath = true;
      if (r.method !== method) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => {
        params[k] = decodeURIComponent(m[i + 1]);
      });
      return { route: r, params };
    }
    if (sawPath) return { methodMismatch: true };
    return null;
  }
}

export async function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > maxBytes) {
        done = true;
        reject(new AppError(413, 'payload_too_large', `Request body is too large (${maxBytes} bytes at most).`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!done) resolve(Buffer.concat(chunks));
    });
    req.on('error', (e) => {
      if (!done) reject(e);
    });
  });
}

export async function checkRate(c: PoolClient, userId: number, name: string, limit: number, now: number): Promise<number | null> {
  const r = await c.query<{ window_start: number; count: number }>(
    `SELECT window_start, count FROM rate_counters WHERE user_id = $1 AND name = $2`,
    [userId, name],
  );
  const row = r.rows[0];
  if (!row) {
    await c.query(`INSERT INTO rate_counters (user_id, name, window_start, count) VALUES ($1, $2, $3, 1) ON CONFLICT (user_id, name) DO NOTHING`, [userId, name, now]);
    return null;
  }
  if (now - row.window_start >= 60_000) {
    await c.query(`UPDATE rate_counters SET window_start = $3, count = 1 WHERE user_id = $1 AND name = $2`, [userId, name, now]);
    return null;
  }
  if (row.count >= limit) {
    const secs = Math.max(1, Math.ceil((row.window_start + 60_000 - now) / 1000));
    return secs;
  }
  await c.query(`UPDATE rate_counters SET count = count + 1 WHERE user_id = $1 AND name = $2`, [userId, name]);
  return null;
}

export async function checkLoginRate(c: PoolClient, username: string, limit: number, now: number): Promise<number | null> {
  const r = await c.query<{ id: number }>(`SELECT id FROM users WHERE username = $1`, [username]);
  const user = r.rows[0];
  if (!user) return null;
  return checkRate(c, user.id, `login:${username}`, limit, now);
}

export async function findStoredIdempotent(c: PoolClient, userId: number, key: string, method: string, path: string): Promise<{ status: number; body: string | null } | null> {
  const r = await c.query<{ status: number; body: string | null; method: string; path: string }>(
    `SELECT status, body, method, path FROM idempotency_keys WHERE user_id = $1 AND key = $2`, [userId, key],
  );
  return r.rows[0] ?? null;
}

export async function storeIdempotent(c: PoolClient, userId: number, key: string, method: string, path: string, status: number, body: string, now: number): Promise<void> {
  await c.query(
    `INSERT INTO idempotency_keys (user_id, key, method, path, status, body, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, key) DO NOTHING`,
    [userId, key, method, path, status, body, now],
  );
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export { loadUser };
export type { Ctx, RequestCtx, Handler };
