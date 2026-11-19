/**
 * Operation replay (DP-56), rate limits (DP-55), the invite quota (DP-54)
 * and the billing mirror access. Counters live in Postgres so every
 * instance shares them.
 */
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { FIELD_MESSAGES } from './errors.js';
import { ApiError } from './http.js';

export type ActorType = 'facilitator' | 'participant';

export interface OpIdentity {
  actorType: ActorType;
  actorId: string;
  clientOpId: string;
  method: string;
  path: string;
  bodyHash: string;
}

export function bodyHashOf(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
}

/**
 * Replay one ✱ request. Returns the stored response for a repeat, waits for an
 * in-flight copy, answers op_conflict for a different body under the same op id,
 * and otherwise hands the request to the handler and stores the result.
 * A 5xx result is never stored, so it runs again.
 */
export async function withReplay<T>(
  c: PoolClient,
  id: OpIdentity,
  workshopId: string | null,
  handler: () => Promise<{ status: number; body: unknown }>,
): Promise<{ status: number; body: unknown }> {
  const key = `${id.actorType}:${id.actorId}:${id.clientOpId}`;
  // wait for any in-flight copy, up to 60 seconds
  for (let i = 0; i < 600; i++) {
    const stored = await c.query(
      'select status, response_body from client_ops where actor_type=$1 and actor_id=$2 and client_op_id=$3',
      [id.actorType, id.actorId, id.clientOpId]);
    if (stored.rows.length > 0) {
      const row = stored.rows[0] as { status: number; response_body: unknown; body_hash: string };
      if (row.body_hash !== id.bodyHash) throw new ApiError(409, 'op_conflict');
      return { status: row.status, body: row.response_body };
    }
    const inflight = await c.query(
      'select body_hash from client_ops_inflight where key = $1', [key]);
    if (inflight.rows.length === 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const claimed = await c.query(
    'insert into client_ops_inflight (key, body_hash, created_at) values ($1,$2, now()) on conflict (key) do nothing',
    [key, id.bodyHash]);
  if (claimed.rowCount === 0) {
    // someone else raced in; loop to wait for their result
    for (let i = 0; i < 600; i++) {
      const stored = await c.query(
        'select status, response_body from client_ops where actor_type=$1 and actor_id=$2 and client_op_id=$3',
        [id.actorType, id.actorId, id.clientOpId]);
      if (stored.rows.length > 0) {
        const row = stored.rows[0] as { status: number; response_body: unknown; body_hash: string };
        if (row.body_hash !== id.bodyHash) throw new ApiError(409, 'op_conflict');
        return { status: row.status, body: row.response_body };
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('operation replay wait timed out');
  }
  try {
    const result = await handler();
    if (result.status >= 200 && result.status < 500) {
      await c.query(
        `insert into client_ops (actor_type, actor_id, client_op_id, method, path, body_hash, status, response_body, workshop_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (actor_type, actor_id, client_op_id) do nothing`,
        [id.actorType, id.actorId, id.clientOpId, id.method, id.path, id.bodyHash, result.status,
          JSON.stringify(result.body), workshopId]);
    }
    return result;
  } finally {
    // never mask the original error with the cleanup's own failure
    await c.query('delete from client_ops_inflight where key = $1', [key]).catch(() => undefined);
  }
}

/** The operation id rule (API). */
export function validOpId(raw: unknown): boolean {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(raw);
}

export function opIdError(): ApiError {
  return new ApiError(422, 'validation', { fields: { clientOpId: FIELD_MESSAGES.clientOpId } });
}

// ---- rate limits: fixed windows counted in Postgres, shared by every instance

export interface RateClass {
  name: string;
  limit: number;
  windowSeconds: number;
}

export const RATE_CLASSES: Record<string, RateClass> = {
  signinFailure: { name: 'signinFailure', limit: 5, windowSeconds: 0 },
  join: { name: 'join', limit: 30, windowSeconds: 60 },
  boardWrite: { name: 'boardWrite', limit: 120, windowSeconds: 10 },
  upload: { name: 'upload', limit: 10, windowSeconds: 60 },
  presence: { name: 'presence', limit: 40, windowSeconds: 2 },
};

/**
 * Check and count one request against a class. Returns the remaining count and
 * the seconds until the window ends. A request already at the limit answers
 * rate_limited and is not counted.
 */
export async function takeRateSlot(
  c: PoolClient,
  cls: RateClass,
  scope: string,
  windowSeconds: number,
): Promise<{ allowed: boolean; remaining: number; reset: number }> {
  const nowMs = Date.now();
  const windowStart = Math.floor(nowMs / (windowSeconds * 1000)) * windowSeconds * 1000;
  const windowEnd = windowStart + windowSeconds * 1000;
  const bucket = `${cls.name}:${scope}:${windowStart}`;
  const res = await c.query(
    `insert into rate_counters (bucket, count) values ($1, 1)
     on conflict (bucket) do update set count = rate_counters.count + 1
     returning count`,
    [bucket]);
  const count = res.rows[0].count as number;
  const reset = Math.ceil((windowEnd - nowMs) / 1000);
  if (count > cls.limit) {
    return { allowed: false, remaining: 0, reset: Math.max(1, reset) };
  }
  return { allowed: true, remaining: cls.limit - count, reset: Math.max(1, reset) };
}

/** Count a sign-in failure against its own class and window (config-driven). */
export async function countSigninFailure(c: PoolClient, emailKey: string, ipKey: string, windowSeconds: number): Promise<void> {
  const scope = `${emailKey}|${ipKey}`;
  await takeRateSlot(c, RATE_CLASSES.signinFailure, scope, windowSeconds);
}

/** Is the sign-in rate limit reached? (does not count) */
export async function signinLimited(c: PoolClient, emailKey: string, ipKey: string, windowSeconds: number): Promise<boolean> {
  const scope = `${emailKey}|${ipKey}`;
  const nowMs = Date.now();
  const windowStart = Math.floor(nowMs / (windowSeconds * 1000)) * windowSeconds * 1000;
  const res = await c.query('select count from rate_counters where bucket = $1', [`signinFailure:${scope}:${windowStart}`]);
  const count = (res.rows[0] as { count: number } | undefined)?.count ?? 0;
  return count >= RATE_CLASSES.signinFailure.limit;
}

// ---- the daily invite quota, per facilitator-local calendar day

export async function invitesToday(c: PoolClient, facilitatorId: string, localDate: string): Promise<number> {
  const res = await c.query('select count from invite_daily where facilitator_id=$1 and local_date=$2', [facilitatorId, localDate]);
  return (res.rows[0] as { count: number } | undefined)?.count ?? 0;
}

export async function addInviteCount(c: PoolClient, facilitatorId: string, localDate: string, n: number): Promise<void> {
  await c.query(
    `insert into invite_daily (facilitator_id, local_date, count) values ($1,$2,$3)
     on conflict (facilitator_id, local_date) do update set count = invite_daily.count + $3`,
    [facilitatorId, localDate, n]);
}
