import { nowMs } from '../clock';
import { query, queryOne } from '../db';
import { ApiError, validationError } from '../http/errors';
import type { HandlerResult } from '../http/context';

const KEY_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

export function requireIdempotencyKey(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || !KEY_PATTERN.test(value)) {
    throw validationError({ 'Idempotency-Key': 'Send an Idempotency-Key of 1 to 100 characters.' });
  }
  return value;
}

export interface IdempotencyScope {
  actorUserId: string;
  key: string;
  method: string;
  path: string;
  binding: string;
}

interface RecordRow {
  state: string;
  method: string;
  path: string;
  binding: string;
  response_status: number | null;
  response_body: unknown;
}

/**
 * Holds, pack purchases and check-outs: a stored success replays before any rule or
 * contention check, and every refusal leaves the key free.
 */
export async function withIdempotency(
  scope: IdempotencyScope,
  run: () => Promise<HandlerResult>,
): Promise<HandlerResult> {
  const claimed = await query<{ id: string }>(
    `insert into idempotency_records (actor_user_id, key, method, path, binding, state, created_at)
     values ($1,$2,$3,$4,$5,'in_flight',$6)
     on conflict (actor_user_id, key) do nothing
     returning id`,
    [
      scope.actorUserId,
      scope.key,
      scope.method,
      scope.path,
      scope.binding,
      new Date(nowMs()).toISOString(),
    ],
  );
  if (claimed.length === 0) {
    const existing = await queryOne<RecordRow>(
      `select state, method, path, binding, response_status, response_body
         from idempotency_records where actor_user_id = $1 and key = $2`,
      [scope.actorUserId, scope.key],
    );
    if (existing === null) throw new ApiError('idempotency_in_progress');
    const sameRequest =
      existing.method === scope.method &&
      existing.path === scope.path &&
      existing.binding === scope.binding;
    if (!sameRequest) throw new ApiError('idempotency_conflict');
    if (existing.state === 'in_flight') throw new ApiError('idempotency_in_progress');
    return {
      status: existing.response_status ?? 200,
      body: existing.response_body,
      headers: { 'Idempotent-Replay': 'true' },
    };
  }
  try {
    const result = await run();
    if (result.status >= 200 && result.status < 300) {
      await query(
        `update idempotency_records set state = 'done', response_status = $3, response_body = $4
          where actor_user_id = $1 and key = $2`,
        [scope.actorUserId, scope.key, result.status, JSON.stringify(result.body ?? null)],
      );
    } else {
      await query('delete from idempotency_records where actor_user_id = $1 and key = $2', [
        scope.actorUserId,
        scope.key,
      ]);
    }
    return result;
  } catch (error) {
    await query('delete from idempotency_records where actor_user_id = $1 and key = $2', [
      scope.actorUserId,
      scope.key,
    ]);
    throw error;
  }
}
