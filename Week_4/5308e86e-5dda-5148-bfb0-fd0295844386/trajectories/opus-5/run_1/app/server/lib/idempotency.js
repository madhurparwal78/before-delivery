'use strict';

// Idempotency keys, scoped to the caller's company and the endpoint, stored in
// the database so replays survive a restart. A replay returns the
// byte-identical first answer; the same key with a different body is refused.

const crypto = require('crypto');
const clock = require('./clock');
const errors = require('./errors');

const RETENTION_MS = 24 * 60 * 60 * 1000;

function fingerprint(readKeys) {
  const stable = JSON.stringify(readKeys, Object.keys(readKeys).sort());
  return crypto.createHash('sha256').update(stable, 'utf8').digest('hex');
}

function meta({ companyId, endpoint, key, readKeys }) {
  if (!key) return null;
  return { companyId, endpoint, key, fingerprint: fingerprint(readKeys) };
}

// Called inside the operation's transaction, after the company lock, so
// simultaneous duplicates produce one operation.
async function replay(client, info) {
  if (!info) return null;
  const result = await client.query(
    `SELECT request_fingerprint, response_status, response_body, created_at
       FROM idempotency_keys
      WHERE company_id = $1 AND endpoint = $2 AND key = $3
      FOR UPDATE`,
    [info.companyId, info.endpoint, info.key]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  const expired = clock.nowMs() >= new Date(row.created_at).getTime() + RETENTION_MS;
  if (expired) {
    await client.query(
      'DELETE FROM idempotency_keys WHERE company_id = $1 AND endpoint = $2 AND key = $3',
      [info.companyId, info.endpoint, info.key]
    );
    return null;
  }
  if (row.request_fingerprint !== info.fingerprint) {
    throw errors.unprocessable('idempotency_key_reused');
  }
  return { status: row.response_status, raw: row.response_body };
}

async function store(client, info, answer) {
  if (!info) return;
  const body = answer.raw !== undefined ? answer.raw : JSON.stringify(answer.body);
  await client.query(
    `INSERT INTO idempotency_keys
       (company_id, endpoint, key, request_fingerprint, response_status, response_body, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (company_id, endpoint, key)
       DO UPDATE SET request_fingerprint = EXCLUDED.request_fingerprint,
                     response_status = EXCLUDED.response_status,
                     response_body = EXCLUDED.response_body,
                     created_at = EXCLUDED.created_at`,
    [info.companyId, info.endpoint, info.key, info.fingerprint, answer.status, body, clock.now()]
  );
}

module.exports = { meta, replay, store, RETENTION_MS };
