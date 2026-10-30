import { createHash } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { int, one, type Queryable } from '../db';
import { apiError } from '../http/errors';
import { FieldErrors } from '../http/validate';

export interface StoredResponse {
  status: number;
  body: unknown;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort((left, right) =>
    left[0] < right[0] ? -1 : 1,
  );
  return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonical(inner)}`).join(',')}}`;
}

export function hashRequestBody(body: unknown): string {
  return createHash('sha256').update(canonical(body)).digest('hex');
}

export function requireIdempotencyKey(headers: IncomingHttpHeaders): string {
  const raw = headers['idempotency-key'];
  const key = typeof raw === 'string' ? raw.trim() : '';
  const fields = new FieldErrors();
  if (key.length < 1 || key.length > 100) {
    fields.add('Idempotency-Key', 'Send an Idempotency-Key of 1 to 100 characters');
  }
  fields.throwIfAny();
  return key;
}

/** The stored answer for a replayed key, or null when the key is new. */
export async function replayResponse(
  client: Queryable,
  scope: string,
  key: string,
  requestHash: string,
): Promise<StoredResponse | null> {
  const row = await one(
    client,
    'select request_hash, response_status, response_body from idempotency_keys where scope = $1 and key = $2',
    [scope, key],
  );
  if (row === null) return null;
  if (row.request_hash !== requestHash) throw apiError.idempotencyKeyReused();
  return { status: int(row.response_status), body: row.response_body };
}

export async function storeResponse(
  client: Queryable,
  scope: string,
  key: string,
  requestHash: string,
  response: StoredResponse,
): Promise<void> {
  await client.query(
    `insert into idempotency_keys (scope, key, request_hash, response_status, response_body)
     values ($1,$2,$3,$4,$5::jsonb) on conflict (scope, key) do nothing`,
    [scope, key, requestHash, response.status, JSON.stringify(response.body)],
  );
}
