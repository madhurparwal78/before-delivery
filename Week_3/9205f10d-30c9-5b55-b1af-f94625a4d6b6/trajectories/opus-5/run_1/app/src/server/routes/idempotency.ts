import { createHash } from 'node:crypto';
import { query, type Queryable } from '../db.js';
import { ApiError } from '../http/errors.js';
import type { JsonObject, JsonValue } from '../http/body.js';
import { json, type RouteResult } from '../http/context.js';

function canonical(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key] as JsonValue)}`).join(',')}}`;
}

export function bodyHash(body: JsonObject): string {
  return createHash('sha256').update(canonical(body)).digest('hex');
}

export interface IdempotentAction {
  key: string;
  endpoint: string;
  request_id: string;
  body_hash: string;
}

/**
 * Precedence step 6: replays the stored response for a repeated key, and refuses a key
 * reused for a different action.
 */
export async function replayOrReject(
  personId: string,
  action: IdempotentAction,
): Promise<RouteResult | null> {
  const stored = await query<{
    endpoint: string;
    request_id: string;
    body_hash: string;
    response_status: number;
    response_body: string;
  }>(
    `SELECT endpoint, request_id, body_hash, response_status, response_body
       FROM idempotency_keys WHERE person_id = $1 AND key = $2`,
    [personId, action.key],
  );
  const row = stored.rows[0];
  if (row === undefined) return null;
  if (
    row.endpoint !== action.endpoint ||
    row.request_id !== action.request_id ||
    row.body_hash !== action.body_hash
  ) {
    throw new ApiError('idempotency_key_reused');
  }
  return json(JSON.parse(row.response_body) as unknown, row.response_status);
}

export async function rememberIdempotentResponse(
  client: Queryable,
  personId: string,
  action: IdempotentAction,
  status: number,
  body: unknown,
): Promise<void> {
  await client.query(
    `INSERT INTO idempotency_keys (person_id, key, endpoint, request_id, body_hash, response_status, response_body)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (person_id, key) DO NOTHING`,
    [
      personId,
      action.key,
      action.endpoint,
      action.request_id,
      action.body_hash,
      status,
      JSON.stringify(body),
    ],
  );
}
