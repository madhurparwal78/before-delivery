import { createHash } from 'node:crypto';
import { config } from './config.js';
import { pool } from './db.js';
import { HttpError, validation } from './http.js';
import type { Answer, Ctx } from './http.js';

interface Stored {
  status: number;
  body: unknown;
}

const KEY_FORMAT = /^[A-Za-z0-9_-]{8,64}$/;

export function readKey(ctx: Ctx): string {
  const key = ctx.req.headers['idempotency-key'];
  if (typeof key !== 'string' || !KEY_FORMAT.test(key)) throw validation({ idempotency_key: 'Send again from the form.' });
  return key;
}

const ABSENT = { absent: true };

export function fingerprint(route: string, parts: { threadId?: string; body: unknown; topic?: unknown }): string {
  const value = (submitted: unknown): unknown => (submitted === undefined ? ABSENT : { value: submitted });
  return createHash('sha256').update(JSON.stringify([route, parts.threadId ?? null, value(parts.body), value(parts.topic)])).digest('hex');
}

export async function once(
  claim: { scope: string; route: string; key: string; fingerprint: string },
  run: () => Promise<Stored>,
): Promise<Stored & { replay: boolean }> {
  const { scope, route, key } = claim;
  await pool.query(`delete from idempotency_keys where scope = $1 and route = $2 and key = $3 and status = 'completed' and expires_at <= now()`, [scope, route, key]);
  const inserted = await pool.query(
    `insert into idempotency_keys (scope, route, key, fingerprint, status) values ($1, $2, $3, $4, 'in_progress') on conflict do nothing returning key`,
    [scope, route, key, claim.fingerprint],
  );
  if (inserted.rowCount === 0) {
    const { rows } = await pool.query<{ fingerprint: string; status: string; response_status: number | null; response_body: unknown }>(
      'select fingerprint, status, response_status, response_body from idempotency_keys where scope = $1 and route = $2 and key = $3',
      [scope, route, key],
    );
    const stored = rows[0];
    if (!stored) return once(claim, run);
    if (stored.fingerprint !== claim.fingerprint) throw new HttpError(422, 'idempotency_mismatch', 'That key was used for a different request.');
    if (stored.status === 'in_progress') throw new HttpError(409, 'idempotency_in_progress', 'That request is still being handled.');
    return { status: stored.response_status as number, body: stored.response_body, replay: true };
  }
  try {
    const result = await run();
    await pool.query(
      `update idempotency_keys set status = 'completed', response_status = $4, response_body = $5, expires_at = now() + make_interval(secs => $6)
        where scope = $1 and route = $2 and key = $3`,
      [scope, route, key, result.status, JSON.stringify(result.body), config.idempotencyKeyTtlSeconds],
    );
    return { ...result, replay: false };
  } catch (error) {
    await pool.query('delete from idempotency_keys where scope = $1 and route = $2 and key = $3', [scope, route, key]);
    throw error;
  }
}

export function answerOf(result: Stored & { replay: boolean }): Answer {
  return { status: result.status, body: result.body, headers: result.replay ? { 'Idempotent-Replay': 'true' } : {} };
}
