/** Idempotency-Key semantics shared by routes that create something once (adapted from kit/modules/idempotency). */
import { createHash } from 'node:crypto';
import { now } from './clock';
import type { Queryable } from './db';
import { fail, json, type Reply } from './http';
import { MESSAGES } from '../shared/messages';

function canonicalJson(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const fingerprint = (method: string, path: string, body: unknown): string =>
  createHash('sha256').update(`${method}\n${path}\n${canonicalJson(body)}`).digest('hex');

/**
 * Inside the transaction that does the work: takes the (scope, key) lock, so concurrent requests with one key queue,
 * and returns the stored reply when the key was already used with the same body (null on first use).
 * The same key with a different body is a 409.
 */
export async function storedReply(client: Queryable, scope: string, key: string, requestHash: string): Promise<Reply | null> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${scope}\n${key}`]);
  const stored = (
    await client.query<{ request_hash: string; status: number; response: unknown }>(
      'SELECT request_hash, status, response FROM idempotency WHERE scope = $1 AND key = $2',
      [scope, key],
    )
  ).rows[0];
  if (!stored) return null;
  if (stored.request_hash !== requestHash) return fail(409, 'idempotency_conflict', MESSAGES.idempotencyConflict);
  return json(stored.status, stored.response);
}

/** Records the successful reply in the same transaction as the work it answers, so a retry can never repeat it. */
export async function rememberReply(client: Queryable, scope: string, key: string, requestHash: string, reply: Reply): Promise<void> {
  await client.query('INSERT INTO idempotency (scope, key, request_hash, status, response, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [
    scope,
    key,
    requestHash,
    reply.status,
    JSON.stringify(reply.body),
    await now(client),
  ]);
}
