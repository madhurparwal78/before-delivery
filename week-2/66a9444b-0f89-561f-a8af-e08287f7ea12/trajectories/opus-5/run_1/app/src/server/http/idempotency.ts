import type { Request, Response } from 'express';
import { one, pool } from '../db/pool.js';
import { canonicalJsonHash } from '../lib/codes.js';
import { ApiError, ValidationError, conflict, invalid } from '../lib/errors.js';

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const REPLAY_WAIT_MS = 20_000;
const POLL_MS = 100;

interface StoredRow {
  state: string;
  body_hash: string;
  status_code: number | null;
  response_body: unknown;
}

export interface IdempotentOutcome {
  status: number;
  body: unknown;
}

/**
 * Keys are scoped to the caller: the same key with the same body replays the stored response, a
 * different body is refused, and a 503 is never stored so a retry after recovery runs again.
 */
export async function withIdempotency(
  req: Request,
  res: Response,
  userId: string,
  endpoint: string,
  run: () => Promise<IdempotentOutcome>,
): Promise<void> {
  const header = req.headers['idempotency-key'];
  const key = typeof header === 'string' ? header : '';
  if (!KEY_PATTERN.test(key)) throw invalid({ idempotency_key: 'required' });

  const bodyHash = canonicalJsonHash(req.body);
  const claimed = await one<{ key: string }>(
    pool,
    `INSERT INTO idempotency_keys (user_id, key, endpoint, body_hash, state)
     VALUES ($1, $2, $3, $4, 'running')
     ON CONFLICT (user_id, key, endpoint) DO NOTHING
     RETURNING key`,
    [userId, key, endpoint, bodyHash],
  );

  if (claimed === null) {
    const replayed = await replay(userId, key, endpoint, bodyHash);
    res.setHeader('Idempotent-Replay', 'true');
    res.status(replayed.status).json(replayed.body);
    return;
  }

  try {
    const outcome = await run();
    await store(userId, key, endpoint, outcome);
    res.status(outcome.status).json(outcome.body);
  } catch (error) {
    const outcome = failureOutcome(error);
    if (outcome === null) {
      await pool.query(
        `DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2 AND endpoint = $3`,
        [userId, key, endpoint],
      );
      throw error;
    }
    await store(userId, key, endpoint, outcome);
    throw error;
  }
}

/** 2xx and 4xx responses are stored; a 503 is not. */
function failureOutcome(error: unknown): IdempotentOutcome | null {
  if (error instanceof ValidationError) return { status: 422, body: { errors: error.errors } };
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return { status: error.status, body: { error: error.code, ...error.extra } };
  }
  return null;
}

async function store(
  userId: string,
  key: string,
  endpoint: string,
  outcome: IdempotentOutcome,
): Promise<void> {
  await pool.query(
    `UPDATE idempotency_keys SET state = 'done', status_code = $4, response_body = $5::jsonb
     WHERE user_id = $1 AND key = $2 AND endpoint = $3`,
    [userId, key, endpoint, outcome.status, JSON.stringify(outcome.body)],
  );
}

async function replay(
  userId: string,
  key: string,
  endpoint: string,
  bodyHash: string,
): Promise<IdempotentOutcome> {
  const deadline = Date.now() + REPLAY_WAIT_MS;
  for (;;) {
    const row = await one<StoredRow>(
      pool,
      `SELECT state, body_hash, status_code, response_body FROM idempotency_keys
       WHERE user_id = $1 AND key = $2 AND endpoint = $3`,
      [userId, key, endpoint],
    );
    if (row === null) throw conflict('idempotency_key_reused');
    if (row.body_hash !== bodyHash) throw conflict('idempotency_key_reused');
    if (row.state === 'done' && row.status_code !== null) {
      return { status: row.status_code, body: row.response_body };
    }
    if (Date.now() >= deadline) throw conflict('idempotency_key_reused');
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

export async function pruneIdempotencyKeys(): Promise<void> {
  await pool.query(`DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours'`);
}
