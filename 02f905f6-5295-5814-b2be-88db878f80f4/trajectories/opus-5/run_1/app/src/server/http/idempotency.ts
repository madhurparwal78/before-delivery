import { query, queryOne } from '../db/pool';

export interface StoredReply {
  status: number;
  body: unknown;
}

interface KeyRow {
  body_hash: string;
  state: 'running' | 'done';
  status: number | null;
  response: unknown;
}

/**
 * Takes a key for this request, or reports what the first request with it did.
 * Keys are scoped to the signed-in user and shared across instances.
 */
export async function claimKey(
  userId: string,
  key: string,
  bodyHash: string,
): Promise<'claimed' | StoredReply | 'conflict' | 'in_progress'> {
  const claimed = await queryOne<KeyRow>(
    `insert into idempotency_keys (user_id, key, body_hash, state)
     values ($1, $2, $3, 'running')
     on conflict (user_id, key) do nothing
     returning body_hash, state, status, response`,
    [userId, key, bodyHash],
  );
  if (claimed) return 'claimed';

  const existing = await queryOne<KeyRow>(
    'select body_hash, state, status, response from idempotency_keys where user_id = $1 and key = $2',
    [userId, key],
  );
  if (!existing) return 'claimed';
  if (existing.body_hash !== bodyHash) return 'conflict';
  if (existing.state === 'running') return 'in_progress';
  return { status: existing.status ?? 200, body: existing.response };
}

export async function finishKey(
  userId: string,
  key: string,
  status: number,
  body: unknown,
): Promise<void> {
  await query(
    `update idempotency_keys set state = 'done', status = $3, response = $4::jsonb
     where user_id = $1 and key = $2`,
    [userId, key, status, JSON.stringify(body)],
  );
}

/** A 5xx is not stored, so the same key may be tried again. */
export async function forgetKey(userId: string, key: string): Promise<void> {
  await query("delete from idempotency_keys where user_id = $1 and key = $2 and state = 'running'", [
    userId,
    key,
  ]);
}
