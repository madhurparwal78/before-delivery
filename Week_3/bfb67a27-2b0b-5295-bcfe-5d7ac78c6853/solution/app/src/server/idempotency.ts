import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { idempotencyPool } from './db.js';
import { ApiError, idempotencyKeyReused, validation } from './errors.js';

interface StoredResponse {
  status: number;
  body: string;
}

interface IdempotentResult {
  status: number;
  body: unknown;
}

const LOCK_NAMESPACE = 4_417_100;

export function requireIdempotencyKey(req: IncomingMessage): string {
  const raw = req.headers['idempotency-key'];
  const key = typeof raw === 'string' ? raw : undefined;
  if (key === undefined || key.length < 1 || key.length > 100) {
    throw validation({ idempotencyKey: 'Send an Idempotency-Key header' });
  }
  return key;
}

function lockId(endpoint: string, key: string): number {
  const digest = createHash('sha256').update(`${endpoint}\u0000${key}`).digest();
  return digest.readInt32BE(0);
}

function hashRequest(path: string, body: unknown): string {
  return createHash('sha256')
    .update(`${path}\u0000${JSON.stringify(body ?? null)}`)
    .digest('hex');
}

/**
 * Runs the action once per Idempotency-Key and endpoint. A replay of the same
 * key, path and body answers with the stored response byte for byte; the same
 * key with a different request is refused. Responses at or above 500 are not
 * stored, so the key stays retryable.
 */
export async function runIdempotent(
  endpoint: string,
  key: string,
  path: string,
  body: unknown,
  action: () => Promise<IdempotentResult>,
): Promise<StoredResponse> {
  const requestHash = hashRequest(path, body);
  const client = await idempotencyPool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1, $2)', [LOCK_NAMESPACE, lockId(endpoint, key)]);
    const existing = await client.query<{
      request_hash: string;
      response_status: number | null;
      response_body: string | null;
    }>(
      `SELECT request_hash, response_status, response_body FROM idempotency_records
        WHERE endpoint = $1 AND key = $2`,
      [endpoint, key],
    );
    const record = existing.rows[0];
    if (record !== undefined) {
      if (record.request_hash !== requestHash) throw idempotencyKeyReused();
      if (record.response_status !== null && record.response_body !== null) {
        return { status: record.response_status, body: record.response_body };
      }
      await client.query(`DELETE FROM idempotency_records WHERE endpoint = $1 AND key = $2`, [
        endpoint,
        key,
      ]);
    }
    await client.query(
      `INSERT INTO idempotency_records (endpoint, key, request_hash) VALUES ($1, $2, $3)`,
      [endpoint, key, requestHash],
    );

    let result: IdempotentResult;
    try {
      result = await action();
    } catch (error) {
      if (!(error instanceof ApiError)) {
        await client.query(`DELETE FROM idempotency_records WHERE endpoint = $1 AND key = $2`, [
          endpoint,
          key,
        ]);
        throw error;
      }
      result = { status: error.status, body: error.body() };
    }
    const serialised = JSON.stringify(result.body);
    if (result.status < 500) {
      await client.query(
        `UPDATE idempotency_records SET response_status = $3, response_body = $4
          WHERE endpoint = $1 AND key = $2`,
        [endpoint, key, result.status, serialised],
      );
    } else {
      await client.query(`DELETE FROM idempotency_records WHERE endpoint = $1 AND key = $2`, [
        endpoint,
        key,
      ]);
    }
    return { status: result.status, body: serialised };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1, $2)', [
      LOCK_NAMESPACE,
      lockId(endpoint, key),
    ]);
    client.release();
  }
}
