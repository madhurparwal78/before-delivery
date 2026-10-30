import { sha256Hex } from '../lib/core.js';
import { errors, ApiError } from '../lib/http.js';
import { withTransaction, withClient } from '../lib/db.js';
import { isDbError } from './pipeline.js';

const RETENTION_SECONDS = Number(process.env.CORVO_IDEMPOTENCY_RETENTION_SECONDS || '86400');

export function validateIdempotencyKey(header) {
  if (header === undefined) return null;
  if (header === '' || header.length > 128 || /[^\x20-\x7e]/.test(header)) {
    throw errors.validation('Idempotency-Key', 'Send a valid Idempotency-Key');
  }
  return header;
}

// Runs `fn()` (which does its own transactional work) under an idempotency key.
// Returns {status, body, replayed} or throws.
export async function runWithIdempotency(ctx, key, method, path, rawBody, fn) {
  if (!key) {
    const data = await fn();
    return { replayed: false, status: 201, body: { data, error: null } };
  }
  const bodySha = sha256Hex(rawBody);
  const orgId = ctx.organization_id;

  const existing = await withClient(async (client) => {
    const { rows } = await client.query(
      `SELECT method, path, body_sha256, status_code, response, created_at
       FROM idempotency_records WHERE organization_id = $1 AND key = $2`, [orgId, key]);
    return rows[0] || null;
  });

  if (existing) {
    const ageSeconds = (Date.now() - new Date(existing.created_at).getTime()) / 1000;
    if (ageSeconds > RETENTION_SECONDS) {
      await withClient((client) => client.query(
        'DELETE FROM idempotency_records WHERE organization_id = $1 AND key = $2', [orgId, key]));
    } else if (existing.status_code === null) {
      throw errors.conflict('IDEMPOTENCY_KEY_IN_PROGRESS', 'The first request with this key is still running.');
    } else if (existing.method === method && existing.path === path && existing.body_sha256 === bodySha) {
      return { replayed: true, status: existing.status_code, body: JSON.parse(existing.response) };
    } else {
      throw new ApiError(422, 'IDEMPOTENCY_KEY_REUSED', 'This idempotency key was used for a different request.');
    }
  }

  const inserted = await withTransaction((client) =>
    client.query(
      `INSERT INTO idempotency_records (organization_id, key, method, path, body_sha256, status_code, response, created_at)
       VALUES ($1,$2,$3,$4,$5,NULL,NULL,$6)
       ON CONFLICT (organization_id, key) DO NOTHING`,
      [orgId, key, method, path, bodySha, new Date()]
    ).then((r) => r.rowCount === 1));

  if (!inserted) {
    const row = await withClient(async (client) => {
      const { rows } = await client.query(
        `SELECT status_code, method, path, body_sha256, response
         FROM idempotency_records WHERE organization_id = $1 AND key = $2`, [orgId, key]);
      return rows[0] || null;
    });
    if (!row) return runWithIdempotency(ctx, key, method, path, rawBody, fn);
    if (row.status_code === null) {
      throw errors.conflict('IDEMPOTENCY_KEY_IN_PROGRESS', 'The first request with this key is still running.');
    }
    if (row.method === method && row.path === path && row.body_sha256 === bodySha) {
      return { replayed: true, status: row.status_code, body: JSON.parse(row.response) };
    }
    throw new ApiError(422, 'IDEMPOTENCY_KEY_REUSED', 'This idempotency key was used for a different request.');
  }

  let data;
  try {
    data = await fn();
  } catch (e) {
    if (isDbError(e)) {
      await withClient((client) => client.query(
        'DELETE FROM idempotency_records WHERE organization_id = $1 AND key = $2', [orgId, key])).catch(() => {});
      throw e;
    }
    if (e instanceof ApiError && e.code === 'POLICY_DENIED') {
      const body = { success: false, data: null, error: { code: e.code, message: e.message, details: e.details }, meta: { request_id: 'replay' } };
      await withClient((client) => client.query(
        `UPDATE idempotency_records SET status_code = $1, response = $2
         WHERE organization_id = $3 AND key = $4`, [e.status, JSON.stringify(body), orgId, key])).catch(() => {});
    } else {
      await withClient((client) => client.query(
        'DELETE FROM idempotency_records WHERE organization_id = $1 AND key = $2', [orgId, key])).catch(() => {});
    }
    throw e;
  }
  const body = { success: true, data, error: null, meta: { request_id: 'replay' } };
  await withTransaction((client) => client.query(
    `UPDATE idempotency_records SET status_code = $1, response = $2
     WHERE organization_id = $3 AND key = $4`, [201, JSON.stringify(body), orgId, key]));
  return { replayed: false, status: 201, body };
}
