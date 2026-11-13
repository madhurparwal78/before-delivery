import crypto from 'node:crypto';
import type { PgPool } from '../db/pg.ts';

/**
 * Idempotency: keys scoped to the signed-in user, replayed with the stored
 * response, conflicts on a different body, and duplicates in flight wait for
 * the first result. 503 responses are not stored.
 */

export function validKey(key: string | undefined): key is string {
  if (!key || typeof key !== 'string') return false;
  return /^[A-Za-z0-9_-]{1,64}$/.test(key);
}

function hashBody(raw: string): string {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

export type BeginOutcome =
  | { kind: 'fresh' }
  | { kind: 'replay'; status: number; body: string }
  | { kind: 'conflict' };

/**
 * Reserve the key for this user. A fresh insert wins; an existing row either
 * replays (same method, path and body hash, already finished), waits for the
 * in-flight request, or conflicts.
 */
export async function begin(
  pool: PgPool,
  userId: string,
  key: string,
  method: string,
  path: string,
  rawBody: string,
): Promise<BeginOutcome> {
  const bodyHash = hashBody(rawBody);
  const res = await pool.query(
    `INSERT INTO idempotency (user_id, key, method, path, body_hash, status, response_body, state, in_flight)
     VALUES ($1, $2, $3, $4, $5, 0, NULL, 'pending', true)
     ON CONFLICT (user_id, key) DO NOTHING`,
    [userId, key, method, path, bodyHash],
  );
  if ((res.rowCount ?? 0) > 0) return { kind: 'fresh' };

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const existing = await pool.query(
      `SELECT method, path, body_hash, status, response_body, in_flight FROM idempotency
       WHERE user_id = $1 AND key = $2`,
      [userId, key],
    );
    const row = existing.rows[0]!;
    if (row['method'] !== method || row['path'] !== path || row['body_hash'] !== bodyHash) {
      return { kind: 'conflict' };
    }
    if (row['in_flight'] === false && (row['status'] as number) > 0) {
      return { kind: 'replay', status: row['status'] as number, body: row['response_body'] as string };
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return { kind: 'conflict' };
}

export async function finish(pool: PgPool, userId: string, key: string, status: number, body: string): Promise<void> {
  if (status >= 500) {
    // 503 and other 5xx are not stored: clear the marker so a retry runs again.
    await pool.query(`DELETE FROM idempotency WHERE user_id = $1 AND key = $2`, [userId, key]);
    return;
  }
  await pool.query(
    `UPDATE idempotency SET status = $3, response_body = $4, in_flight = false, state = 'done', updated_at = now()
     WHERE user_id = $1 AND key = $2`,
    [userId, key, status, body],
  );
}

/** Clear an in-flight marker after an unexpected failure, so retries can run. */
export async function release(pool: PgPool, userId: string, key: string): Promise<void> {
  await pool.query(`DELETE FROM idempotency WHERE user_id = $1 AND key = $2 AND in_flight = true`, [userId, key]);
}
