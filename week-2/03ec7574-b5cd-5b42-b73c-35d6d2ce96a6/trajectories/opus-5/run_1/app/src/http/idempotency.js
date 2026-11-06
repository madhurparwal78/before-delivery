import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { ApiError } from './errors.js';

const PRINTABLE_ASCII = /^[\x20-\x7E]+$/;

export function readIdempotencyKey(headers) {
  const value = headers['idempotency-key'];
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > 128 || !PRINTABLE_ASCII.test(value)) {
    throw new ApiError('VALIDATION_ERROR', { details: { field: 'Idempotency-Key' } });
  }
  return value;
}

export function bodyDigest(rawBody) {
  return createHash('sha256').update(rawBody || Buffer.alloc(0)).digest('hex');
}

async function insertRecord(organizationId, key, method, path, digest) {
  const result = await query(
    `INSERT INTO idempotency_records (organization_id, key, method, path, body_sha256, status_code, response, created_at)
     VALUES ($1, $2, $3, $4, $5, NULL, NULL, date_trunc('second', now()))
     ON CONFLICT (organization_id, key) DO NOTHING
     RETURNING key`,
    [organizationId, key, method, path, digest]
  );
  return result.rows.length > 0;
}

/** Binds the key to this request, or answers with the in-flight, replay or reuse outcome. */
export async function beginIdempotent({ organizationId, key, method, path, digest }) {
  if (await insertRecord(organizationId, key, method, path, digest)) return { mode: 'run' };

  const existing = await query(
    `SELECT method, path, body_sha256, status_code, response::text AS response, created_at,
            EXTRACT(EPOCH FROM (now() - created_at)) AS age_seconds
       FROM idempotency_records WHERE organization_id = $1 AND key = $2`,
    [organizationId, key]
  );
  if (!existing.rows.length) return beginIdempotent({ organizationId, key, method, path, digest });
  const record = existing.rows[0];

  if (record.status_code === null) throw new ApiError('IDEMPOTENCY_KEY_IN_PROGRESS');

  if (Number(record.age_seconds) > config.idempotencyRetentionSeconds) {
    await query(
      `UPDATE idempotency_records
          SET method = $3, path = $4, body_sha256 = $5, status_code = NULL, response = NULL, created_at = date_trunc('second', now())
        WHERE organization_id = $1 AND key = $2`,
      [organizationId, key, method, path, digest]
    );
    return { mode: 'run' };
  }

  if (record.method !== method || record.path !== path || record.body_sha256 !== digest) {
    throw new ApiError('IDEMPOTENCY_KEY_REUSED');
  }
  return { mode: 'replay', status: record.status_code, head: record.response };
}

export async function keepIdempotent({ organizationId, key, status, head }) {
  await query(
    'UPDATE idempotency_records SET status_code = $3, response = $4 WHERE organization_id = $1 AND key = $2',
    [organizationId, key, status, head]
  );
}

export async function releaseIdempotent({ organizationId, key }) {
  await query('DELETE FROM idempotency_records WHERE organization_id = $1 AND key = $2 AND status_code IS NULL', [organizationId, key]);
}
