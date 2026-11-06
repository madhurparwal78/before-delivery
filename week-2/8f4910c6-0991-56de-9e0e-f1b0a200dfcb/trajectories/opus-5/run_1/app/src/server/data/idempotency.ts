import { createHash } from 'node:crypto';
import { query, queryOne } from '../db.js';
import { idempotencyKeyReused } from '../http/errors.js';

export type StoredReply = { status: number; body: string };

export type IdempotencyOutcome =
  | { kind: 'fresh' }
  | { kind: 'replay'; reply: StoredReply };

type KeyRow = { request_hash: string; response_status: number | null; response_body: string | null };

export function requestHash(method: string, path: string, rawBody: Buffer): string {
  return createHash('sha256').update(method).update('\n').update(path).update('\n').update(rawBody).digest('hex');
}

/** Claims the key for this request, or reports the stored reply of a replay. */
export async function claimKey(
  memberId: string,
  key: string,
  hash: string,
): Promise<IdempotencyOutcome> {
  const inserted = await query(
    `INSERT INTO idempotency_keys (member_id, idem_key, request_hash)
     VALUES ($1, $2, $3) ON CONFLICT (member_id, idem_key) DO NOTHING RETURNING idem_key`,
    [memberId, key, hash],
  );
  if (inserted.length > 0) return { kind: 'fresh' };

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const row = await queryOne<KeyRow>(
      'SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE member_id = $1 AND idem_key = $2',
      [memberId, key],
    );
    if (!row) return { kind: 'fresh' };
    if (row.request_hash !== hash) throw idempotencyKeyReused();
    if (row.response_status !== null && row.response_body !== null) {
      return { kind: 'replay', reply: { status: row.response_status, body: row.response_body } };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { kind: 'fresh' };
}

export async function storeReply(
  memberId: string,
  key: string,
  reply: StoredReply,
): Promise<void> {
  await query(
    'UPDATE idempotency_keys SET response_status = $3, response_body = $4 WHERE member_id = $1 AND idem_key = $2',
    [memberId, key, reply.status, reply.body],
  );
}

/** A dependency outage leaves nothing stored, so the request can be retried. */
export async function releaseKey(memberId: string, key: string): Promise<void> {
  await query(
    'DELETE FROM idempotency_keys WHERE member_id = $1 AND idem_key = $2 AND response_status IS NULL',
    [memberId, key],
  );
}
