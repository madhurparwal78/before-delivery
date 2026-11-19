import { createHash } from 'node:crypto';
import { FIELD_MESSAGES } from '../../shared/copy';
import { query } from '../db';
import { type ApiResponse, error, validationError } from './respond';
import type { RequestContext } from './context';

const KEY_PATTERN = /^[\x21-\x7e]{1,100}$/;
const STORED_STATUSES = new Set([200, 201, 402]);
const WAIT_STEP_MS = 40;
const WAIT_LIMIT_MS = 20_000;

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}

interface RecordRow {
  path: string;
  body_hash: string;
  state: string;
  status: number | null;
  response: unknown;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Runs a keyed endpoint once per idempotency key. A repeat with the same key, path and body gets
 * the stored answer; a repeat with a different body or path is a conflict.
 */
export async function onceByKey(
  context: RequestContext,
  scope: string,
  run: () => Promise<ApiResponse>,
): Promise<ApiResponse> {
  const key = context.idempotencyKey;
  if (key === undefined || !KEY_PATTERN.test(key)) {
    return validationError({ idempotencyKey: FIELD_MESSAGES.idempotencyKey });
  }
  const path = context.url.pathname;
  const bodyHash = createHash('sha256')
    .update(canonical(context.body ?? null))
    .digest('hex');

  for (let waited = 0; waited <= WAIT_LIMIT_MS; waited += WAIT_STEP_MS) {
    const inserted = await query<{ scope: string }>(
      `insert into idempotency_records (scope, key, path, body_hash, state)
       values ($1, $2, $3, $4, 'in_progress')
       on conflict do nothing
       returning scope`,
      [scope, key, path, bodyHash],
    );
    if (inserted.length > 0) {
      try {
        const response = await run();
        if (STORED_STATUSES.has(response.status)) {
          await query(
            `update idempotency_records set state = 'completed', status = $3, response = $4
             where scope = $1 and key = $2`,
            [scope, key, response.status, JSON.stringify(response.body ?? null)],
          );
        } else {
          await query(`delete from idempotency_records where scope = $1 and key = $2`, [scope, key]);
        }
        return response;
      } catch (failure) {
        await query(`delete from idempotency_records where scope = $1 and key = $2`, [scope, key]);
        throw failure;
      }
    }
    const found = await query<RecordRow>(
      `select path, body_hash, state, status, response from idempotency_records where scope = $1 and key = $2`,
      [scope, key],
    );
    const existing = found[0];
    if (!existing) continue;
    if (existing.path !== path || existing.body_hash !== bodyHash) return error(409, 'idempotency_conflict');
    if (existing.state === 'completed') return { status: existing.status ?? 200, body: existing.response };
    await sleep(WAIT_STEP_MS);
  }
  return error(409, 'idempotency_conflict');
}
