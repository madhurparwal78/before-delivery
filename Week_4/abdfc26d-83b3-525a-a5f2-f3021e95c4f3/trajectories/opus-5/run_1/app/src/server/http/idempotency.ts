import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { ApiError } from '../errors.js';
import type { Principal } from '../auth/identity.js';

const KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export interface HandlerResult {
  readonly status: number;
  readonly body: unknown;
}

export interface IdempotentOutcome extends HandlerResult {
  readonly replayed: boolean;
}

/** Stable serialisation so two bodies that parse alike hash alike. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, member]) => member !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, member]) => `${JSON.stringify(key)}:${canonical(member)}`);
  return `{${entries.join(',')}}`;
}

function requireKey(req: Request): string {
  const header = req.headers['idempotency-key'];
  const key = Array.isArray(header) ? header[0] : header;
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
    throw ApiError.validation({
      'Idempotency-Key': 'Send an Idempotency-Key of 1 to 128 letters, digits, - or _.',
    });
  }
  return key;
}

interface StoredRecord {
  request_hash: string;
  completed: boolean;
  status_code: number | null;
  response_body: unknown;
}

/**
 * Runs an endpoint marked [idem] at most once per key. Replays return the first
 * status and body; a reused key with a different body or a request still running
 * answers 409. 5xx answers are not stored, so a retry runs again.
 */
export async function withIdempotency(
  req: Request,
  principal: Principal,
  work: () => Promise<HandlerResult>,
): Promise<IdempotentOutcome> {
  const key = requireKey(req);
  const path = req.baseUrl + req.path;
  const requestHash = createHash('sha256').update(canonical(req.jsonBody ?? null)).digest('hex');
  const identity = [principal.id, req.method, path, key];

  await query('DELETE FROM idempotency_records WHERE expires_at <= now()');

  const claim = await query<{ inserted: boolean }>(
    `INSERT INTO idempotency_records (user_id, method, path, idem_key, request_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))
     ON CONFLICT (user_id, method, path, idem_key) DO NOTHING
     RETURNING true AS inserted`,
    [...identity, requestHash, config.idempotencyTtlSeconds],
  );

  if (claim.rows.length === 0) {
    const stored = await query<StoredRecord>(
      `SELECT request_hash, completed, status_code, response_body
       FROM idempotency_records WHERE user_id = $1 AND method = $2 AND path = $3 AND idem_key = $4`,
      identity,
    );
    const record = stored.rows[0];
    if (!record) {
      return withIdempotency(req, principal, work);
    }
    if (record.request_hash !== requestHash) {
      throw new ApiError(
        409,
        'idempotency_key_reused',
        'That Idempotency-Key was already used with a different body.',
      );
    }
    if (!record.completed || record.status_code === null) {
      throw new ApiError(
        409,
        'idempotency_in_progress',
        'That request is still running; retry in a moment.',
      );
    }
    return { status: record.status_code, body: record.response_body, replayed: true };
  }

  try {
    const result = await work();
    if (result.status >= 500) {
      await query(
        `DELETE FROM idempotency_records
         WHERE user_id = $1 AND method = $2 AND path = $3 AND idem_key = $4`,
        identity,
      );
      return { ...result, replayed: false };
    }
    await query(
      `UPDATE idempotency_records SET completed = true, status_code = $5, response_body = $6
       WHERE user_id = $1 AND method = $2 AND path = $3 AND idem_key = $4`,
      [...identity, result.status, JSON.stringify(result.body)],
    );
    return { ...result, replayed: false };
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    if (status >= 500) {
      await query(
        `DELETE FROM idempotency_records
         WHERE user_id = $1 AND method = $2 AND path = $3 AND idem_key = $4`,
        identity,
      );
      throw error;
    }
    const body = error instanceof ApiError ? error.body() : null;
    await query(
      `UPDATE idempotency_records SET completed = true, status_code = $5, response_body = $6
       WHERE user_id = $1 AND method = $2 AND path = $3 AND idem_key = $4`,
      [...identity, status, JSON.stringify(body)],
    );
    throw error;
  }
}
