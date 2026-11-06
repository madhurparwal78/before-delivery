import { queryOne, type Transaction } from '../db/pool.ts';
import { conflict } from '../http/errors.ts';
import { sha256Hex } from '../services/crypto.ts';

export interface StoredResponse {
  status: number;
  body: unknown;
}

interface RecordRow {
  body_fingerprint: string;
  status: number;
  response: unknown;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
}

export function fingerprint(body: unknown): string {
  return sha256Hex(canonical(body));
}

/**
 * Step 10 of the error ladder: a replay with the same key and an equal body returns the stored
 * response, while the same key with a different body is refused.
 */
export async function replayOf(
  scope: string,
  key: string,
  bodyFingerprint: string,
): Promise<StoredResponse | null> {
  const row = await queryOne<RecordRow>(
    'select body_fingerprint, status, response from idempotency_records where scope = $1 and key = $2',
    [scope, key],
  );
  if (row === null) return null;
  if (row.body_fingerprint !== bodyFingerprint) throw conflict('idempotency_key_reused');
  return { status: row.status, body: row.response };
}

export async function storeResponse(
  tx: Transaction,
  scope: string,
  key: string,
  bodyFingerprint: string,
  stored: StoredResponse,
  nowMs: number,
): Promise<void> {
  await tx.query(
    `insert into idempotency_records (scope, key, body_fingerprint, status, response, created_at_ms)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (scope, key) do nothing`,
    [scope, key, bodyFingerprint, stored.status, stored.body, nowMs],
  );
}
