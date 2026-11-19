import { createHash } from 'node:crypto';
import { one, query } from './db';
import { apiError } from './errors';

const KEY = /^[\x21-\x7e]{1,64}$/;

export interface StoredResponse {
  status: number;
  body: unknown;
}

export const idempotencyKey = (header: string | undefined): string | null =>
  header && KEY.test(header) ? header : null;

const bodyHash = (body: unknown): string =>
  createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');

/** Replays a stored 201, or refuses the same key used with a different body. */
export const replayIdempotent = async (
  userId: string,
  route: string,
  key: string,
  body: unknown,
): Promise<StoredResponse | null> => {
  const row = await one<{ body_hash: string; status: number; response: unknown }>(
    `select body_hash, status, response from idempotency
      where user_id = $1 and route = $2 and key = $3 and created_at > now() - interval '24 hours'`,
    [userId, route, key],
  );
  if (!row) return null;
  if (row.body_hash !== bodyHash(body)) throw apiError('idempotency_conflict');
  return { status: row.status, body: row.response };
};

export const storeIdempotent = async (
  userId: string,
  route: string,
  key: string,
  body: unknown,
  response: StoredResponse,
): Promise<void> => {
  await query(
    `insert into idempotency (user_id, route, key, body_hash, status, response)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (user_id, route, key) do nothing`,
    [userId, route, key, bodyHash(body), response.status, JSON.stringify(response.body)],
  );
};
