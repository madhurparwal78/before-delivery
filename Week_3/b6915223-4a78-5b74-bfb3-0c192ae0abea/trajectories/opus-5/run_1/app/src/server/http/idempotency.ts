import { createHash } from 'node:crypto';
import { one, pool, query } from '../db.ts';

export const KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
};

/** A body fingerprint that ignores key order and whitespace. */
export const stableHash = (body: unknown): string =>
  createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex');

export interface StoredResponse {
  body_hash: string;
  response_status: number;
  response_body: unknown;
}

export const storedResponse = (
  managerId: string,
  key: string,
): Promise<StoredResponse | undefined> =>
  one<StoredResponse>(
    pool,
    `select body_hash, response_status, response_body from idempotency_keys
      where manager_id = $1 and key = $2`,
    [managerId, key],
  );

export const storeResponse = async (
  managerId: string,
  key: string,
  hash: string,
  status: number,
  body: unknown,
): Promise<void> => {
  await query(
    pool,
    `insert into idempotency_keys
       (manager_id, key, body_hash, response_status, response_body)
     values ($1, $2, $3, $4, $5::jsonb)
     on conflict (manager_id, key) do nothing`,
    [managerId, key, hash, status, JSON.stringify(body)],
  );
};
