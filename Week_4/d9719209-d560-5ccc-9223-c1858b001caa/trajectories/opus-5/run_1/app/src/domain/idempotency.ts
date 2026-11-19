import { one, transaction, type Queryable } from '../core/db.js';
import { errors } from '../core/errors.js';
import { sha256Hex } from '../core/crypto.js';
import { copy } from '../shared/copy.js';

export interface StoredResponse {
  status: number;
  body: unknown;
}

export interface IdempotentOutcome<T> {
  status: number;
  body: unknown;
  created: T | null;
  replayed: boolean;
}

/**
 * Keys are scoped to the member and the endpoint and kept in Postgres. The claim row is inserted in
 * the same transaction as the creation it guards, so a concurrent replay waits for the first
 * request to commit and then returns its stored response instead of creating a second row.
 */
export async function withIdempotency<T>(
  memberId: string,
  endpoint: string,
  key: string,
  body: unknown,
  create: (tx: Queryable) => Promise<{ status: number; body: unknown; created: T }>,
): Promise<IdempotentOutcome<T>> {
  const bodyHash = sha256Hex(JSON.stringify(body ?? null));

  return transaction(async (tx) => {
    const claim = await tx.query(
      `insert into idempotency_keys (member_id, endpoint, key, body_hash)
       values ($1, $2, $3, $4) on conflict (member_id, endpoint, key) do nothing`,
      [memberId, endpoint, key, bodyHash],
    );

    if (claim.rowCount === 0) {
      const stored = await one<{ body_hash: string; status: number | null; response: unknown }>(
        tx,
        'select body_hash, status, response from idempotency_keys where member_id = $1 and endpoint = $2 and key = $3',
        [memberId, endpoint, key],
      );
      if (!stored || stored.body_hash !== bodyHash) {
        throw errors.validation(copy.validation.idempotencyReused, {
          idempotencyKey: copy.validation.idempotencyReused,
        });
      }
      return { status: Number(stored.status), body: stored.response, created: null, replayed: true };
    }

    const result = await create(tx);
    await tx.query(
      'update idempotency_keys set status = $4, response = $5 where member_id = $1 and endpoint = $2 and key = $3',
      [memberId, endpoint, key, result.status, JSON.stringify(result.body)],
    );
    return { status: result.status, body: result.body, created: result.created, replayed: false };
  });
}
