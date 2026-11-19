import { withTransaction } from './db.js';
import { now } from './clock.js';
import { sha256Hex } from './ids.js';
import { ApiError } from './http.js';

// Idempotency keys are scoped to the caller's company and the endpoint (method
// plus full path, loan id included). Only successful answers are stored, with
// the request body they belong to. A key replays while the business clock is
// before its first success plus 24 hours.
const RETENTION_MS = 24 * 3600 * 1000;

function bodyHash(body) {
  return sha256Hex(JSON.stringify(canonical(body)));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = canonical(value[k]);
    return out;
  }
  return value;
}

// Runs a write inside one transaction. The handler receives the transaction's
// client and returns { status, body }. The answer is stored against the key in
// the same transaction, so a replay is byte-identical and a race produces one
// operation.
export async function runIdempotentWrite(ctx, sess, scopeKey, requestBody, fn) {
  const keyHeader = ctx.req.headers['idempotency-key'];
  const key = keyHeader ? String(keyHeader) : null;
  const hash = bodyHash(requestBody);
  return withTransaction(async (client) => {
    if (key) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${scopeKey}|${key}`]);
      const found = await client.query(
        'SELECT * FROM idempotency_keys WHERE company_id = $1 AND endpoint = $2 AND key = $3',
        [sess.company_id, scopeKey, key]
      );
      if (found.rowCount > 0) {
        const row = found.rows[0];
        const firstSuccess = new Date(row.created_at).getTime();
        if (now() < firstSuccess + RETENTION_MS) {
          if (row.request_hash !== hash) throw new ApiError(422, 'idempotency_key_reused');
          return { replay: true, status: row.status, bodyText: row.response_body.toString('utf8') };
        }
      }
    }
    const answer = await fn(client);
    if (key) {
      await client.query(
        `INSERT INTO idempotency_keys (company_id, endpoint, key, request_hash, status, response_body, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (company_id, endpoint, key) DO UPDATE
           SET request_hash = EXCLUDED.request_hash, status = EXCLUDED.status,
               response_body = EXCLUDED.response_body, created_at = EXCLUDED.created_at`,
        [sess.company_id, scopeKey, key, hash, answer.status, Buffer.from(JSON.stringify(answer.body), 'utf8'), new Date(now())]
      );
    }
    return { replay: false, status: answer.status, body: answer.body };
  });
}
