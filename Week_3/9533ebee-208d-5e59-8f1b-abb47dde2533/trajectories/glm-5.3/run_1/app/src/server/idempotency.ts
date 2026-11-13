import { createHash } from 'node:crypto';
import type { Pool, Tx } from './db.js';
import { problem } from './problems.js';

export interface StoredResponse {
  status: number;
  body: unknown;
}

/** Canonical fingerprint of a parsed JSON body, ignoring key order and whitespace. */
export function fingerprint(body: unknown): string {
  return createHash('sha256').update(canonicalJson(body)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]): boolean => v !== undefined)
    .sort(([a], [b]): number => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]): string => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function validKey(key: string | undefined): boolean {
  if (key === undefined || key.length < 1 || key.length > 128) return false;
  return /^[\x21-\x7E]+$/.test(key);
}

/**
 * Begin a keyed request: returns a stored replay when the key was used before,
 * otherwise reserves the key for the caller's transaction.
 */
export async function beginKeyed(
  db: Pool,
  actorId: string,
  endpoint: string,
  key: string,
  body: unknown,
): Promise<StoredResponse | null> {
  const fp = fingerprint(body);
  return db.transaction(async (tx): Promise<StoredResponse | null> => {
    const existing = await tx.query<{ status: number; response_body: unknown; body_fingerprint: string }>(
      'SELECT status, response_body, body_fingerprint FROM idempotency_keys WHERE actor_id = $1 AND endpoint = $2 AND idem_key = $3 FOR UPDATE',
      [actorId, endpoint, key],
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      if (row.body_fingerprint !== fp) {
        throw problem(409, 'idempotency_key_reused', 'This Idempotency-Key was already used with a different request.');
      }
      if (row.status >= 500) return null;
      return { status: row.status, body: row.response_body };
    }
    await tx.query(
      'INSERT INTO idempotency_keys (actor_id, endpoint, idem_key, body_fingerprint, status, response_body) VALUES ($1, $2, $3, $4, 0, NULL)',
      [actorId, endpoint, key, fp],
    );
    return null;
  });
}

/** Store the response of a keyed request in its own short transaction. */
export async function storeResponse(db: import('./db.js').Pool, actorId: string, endpoint: string, key: string, status: number, body: unknown): Promise<void> {
  await db.transaction(async (tx): Promise<void> => {
    await tx.query(
      'UPDATE idempotency_keys SET status = $1, response_body = $2 WHERE actor_id = $3 AND endpoint = $4 AND idem_key = $5 AND status = 0',
      [status, JSON.stringify(body), actorId, endpoint, key],
    );
  });
}

/** Release a reserved key after a 5xx so a retry runs fresh. */
export async function releaseKey(db: Pool, actorId: string, endpoint: string, key: string): Promise<void> {
  await db.withClient(async (client): Promise<void> => {
    await client.query(
      'DELETE FROM idempotency_keys WHERE actor_id = $1 AND endpoint = $2 AND idem_key = $3 AND status = 0',
      [actorId, endpoint, key],
    );
  }).catch((): void => undefined);
}
