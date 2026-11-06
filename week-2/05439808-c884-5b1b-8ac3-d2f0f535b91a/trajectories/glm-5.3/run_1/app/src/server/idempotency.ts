// Idempotency for start-raid, deploy and finalize. Keys are scoped to the account plus method and
// path; the first response with a status below 500 is stored against the key and the request body,
// compared as parsed JSON.
import type { PoolClient } from 'pg';
import { errors } from './errors.ts';

const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

export interface StoredResponse {
  status: number;
  body: unknown;
  replayed: boolean;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

// Called inside the request's transaction, after 404/403 checks. Returns a stored response to
// replay, or null to run the handler (which must then call storeResponse on success).
export async function beginIdempotency(
  client: PoolClient,
  accountId: number,
  method: string,
  path: string,
  key: string | undefined,
  body: unknown
): Promise<StoredResponse | null> {
  if (key === undefined || !KEY_RE.test(key)) {
    throw errors.validation({ 'Idempotency-Key': 'Send an Idempotency-Key of 8 to 64 letters, digits, hyphens or underscores.' });
  }
  const inserted = await client.query(
    `INSERT INTO idempotency (account_id, method, path, key, body, status, response, created_at)
     VALUES ($1, $2, $3, $4, $5, 0, 'null'::jsonb, $6) ON CONFLICT DO NOTHING`,
    [accountId, method, path, key, JSON.stringify(body ?? null), Date.now()]
  );
  if (inserted.rowCount === 1) return null; // first use of this key; the handler will store the response
  const existing = await client.query<{ body: unknown; status: number; response: unknown }>(
    'SELECT body, status, response FROM idempotency WHERE account_id = $1 AND method = $2 AND path = $3 AND key = $4',
    [accountId, method, path, key]
  );
  const row = existing.rows[0];
  if (stableStringify(row.body) !== stableStringify(body ?? null)) {
    throw errors.conflict('idempotency_key_reused', 'This key was used with a different request.');
  }
  if (row.status >= 200 && row.status < 500) {
    return { status: row.status, body: row.response, replayed: true };
  }
  // A previous attempt stored nothing (it failed with 500 or above); run again.
  return null;
}

export async function storeResponse(
  client: PoolClient,
  accountId: number,
  method: string,
  path: string,
  key: string,
  body: unknown,
  status: number,
  response: unknown
): Promise<void> {
  await client.query(
    'UPDATE idempotency SET status = $5, response = $6 WHERE account_id = $1 AND method = $2 AND path = $3 AND key = $4',
    [accountId, method, path, key, status, JSON.stringify(response ?? null)]
  );
}

// Responses of 500 and above are not stored, so a retry runs again.
export async function clearFailedIdempotency(
  client: PoolClient,
  accountId: number,
  method: string,
  path: string,
  key: string
): Promise<void> {
  await client.query('DELETE FROM idempotency WHERE account_id = $1 AND method = $2 AND path = $3 AND key = $4 AND status = 0', [
    accountId, method, path, key,
  ]);
}
