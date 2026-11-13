import { createHash } from 'node:crypto';
import { config } from '../config';
import { one, query } from '../db';
import { ApiError, validation } from '../errors';
import { FIELD } from '../../shared/copy';

/** The one place idempotency replay and conflict are decided. */

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export type Replay = { kind: 'replay'; status: number; body: string };
export type Proceed = { kind: 'proceed' };
export type IdempotencyOutcome = Replay | Proceed;

export interface IdempotencyScope {
  /** The caller: a staff user, or a player within a game. */
  scope: string;
  route: string;
  key: string;
}

/**
 * The fingerprint is the route, the thread id (for replies), and the JSON
 * values `body` and `topic` exactly as submitted. An absent value counts as absent.
 */
export function fingerprint(route: string, threadId: string | null, payload: Record<string, unknown>): string {
  const parts = [
    route,
    threadId ?? null,
    'body' in payload ? JSON.stringify(payload.body ?? null) : '\u0000absent',
    'topic' in payload ? JSON.stringify(payload.topic ?? null) : '\u0000absent',
  ];
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

interface KeyRow {
  fingerprint: string;
  state: string;
  status_code: number | null;
  response_body: string | null;
  completed_at: Date | null;
}

export async function begin(target: IdempotencyScope, print: string): Promise<IdempotencyOutcome> {
  if (!KEY_PATTERN.test(target.key)) throw validation({ idempotency_key: FIELD.idempotencyKey });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const inserted = await one<{ key: string }>(
      `INSERT INTO idempotency_keys (scope, route, key, fingerprint, state)
         VALUES ($1, $2, $3, $4, 'in_progress')
         ON CONFLICT (scope, route, key) DO NOTHING
         RETURNING key`,
      [target.scope, target.route, target.key, print],
    );
    if (inserted) return { kind: 'proceed' };
    const existing = await one<KeyRow>(
      `SELECT fingerprint, state, status_code, response_body, completed_at
         FROM idempotency_keys WHERE scope = $1 AND route = $2 AND key = $3`,
      [target.scope, target.route, target.key],
    );
    if (!existing) continue;
    if (
      existing.state === 'completed' &&
      existing.completed_at !== null &&
      existing.completed_at.getTime() + config.idempotencyKeyTtlSeconds * 1000 < Date.now()
    ) {
      await query(
        `DELETE FROM idempotency_keys WHERE scope = $1 AND route = $2 AND key = $3 AND state = 'completed'`,
        [target.scope, target.route, target.key],
      );
      continue;
    }
    if (existing.fingerprint !== print) throw new ApiError(422, 'idempotency_mismatch');
    if (existing.state === 'completed') {
      return { kind: 'replay', status: existing.status_code ?? 201, body: existing.response_body ?? 'null' };
    }
    throw new ApiError(409, 'idempotency_in_progress');
  }
  throw new ApiError(409, 'idempotency_in_progress');
}

export async function complete(
  target: IdempotencyScope,
  status: number,
  body: unknown,
): Promise<void> {
  await query(
    `UPDATE idempotency_keys
        SET state = 'completed', status_code = $4, response_body = $5, completed_at = now()
      WHERE scope = $1 AND route = $2 AND key = $3`,
    [target.scope, target.route, target.key, status, JSON.stringify(body)],
  );
}

export async function release(target: IdempotencyScope): Promise<void> {
  await query(
    `DELETE FROM idempotency_keys WHERE scope = $1 AND route = $2 AND key = $3 AND state = 'in_progress'`,
    [target.scope, target.route, target.key],
  );
}
