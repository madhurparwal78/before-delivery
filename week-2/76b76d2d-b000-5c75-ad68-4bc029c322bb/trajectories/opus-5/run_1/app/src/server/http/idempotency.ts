import { createHash } from 'node:crypto';
import { one, query } from '../db/pool.ts';
import { ApiError } from './errors.ts';

export type Replay = { status: number; body: unknown };

export function bodyHash(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export async function claimKey(input: {
  key: string;
  caller: string;
  endpoint: string;
  hash: string;
}): Promise<Replay | null> {
  const inserted = await query<{ key: string }>(
    `insert into idempotency_keys(key, caller, endpoint, body_hash, state)
       values($1,$2,$3,$4,'in_progress') on conflict (key) do nothing returning key`,
    [input.key, input.caller, input.endpoint, input.hash],
  );
  if (inserted.length === 1) return null;
  const existing = await one<{
    caller: string;
    endpoint: string;
    body_hash: string;
    state: string;
    status: number | null;
    response: unknown;
  }>('select caller, endpoint, body_hash, state, status, response from idempotency_keys where key = $1', [input.key]);
  if (existing === null) throw new ApiError('idempotency_in_progress');
  if (existing.state === 'done' && existing.body_hash === input.hash && existing.caller === input.caller && existing.endpoint === input.endpoint) {
    return { status: existing.status ?? 200, body: existing.response };
  }
  if (existing.body_hash !== input.hash || existing.caller !== input.caller || existing.endpoint !== input.endpoint) {
    throw new ApiError('idempotency_conflict');
  }
  throw new ApiError('idempotency_in_progress');
}

export async function finishKey(key: string, status: number, body: unknown): Promise<void> {
  await query(`update idempotency_keys set state='done', status=$2, response=$3 where key = $1`, [
    key,
    status,
    JSON.stringify(body),
  ]);
}

export async function releaseKey(key: string): Promise<void> {
  await query(`delete from idempotency_keys where key = $1 and state = 'in_progress'`, [key]);
}

export async function purgeOldKeys(): Promise<void> {
  await query("delete from idempotency_keys where created_at < now() - interval '24 hours'");
}
