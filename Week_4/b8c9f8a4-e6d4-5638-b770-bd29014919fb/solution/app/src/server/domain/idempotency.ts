// Idempotency-Key handling, shared by offers, slot claims and acceptance.
// Adapted from kit/modules/idempotency: a stored success is returned before any later check,
// the same key with a different body is a conflict, and two identical requests that arrive
// together make one record.

import { createHash } from 'node:crypto';
import { one } from '../db/pool.js';
import { fail } from '../http/errors.js';

interface Stored {
  status: number;
  response: unknown;
}

export function requireKey(header: string | string[] | undefined): string {
  const key = Array.isArray(header) ? header[0] : header;
  if (!key || key.length > 128) {
    fail(422, 'validation', 'An Idempotency-Key is needed.', {
      errors: { 'Idempotency-Key': 'Send an Idempotency-Key of 1 to 128 characters.' },
    });
  }
  return key;
}

export function bodyHash(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
}

/** A stored success for this scope and key, or a conflict when the body differs. */
export async function replayOf(scope: string, key: string, hash: string): Promise<Stored | null> {
  const row = await one<{ body_hash: string; status: number; response: unknown }>(
    'SELECT body_hash, status, response FROM idempotency WHERE scope = $1 AND key = $2',
    [scope, key],
  );
  if (!row) return null;
  if (row.body_hash !== hash) fail(409, 'idempotency_conflict', 'That key was used with a different body.');
  return { status: row.status, response: row.response };
}

/**
 * Keeps a success. When two identical requests arrive at the same moment the loser finds the
 * winner's row and returns it, so only one record is ever made.
 */
export async function keepSuccess(
  scope: string,
  key: string,
  hash: string,
  status: number,
  response: unknown,
): Promise<Stored> {
  const row = await one<{ body_hash: string; status: number; response: unknown }>(
    `INSERT INTO idempotency (scope, key, body_hash, status, response) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (scope, key) DO NOTHING
     RETURNING body_hash, status, response`,
    [scope, key, hash, status, JSON.stringify(response)],
  );
  if (row) return { status: row.status, response };
  // the conflicting row was written by the winner, and idempotency rows are never deleted
  return (await replayOf(scope, key, hash)) as Stored;
}
