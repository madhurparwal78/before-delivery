import type { Queryable } from '../db/pool.js';
import { withTransaction } from '../db/pool.js';
import { idempotencyKeyReused } from '../http/errors.js';

export interface StoredResponse {
  status: number;
  body: unknown;
}

/**
 * Runs the work once per key. A replay of the same key with the same request returns the
 * stored response; a replay with anything different is refused. Work that throws rolls the
 * claim back, so a failed request's key can be used again.
 */
export async function runIdempotent(
  scope: string,
  key: string | null,
  fingerprint: string,
  work: (db: Queryable) => Promise<StoredResponse>,
): Promise<StoredResponse> {
  if (key === null) return await withTransaction(work);

  return await withTransaction(async (db) => {
    const claim = await db.query(
      `INSERT INTO idempotency_records (scope, key, fingerprint)
       VALUES ($1, $2, $3) ON CONFLICT (scope, key) DO NOTHING`,
      [scope, key, fingerprint],
    );
    if (claim.rowCount === 1) {
      const result = await work(db);
      await db.query(
        `UPDATE idempotency_records SET status_code = $3, response_body = $4::jsonb
          WHERE scope = $1 AND key = $2`,
        [scope, key, result.status, JSON.stringify(result.body)],
      );
      return result;
    }

    const stored = await db.query<{ fingerprint: string; status_code: number | null; response_body: unknown }>(
      `SELECT fingerprint, status_code, response_body FROM idempotency_records
        WHERE scope = $1 AND key = $2 FOR UPDATE`,
      [scope, key],
    );
    const record = stored.rows[0];
    if (!record || record.fingerprint !== fingerprint) throw idempotencyKeyReused();
    if (record.status_code === null) throw new Error(`idempotency record ${scope}/${key} has no stored response`);
    return { status: record.status_code, body: record.response_body };
  });
}
