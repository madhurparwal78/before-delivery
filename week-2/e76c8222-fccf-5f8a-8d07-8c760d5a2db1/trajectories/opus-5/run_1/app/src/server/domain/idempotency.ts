import { createHash } from 'node:crypto';
import { pool, queryOne } from '../db/pool';
import { fail } from '../http/errors';

export type IdempotentAction = 'cancel' | 'timesheet.submit' | 'timesheet.approve';

export interface IdempotentResult {
  status: number;
  body: unknown;
  replayed: boolean;
}

const WAIT_STEP_MS = 100;
const WAIT_ROUNDS = 100;

/** Two bodies are the same when they parse to equal JSON values. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}

export function bodyHash(body: unknown): string {
  return createHash('sha256').update(canonical(body)).digest('hex');
}

export function readIdempotencyKey(header: unknown): string {
  if (typeof header !== 'string') throw fail('idempotency_key_required');
  const key = header.trim();
  if (key.length < 1 || key.length > 128 || !/^[\x20-\x7e]+$/.test(key)) {
    throw fail('idempotency_key_required');
  }
  return key;
}

interface RecordRow {
  state: 'running' | 'done';
  body_hash: string;
  status_code: number | null;
  response_body: unknown;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs an action under its idempotency key: only successes are stored, a repeated key
 * with the same body replays them, and a different body conflicts.
 */
export async function runIdempotent(
  scope: { userId: string; action: IdempotentAction; targetId: string; key: string; body: unknown },
  run: () => Promise<{ status: number; body: unknown }>,
): Promise<IdempotentResult> {
  const hash = bodyHash(scope.body);
  const params = [scope.userId, scope.action, scope.targetId, scope.key];

  for (let round = 0; round < WAIT_ROUNDS; round += 1) {
    const claimed = await queryOne<{ claimed: boolean }>(
      pool,
      `insert into idempotency_records (user_id, action, target_id, key, body_hash, state)
       values ($1, $2, $3, $4, $5, 'running')
       on conflict (user_id, action, target_id, key) do nothing
       returning true as claimed`,
      [...params, hash],
    );

    if (claimed) {
      try {
        const outcome = await run();
        await pool.query(
          `update idempotency_records
             set state = 'done', status_code = $5, response_body = $6::jsonb
           where user_id = $1 and action = $2 and target_id = $3 and key = $4`,
          [...params, outcome.status, JSON.stringify(outcome.body)],
        );
        return { ...outcome, replayed: false };
      } catch (error) {
        await pool.query(
          `delete from idempotency_records
           where user_id = $1 and action = $2 and target_id = $3 and key = $4`,
          params,
        );
        throw error;
      }
    }

    const existing = await queryOne<RecordRow>(
      pool,
      `select state, body_hash, status_code, response_body from idempotency_records
       where user_id = $1 and action = $2 and target_id = $3 and key = $4`,
      params,
    );
    if (!existing) continue;
    if (existing.state === 'done') {
      if (existing.body_hash !== hash) throw fail('idempotency_conflict');
      return {
        status: existing.status_code ?? 200,
        body: existing.response_body,
        replayed: true,
      };
    }
    await sleep(WAIT_STEP_MS);
  }
  throw fail('idempotency_conflict');
}
