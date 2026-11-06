// Idempotency keys: scoped to the session's customer or staff member and the route, kept 24 hours.
import { createHash } from 'node:crypto';
import { pool } from './db.js';
import { ApiError } from './errors.js';
import type { Ctx, Reply } from './http.js';

const KEY = /^[A-Za-z0-9_-]{8,64}$/;
const RETENTION_MS = 24 * 3600_000;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

const storable = (status: number, code: string | undefined) =>
  (status >= 200 && status < 300) || status === 410 || status === 412 || status === 422 || (status === 409 && code !== 'request_in_progress');

/** Runs `work` once per key; an exact replay returns the stored status and body. */
export async function idempotent(ctx: Ctx, scope: string, work: () => Promise<Reply>): Promise<Reply> {
  const header = ctx.req.headers['idempotency-key'];
  const key = Array.isArray(header) ? header[0] : header;
  if (key === undefined) throw new ApiError(400, 'idempotency_key_required', ctx.m.idempotencyRequired);
  if (!KEY.test(key)) throw new ApiError(400, 'idempotency_key_invalid', ctx.m.idempotencyInvalid);
  const hash = createHash('sha256').update(canonical(ctx.body)).digest('hex');
  await pool.query('DELETE FROM idempotency WHERE scope = $1 AND key = $2 AND created_at < $3', [
    scope,
    key,
    new Date(ctx.now.getTime() - RETENTION_MS),
  ]);
  const claimed = (await pool.query('INSERT INTO idempotency (scope, key, request_hash, created_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING key',
    [scope, key, hash, ctx.now],
  )).rows[0];
  if (!claimed) {
    const stored = (await pool.query<{ request_hash: string; status: number | null; body: string | null }>('SELECT request_hash, status, body FROM idempotency WHERE scope = $1 AND key = $2',
      [scope, key],
    )).rows[0];
    if (stored?.request_hash !== hash) throw new ApiError(409, 'idempotency_key_reused', ctx.m.idempotencyReused);
    if (stored.status === null) throw new ApiError(409, 'request_in_progress', ctx.m.requestInProgress);
    return { status: stored.status, body: JSON.parse(stored.body ?? 'null'), headers: { 'Idempotent-Replayed': 'true' } };
  }
  const remember = async (status: number, body: unknown, code?: string) => {
    if (storable(status, code)) {
      await pool.query('UPDATE idempotency SET status = $3, body = $4 WHERE scope = $1 AND key = $2', [scope, key, status, JSON.stringify(body)]);
    } else {
      await pool.query('DELETE FROM idempotency WHERE scope = $1 AND key = $2', [scope, key]);
    }
  };
  try {
    const reply = await work();
    await remember(reply.status, reply.body);
    return reply;
  } catch (error) {
    if (error instanceof ApiError) await remember(error.status, error.body(), error.code);
    else await remember(500, null);
    throw error;
  }
}
