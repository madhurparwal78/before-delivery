import { createHash } from 'node:crypto';
import { errors } from './http';
import { query, queryOne } from './db';
import { serverNow } from './clock';
import type { JsonValue } from '../shared/types';

export interface StoredResponse {
  status: number;
  body: JsonValue;
}

interface Row {
  body_hash: string;
  status_code: number;
  response: JsonValue;
}

function hashBody(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');
}

/**
 * Runs a handler once per key. A replay with the same body returns the stored response;
 * a replay with a different body conflicts.
 */
export async function withIdempotency(
  scope: string,
  key: string,
  personId: string,
  body: unknown,
  handler: () => Promise<StoredResponse>,
): Promise<StoredResponse> {
  const bodyHash = hashBody(body);
  const now = await serverNow();
  const claimed = await query<{ scope: string }>(
    `INSERT INTO idempotency (scope, key, person_id, body_hash, status_code, response, created_at)
     VALUES ($1,$2,$3,$4,0,'null',$5)
     ON CONFLICT (scope, key) DO NOTHING
     RETURNING scope`,
    [scope, key, personId, bodyHash, now.toISOString()],
  );
  if (claimed.length === 0) {
    const existing = await queryOne<Row>(
      `SELECT body_hash, status_code, response FROM idempotency WHERE scope = $1 AND key = $2`,
      [scope, key],
    );
    if (!existing) throw errors.conflict('idempotency_conflict', 'This key was already used for a different request.');
    if (existing.body_hash !== bodyHash) {
      throw errors.conflict(
        'idempotency_conflict',
        'This key was already used for a different request.',
      );
    }
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const row = await queryOne<Row>(
        `SELECT body_hash, status_code, response FROM idempotency WHERE scope = $1 AND key = $2`,
        [scope, key],
      );
      if (row && row.status_code !== 0) {
        return { status: row.status_code, body: row.response };
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw errors.conflict(
      'idempotency_conflict',
      'This key was already used for a different request.',
    );
  }
  try {
    const result = await handler();
    await query(
      `UPDATE idempotency SET status_code = $3, response = $4 WHERE scope = $1 AND key = $2`,
      [scope, key, result.status, JSON.stringify(result.body)],
    );
    return result;
  } catch (error) {
    await query(`DELETE FROM idempotency WHERE scope = $1 AND key = $2`, [scope, key]);
    throw error;
  }
}
