import { db } from './db.js';
import { idempotencyConflict } from './errors.js';

/**
 * Idempotency, in one place. Keys are scoped to the tenant (or link) and the
 * route, kept 24 hours, compared as parsed JSON values, and only responses
 * below 500 are stored. Concurrent requests with the same key and body share
 * the first response.
 */


export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

export function stableBody(v: JsonValue): string {
  return stable(v);
}

function stable(v: JsonValue): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stable((v as Record<string, JsonValue>)[k])).join(',') + '}';
}

export function parseJsonBody(buf: Buffer | null): JsonValue {
  if (buf === null || buf.length === 0) return {};
  try {
    return JSON.parse(buf.toString('utf8')) as JsonValue;
  } catch {
    return {};
  }
}

export function validIdempotencyKey(key: string): boolean {
  if (key.length < 1 || key.length > 128) return false;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    if (c < 32 || c > 126) return false;
  }
  return true;
}

export function routeScope(ctx: { staffTenant: string | null; reviewToken: string | null; method: string; routePattern: string }): string {
  return `${ctx.staffTenant ?? ctx.reviewToken}:${ctx.method}:${ctx.routePattern}`;
}

/** Look up a stored response for this key. Throws 409 on a different body. */
export async function replayStored(
  scope: string,
  key: string,
  body: JsonValue
): Promise<{ status: number; body: unknown; pending: boolean } | null> {
  const pool = db();
  await pool.query("DELETE FROM idempotency WHERE created_at < now() - interval '24 hours'");
  const row = await pool.query('SELECT body_hash, status, response FROM idempotency WHERE scope=$1 AND key=$2', [scope, key]);
  if (row.rows.length === 0) return null;
  const r = row.rows[0];
  if (r.body_hash !== stableBody(body)) throw idempotencyConflict();
  if (r.status === 0) return { status: 0, body: null, pending: true };
  return { status: r.status as number, body: r.response, pending: false };
}

export async function storeResponse(
  scope: string,
  key: string,
  body: JsonValue,
  status: number,
  response: unknown
): Promise<void> {
  if (status >= 500) return;
  const pool = db();
  await pool.query(
    `INSERT INTO idempotency (key, scope, body_hash, status, response, created_at)
     VALUES ($1,$2,$3,$4,$5,now())
     ON CONFLICT (scope, key) DO NOTHING`,
    [key, scope, stableBody(body), status, response]
  );
}

/** Reserve the key for this body: returns false when another request is mid-flight with the same body. */
export async function beginIdempotent(scope: string, key: string, body: JsonValue): Promise<boolean> {
  const pool = db();
  await pool.query(
    `INSERT INTO idempotency (key, scope, body_hash, status, response, created_at)
     VALUES ($1,$2,$3,0,'{"pending":true}',now())
     ON CONFLICT (scope, key) DO NOTHING`,
    [key, scope, stableBody(body)]
  );
  const res = await pool.query('SELECT body_hash, status FROM idempotency WHERE scope=$1 AND key=$2', [scope, key]);
  if (res.rows.length === 0) return true;
  const r = res.rows[0];
  if (r.body_hash !== stableBody(body)) {
    throw idempotencyConflict();
  }
  return true;
}

export async function commitResponse(scope: string, key: string, body: JsonValue, status: number, response: unknown): Promise<void> {
  if (status >= 500) {
    const pool = db();
    await pool.query('DELETE FROM idempotency WHERE scope=$1 AND key=$2', [scope, key]);
    return;
  }
  const pool = db();
  await pool.query(
    'UPDATE idempotency SET status=$3, response=$4, created_at=now() WHERE scope=$1 AND key=$2',
    [scope, key, status, JSON.parse(JSON.stringify(response))]
  );
}

