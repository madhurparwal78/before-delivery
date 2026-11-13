import type { App } from './app';
import { ApiError } from './errors';
import { newId, sha256 } from './domain';

/**
 * Idempotency: 201 and 402 outcomes are stored; 503 outcomes are not.
 * A key whose first request is still running answers request_in_progress.
 */

export interface IdempotencyOutcome {
  replay: boolean;
  storedStatus?: number;
  storedBody?: unknown;
}

function hashBody(body: string): string {
  return sha256(body);
}

export async function beginIdempotency(app: App, scope: string, key: string, requestBody: string): Promise<IdempotencyOutcome> {
  const requestHash = hashBody(`${scope}:${requestBody}`);
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT * FROM idempotency_keys WHERE scope = $1 AND key = $2 FOR UPDATE`,
      [scope, key],
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      if (row.in_flight) {
        await client.query('ROLLBACK');
        throw new ApiError('request_in_progress');
      }
      if (row.request_hash !== requestHash) {
        await client.query('ROLLBACK');
        throw new ApiError('idempotency_conflict');
      }
      await client.query('COMMIT');
      return { replay: true, storedStatus: row.status ?? undefined, storedBody: row.response_body };
    }
    const expires = new Date(Date.now() + app.config.timers.idempotencyKeyTtlSeconds * 1000);
    await client.query(
      `INSERT INTO idempotency_keys (id, scope, key, request_hash, in_flight, expires_at) VALUES ($1, $2, $3, $4, TRUE, $5)`,
      [newId(), scope, key, requestHash, expires.toISOString()],
    );
    await client.query('COMMIT');
    return { replay: false };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // already rolled back
    }
    client.release();
    throw error;
  } finally {
    try {
      client.release();
    } catch {
      // released above on the error path
    }
  }
}

export async function finishIdempotency(app: App, scope: string, key: string, status: number, body: unknown): Promise<void> {
  await app.pool.query(
    `UPDATE idempotency_keys SET in_flight = FALSE, status = $3, response_body = $4 WHERE scope = $1 AND key = $2`,
    [scope, key, status, JSON.stringify(body)],
  );
}

/** A 503 is not stored so retrying after an outage runs the action. */
export async function releaseIdempotency(app: App, scope: string, key: string): Promise<void> {
  await app.pool.query(`DELETE FROM idempotency_keys WHERE scope = $1 AND key = $2 AND in_flight = TRUE`, [scope, key]);
}

export function idempotencyKey(req: { headers: Record<string, string | string[] | undefined> }): string | null {
  const raw = req.headers['idempotency-key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value.length < 1 || value.length > 200) {
    return null;
  }
  return value;
}
