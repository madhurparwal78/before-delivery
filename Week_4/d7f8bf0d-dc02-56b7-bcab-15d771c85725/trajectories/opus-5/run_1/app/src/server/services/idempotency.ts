import { createHash } from 'node:crypto';
import { pool } from '../db/pool.js';
import { ApiError, errors } from '../errors.js';
import { canonicalJson } from '../domain/hash.js';

export interface StoredResult {
  status: number;
  body: unknown;
}

function bodyHash(body: unknown): string {
  return createHash('sha256').update(canonicalJson(body ?? {}), 'utf8').digest('hex');
}

/**
 * Runs a write once for a key. A repeat with the same body returns the first
 * result, a repeat arriving while the first still runs waits for it, and the
 * same key with a different body is refused.
 */
export async function runOnce(
  scope: string,
  userId: string,
  key: string,
  body: unknown,
  work: () => Promise<StoredResult>,
): Promise<StoredResult> {
  const hash = bodyHash(body);
  const claim = await pool.query<{ claimed: boolean }>(
    `insert into idempotency (scope, user_id, key, body_hash) values ($1, $2, $3, $4)
     on conflict (scope, user_id, key) do nothing returning true as claimed`,
    [scope, userId, key, hash],
  );

  if (claim.rowCount === 0) {
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const { rows } = await pool.query<{
        body_hash: string;
        status: number | null;
        response: unknown;
        completed: boolean;
      }>(
        `select body_hash, status, response, completed from idempotency
         where scope = $1 and user_id = $2 and key = $3`,
        [scope, userId, key],
      );
      const row = rows[0];
      if (!row) break;
      if (row.body_hash !== hash) throw errors.idempotencyKeyReused();
      if (row.completed && row.status !== null) {
        return { status: row.status, body: row.response };
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw errors.staleRevision();
  }

  try {
    const result = await work();
    await pool.query(
      `update idempotency set status = $4, response = $5, completed = true
       where scope = $1 and user_id = $2 and key = $3`,
      [scope, userId, key, result.status, JSON.stringify(result.body)],
    );
    return result;
  } catch (error) {
    if (error instanceof ApiError && error.status === 422) {
      await pool.query(
        `update idempotency set status = $4, response = $5, completed = true
         where scope = $1 and user_id = $2 and key = $3`,
        [scope, userId, key, error.status, JSON.stringify(error.body())],
      );
      throw error;
    }
    await pool.query(`delete from idempotency where scope = $1 and user_id = $2 and key = $3`, [
      scope,
      userId,
      key,
    ]);
    throw error;
  }
}
