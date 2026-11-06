import { createHash } from 'node:crypto';
import type { Db, Tx } from './db.ts';
import { ERRORS } from './errors.ts';

/**
 * Idempotency records, stored in Postgres and shared by every process.
 *
 * Flow: INSERT (claim) with ON CONFLICT DO NOTHING.
 * - inserted → this request is the first with this key; run the handler, then
 *   store the response (2xx only). A provider failure deletes the claim so the
 *   key can be retried with the same body.
 * - conflict → existing record: same body hash returns the stored response;
 *   a different body answers 409 idempotency_conflict; a failed attempt
 *   (no stored response) proceeds with the handler, still holding the claim
 *   so concurrent duplicates funnel into one effect.
 */
export interface IdemClaim {
  claimed: boolean;
  storedResponse: { status: number; body: string } | null;
  storedHash: string;
}

export function bodyHash(body: unknown): string {
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? null);
  return createHash('sha256').update(text).digest('hex');
}

export async function claimIdempotency(
  tx: Tx,
  userId: string,
  route: string,
  key: string,
  hash: string,
): Promise<IdemClaim> {
  const inserted = await tx.query(
    `INSERT INTO idempotency (user_id, route, key, request_hash, created_at)
     VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (user_id, route, key) DO NOTHING`,
    [userId, route, key, hash],
  );
  if (inserted.rowCount != null && inserted.rowCount > 0) {
    return { claimed: true, storedResponse: null, storedHash: hash };
  }
  const rows = await tx.query<{ request_hash: string; response_status: number | null; response_body: string | null }>(
    `SELECT request_hash, response_status, response_body FROM idempotency
     WHERE user_id = $1 AND route = $2 AND key = $3 FOR UPDATE`,
    [userId, route, key],
  );
  const row = rows.rows[0];
  if (!row) {
    // raced with a delete; treat as fresh claim
    await tx.query(
      `INSERT INTO idempotency (user_id, route, key, request_hash, created_at)
       VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (user_id, route, key) DO NOTHING`,
      [userId, route, key, hash],
    );
    return { claimed: true, storedResponse: null, storedHash: hash };
  }
  if (row.request_hash !== hash) {
    throw ERRORS.conflict('idempotency_conflict');
  }
  if (row.response_status !== null && row.response_body !== null) {
    return { claimed: false, storedResponse: { status: row.response_status, body: row.response_body }, storedHash: row.request_hash };
  }
  return { claimed: true, storedResponse: null, storedHash: row.request_hash };
}

export async function storeIdempotentResponse(
  tx: Tx,
  userId: string,
  route: string,
  key: string,
  status: number,
  body: string,
): Promise<void> {
  await tx.query(
    `UPDATE idempotency SET response_status = $4, response_body = $5
     WHERE user_id = $1 AND route = $2 AND key = $3`,
    [userId, route, key, status, body],
  );
}

export async function releaseIdempotencyClaim(
  tx: Tx,
  userId: string,
  route: string,
  key: string,
): Promise<void> {
  await tx.query(
    `DELETE FROM idempotency WHERE user_id = $1 AND route = $2 AND key = $3`,
    [userId, route, key],
  );
}

export async function purgeOldIdempotency(db: Db): Promise<void> {
  await db.query(
    `DELETE FROM idempotency WHERE created_at < now() - interval '30 days'`,
  );
}
