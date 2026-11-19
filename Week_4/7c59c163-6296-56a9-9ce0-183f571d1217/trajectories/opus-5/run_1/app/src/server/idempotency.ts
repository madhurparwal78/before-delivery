import { createHash } from 'node:crypto';
import { pool } from './db/pool.js';
import { ApiError, ValidationError } from './http/errors.js';
import { validIdempotencyKey } from './domain/validate.js';
import type { Reply } from './http/router.js';

const REPLAY_HEADER = { 'Idempotent-Replayed': 'true' } as const;
const WAIT_STEP_MS = 50;
const WAIT_LIMIT_MS = 20_000;

const hashBody = (body: Record<string, unknown>): string =>
  createHash('sha256').update(JSON.stringify(body, Object.keys(body).sort())).digest('hex');

interface Record_ {
  body_hash: string;
  response_status: number | null;
  response_body: unknown;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `execute` at most once for a member, endpoint and key. A replay returns the stored response;
 * a different body under the same key is a conflict.
 */
export async function withIdempotency(
  memberId: string,
  endpoint: string,
  key: string | undefined,
  body: Record<string, unknown>,
  execute: () => Promise<Reply>,
): Promise<Reply> {
  if (key === undefined) return execute();
  if (!validIdempotencyKey(key)) throw new ValidationError({ 'Idempotency-Key': 'invalid' });

  const digest = hashBody(body);
  const claim = await pool.query(
    `insert into idempotency_records (member_id, endpoint, idempotency_key, body_hash)
     values ($1,$2,$3,$4) on conflict do nothing`,
    [memberId, endpoint, key, digest],
  );

  if (claim.rowCount === 1) {
    try {
      const reply = await execute();
      await pool.query(
        `update idempotency_records set response_status = $4, response_body = $5
          where member_id = $1 and endpoint = $2 and idempotency_key = $3`,
        [memberId, endpoint, key, reply.status, (reply.body ?? null) as unknown],
      );
      return reply;
    } catch (error) {
      await pool.query(
        'delete from idempotency_records where member_id = $1 and endpoint = $2 and idempotency_key = $3',
        [memberId, endpoint, key],
      );
      throw error;
    }
  }

  const deadline = Date.now() + WAIT_LIMIT_MS;
  for (;;) {
    const existing = await pool.query<Record_>(
      `select body_hash, response_status, response_body from idempotency_records
        where member_id = $1 and endpoint = $2 and idempotency_key = $3`,
      [memberId, endpoint, key],
    );
    const row = existing.rows[0];
    if (row === undefined) return withIdempotency(memberId, endpoint, key, body, execute);
    if (row.body_hash !== digest) throw new ApiError(409, 'idempotency_conflict');
    if (row.response_status !== null) {
      return { status: row.response_status, body: row.response_body, headers: { ...REPLAY_HEADER } };
    }
    if (Date.now() > deadline) throw new ApiError(409, 'idempotency_conflict');
    await sleep(WAIT_STEP_MS);
  }
}
