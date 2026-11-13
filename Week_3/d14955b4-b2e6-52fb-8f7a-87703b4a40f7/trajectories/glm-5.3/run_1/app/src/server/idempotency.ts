// The one idempotency replay-and-conflict decision.
import { query, transaction } from './db';
import { loadConfig } from './config';
import { newId } from './crypto';
import { ERRORS } from './http';

export interface BeginOutcome {
  replay: { status: number; body: unknown } | null;
  claimId: string | null;
}

export interface IdempotencyScope {
  key: string;
  scopeKey: string;
  fingerprint: string;
}

export async function beginIdempotent(scope: IdempotencyScope): Promise<BeginOutcome> {
  await sweep();
  const existing = await query<{ id: string; state: string; fingerprint: string; response_json: unknown; response_status: number | null; expires_at: Date | null }>(
    'SELECT id, state, fingerprint, response_json, response_status, expires_at FROM idempotency_keys WHERE scope_key = $1 AND idem_key = $2',
    [scope.scopeKey, scope.key],
  );
  const row = existing.rows[0];
  if (row && row.state === 'completed') {
    if (row.expires_at && row.expires_at.getTime() < Date.now()) {
      await query('DELETE FROM idempotency_keys WHERE id = $1', [row.id]);
    } else {
      if (row.fingerprint !== scope.fingerprint) throw ERRORS.idempotencyMismatch();
      return { replay: { status: row.response_status ?? 201, body: row.response_json }, claimId: null };
    }
  }
  if (row && row.state === 'in_progress') {
    if (row.fingerprint !== scope.fingerprint) throw ERRORS.idempotencyMismatch();
    throw ERRORS.idempotencyInProgress();
  }
  const claimId = newId('idm');
  let claimed = false;
  await transaction(async (client) => {
    const insert = await client.query(
      `INSERT INTO idempotency_keys (id, scope_key, idem_key, fingerprint, state, request_json)
       VALUES ($1,$2,$3,$4,'in_progress','{}'::jsonb)
       ON CONFLICT (scope_key, idem_key) DO NOTHING`,
      [claimId, scope.scopeKey, scope.key, scope.fingerprint],
    );
    claimed = insert.rowCount === 1;
  });
  if (!claimed) {
    const retry = await query<{ state: string; fingerprint: string; response_json: unknown; response_status: number | null }>(
      'SELECT state, fingerprint, response_json, response_status FROM idempotency_keys WHERE scope_key = $1 AND idem_key = $2',
      [scope.scopeKey, scope.key],
    );
    const again = retry.rows[0];
    if (!again) throw ERRORS.idempotencyInProgress();
    if (again.state === 'completed') {
      if (again.fingerprint !== scope.fingerprint) throw ERRORS.idempotencyMismatch();
      return { replay: { status: again.response_status ?? 201, body: again.response_json }, claimId: null };
    }
    if (again.fingerprint !== scope.fingerprint) throw ERRORS.idempotencyMismatch();
    throw ERRORS.idempotencyInProgress();
  }
  return { replay: null, claimId };
}

export async function completeIdempotent(claimId: string, status: number, body: unknown): Promise<void> {
  await query(
    `UPDATE idempotency_keys
        SET state = 'completed', response_json = $2::jsonb, response_status = $3,
            expires_at = now() + ($4 || ' seconds')::interval
      WHERE id = $1 AND state = 'in_progress'`,
    [claimId, JSON.stringify(body), status, String(loadConfig().idempotencyKeyTtlSeconds)],
  );
}

export async function releaseIdempotent(claimId: string): Promise<void> {
  await query('DELETE FROM idempotency_keys WHERE id = $1 AND state = \'in_progress\'', [claimId]);
}

async function sweep(): Promise<void> {
  await query('DELETE FROM idempotency_keys WHERE expires_at IS NOT NULL AND expires_at < now()');
  await query('DELETE FROM nonces WHERE expires_at < now()');
  await query('DELETE FROM rotated_refresh_tokens WHERE rotated_at < now() - interval \'30 days\'');
  await query('DELETE FROM revoked_jtis WHERE expires_at < now()');
}
