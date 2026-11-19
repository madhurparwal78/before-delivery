import { AppError } from '../errors.js';
import { config } from '../config.js';
import type { Tx } from './db.js';

export interface IdemStored {
  status: number;
  body: unknown;
}

const KEY_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function validKey(key: string | undefined): boolean {
  return typeof key === 'string' && KEY_RE.test(key);
}

export async function hashBody(body: string): Promise<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = body;
  }
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(JSON.stringify(parsed)).digest('hex');
}

export interface IdemOutcome {
  replay: IdemStored;
  inProgress: boolean;
}

/**
 * Looks up the idempotency record. Caller must finish() on a miss.
 * The row lock serialises concurrent requests with the same key.
 */
export async function idemLookup(tx: Tx, userKey: string, method: string, path: string, key: string, requestBody: string): Promise<IdemOutcome | null> {
  const stored = await tx.one<{ request_hash: string; status: number; body: unknown; in_progress: boolean }>(
    `SELECT request_hash, status, body, in_progress FROM idempotency
     WHERE user_key = $1 AND path = $2 AND idem_key = $3 AND created_at > now() - ($4 || ' seconds')::interval
     FOR UPDATE`,
    [userKey, `${method} ${path}`, key, String(config.idempotencyTtlSeconds)]
  );
  if (!stored) return null;
  const hash = await hashBody(requestBody);
  if (stored.request_hash !== hash) {
    throw new AppError(409, 'idempotency_key_reused', 'That idempotency key was used for a different request.');
  }
  if (stored.in_progress) {
    return { replay: { status: stored.status, body: stored.body }, inProgress: true };
  }
  return { replay: { status: stored.status, body: stored.body }, inProgress: false };
}

export async function idemBegin(tx: Tx, userKey: string, method: string, path: string, key: string, requestBody: string): Promise<void> {
  const hash = await hashBody(requestBody);
  await tx.query(
    `INSERT INTO idempotency (user_key, path, idem_key, request_hash, status, body, in_progress)
     VALUES ($1, $2, $3, $4, 0, 'null'::jsonb, true)
     ON CONFLICT (user_key, path, idem_key) DO NOTHING`,
    [userKey, `${method} ${path}`, key, hash]
  );
}

export async function idemFinish(tx: Tx, userKey: string, method: string, path: string, key: string, status: number, body: unknown): Promise<void> {
  await tx.query(
    `UPDATE idempotency SET status = $4, body = $5::jsonb, in_progress = false
     WHERE user_key = $1 AND path = $2 AND idem_key = $3`,
    [userKey, `${method} ${path}`, key, status, JSON.stringify(body)]
  );
}

export async function idemFail(tx: Tx, userKey: string, method: string, path: string, key: string): Promise<void> {
  await tx.query(
    `DELETE FROM idempotency WHERE user_key = $1 AND path = $2 AND idem_key = $3 AND in_progress = true`,
    [userKey, `${method} ${path}`, key]
  );
}
