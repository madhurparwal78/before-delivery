import { createHash } from 'node:crypto';
import { query, queryOne } from './pool.js';
import { ApiError } from '../http/errors.js';
import type { Reply } from '../http/router.js';

export interface StoredOutcome {
  readonly status: number;
  readonly body: unknown;
}

function hashBody(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
}

interface Row {
  body_hash: string;
  status: number | null;
  response_body: unknown;
}

const WAIT_STEP_MS = 50;
const WAIT_LIMIT_MS = 30_000;

/**
 * Within one endpoint the first request with a key decides the outcome.
 * Responses below 500 are stored and replayed with the same status for the same
 * key and an identical body; a different body answers 409. A 503 isn't stored,
 * so a retry never creates a second Kill Bill charge or refund.
 */
export async function withIdempotency(
  endpoint: string,
  key: string,
  body: unknown,
  work: () => Promise<Reply>,
): Promise<Reply> {
  const bodyHash = hashBody(body);
  const claimed = await query<{ id: number }>(
    `INSERT INTO idempotency (endpoint, key, body_hash) VALUES ($1, $2, $3)
     ON CONFLICT (endpoint, key) DO NOTHING RETURNING id`,
    [endpoint, key, bodyHash],
  );

  if (claimed.length === 0) {
    return replay(endpoint, key, bodyHash);
  }

  try {
    const reply = await work();
    if (reply.status >= 500 || reply.status === 503) {
      await query(`DELETE FROM idempotency WHERE endpoint = $1 AND key = $2`, [endpoint, key]);
      return reply;
    }
    await query(
      `UPDATE idempotency SET status = $3, response_body = $4 WHERE endpoint = $1 AND key = $2`,
      [endpoint, key, reply.status, JSON.stringify(reply.json ?? null)],
    );
    return reply;
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    if (status >= 500) {
      await query(`DELETE FROM idempotency WHERE endpoint = $1 AND key = $2`, [endpoint, key]);
      throw error;
    }
    const stored = (error as ApiError).body();
    await query(
      `UPDATE idempotency SET status = $3, response_body = $4 WHERE endpoint = $1 AND key = $2`,
      [endpoint, key, status, JSON.stringify(stored)],
    );
    throw error;
  }
}

/** A second request that arrives while the first runs waits for it. */
async function replay(endpoint: string, key: string, bodyHash: string): Promise<Reply> {
  const deadline = Date.now() + WAIT_LIMIT_MS;
  for (;;) {
    const row = await queryOne<Row>(
      `SELECT body_hash, status, response_body FROM idempotency WHERE endpoint = $1 AND key = $2`,
      [endpoint, key],
    );
    if (row === null) {
      // The first attempt answered 503 and left nothing stored; this one runs.
      throw new ApiError('billing_unavailable');
    }
    if (row.body_hash !== bodyHash) throw new ApiError('idempotency_key_reused');
    if (row.status !== null) {
      return { status: row.status, json: row.response_body };
    }
    if (Date.now() > deadline) throw new ApiError('billing_unavailable');
    await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
  }
}
