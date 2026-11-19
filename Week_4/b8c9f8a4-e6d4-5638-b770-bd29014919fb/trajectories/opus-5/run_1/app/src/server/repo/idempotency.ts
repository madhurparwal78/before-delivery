import { createHash } from 'node:crypto';
import { transaction, type Tx } from '../db';
import { refuse, validationFailure } from '../domain/errors';

export interface StoredReply {
  status: number;
  response: unknown;
}

const hashBody = (body: unknown): string => createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');

/** Keys are 1 to 128 characters, and a missing one is a validation failure. */
export const requireIdempotencyKey = (header: string | undefined): string => {
  if (header === undefined || header.length < 1 || header.length > 128) {
    throw validationFailure({ 'Idempotency-Key': 'Send an Idempotency-Key of 1 to 128 characters' });
  }
  return header;
};

export const findStoredReply = async (tx: Tx, scope: string, key: string, body: unknown): Promise<StoredReply | null> => {
  const row = await tx.queryOne<{ body_hash: string; status: number; response: unknown }>(
    'SELECT body_hash, status, response FROM idempotency WHERE scope = $1 AND key = $2',
    [scope, key],
  );
  if (row === null) return null;
  if (row.body_hash !== hashBody(body)) {
    throw refuse(409, 'idempotency_conflict', 'That key was used with a different body');
  }
  return { status: row.status, response: row.response };
};

/** Only success responses are stored. */
export const storeReply = async (
  tx: Tx,
  scope: string,
  key: string,
  body: unknown,
  status: number,
  response: unknown,
): Promise<void> => {
  await tx.query(
    `INSERT INTO idempotency (scope, key, body_hash, status, response)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (scope, key) DO NOTHING`,
    [scope, key, hashBody(body), status, JSON.stringify(response)],
  );
};

/**
 * Runs an idempotent write. The same key with the same body returns the stored
 * response with no new effect, including when two requests arrive at once.
 */
export const withIdempotency = async <T>(
  scope: string,
  key: string,
  body: unknown,
  work: (tx: Tx) => Promise<{ status: number; response: T }>,
): Promise<{ status: number; response: T; replayed: boolean }> =>
  transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [scope, key]);
    const stored = await findStoredReply(tx, scope, key, body);
    if (stored !== null) return { status: stored.status, response: stored.response as T, replayed: true };
    const result = await work(tx);
    await storeReply(tx, scope, key, body, result.status, result.response);
    return { ...result, replayed: false };
  });
