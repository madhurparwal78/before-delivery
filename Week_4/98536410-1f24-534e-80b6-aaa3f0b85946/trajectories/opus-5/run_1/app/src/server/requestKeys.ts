import { createHash } from 'node:crypto';
import { config } from './config.js';
import { query, withTransaction } from './db.js';
import { requestInProgress, requestKeyReuse, validationFailed } from './http/errors.js';

const KEY_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

export function readRequestKey(request: { headers: Record<string, unknown> }): string {
  const raw = request.headers['request-key'];
  const key = typeof raw === 'string' ? raw : '';
  if (!KEY_PATTERN.test(key)) {
    throw validationFailed({ request_key: 'Send a Request-Key of 8 to 64 letters, digits and hyphens.' });
  }
  return key;
}

function canonicalHash(body: unknown): string {
  return createHash('sha256').update(stableStringify(body)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(source[key])}`).join(',')}}`;
}

export type StoredAnswer = { status: number; body: unknown };

export type KeyClaim =
  | { kind: 'replay'; answer: StoredAnswer }
  | { kind: 'claimed' };

/**
 * Claims a request key for this attempt. A repeated key with the same body replays the
 * first stored answer; a different body answers `request_key_reuse`; a key still being
 * processed on any app copy answers `request_in_progress`.
 */
export async function claimRequestKey(
  operatorId: string,
  userId: string,
  scope: string,
  requestKey: string,
  body: unknown,
): Promise<KeyClaim> {
  const bodyHash = canonicalHash(body);
  await query(
    `DELETE FROM request_keys WHERE created_at < now() - ($1 || ' seconds')::interval`,
    [String(config.requestKeyTtlSeconds)],
  );

  return withTransaction(async (tx) => {
    const inserted = await tx.query(
      `INSERT INTO request_keys (operator_id, user_id, request_key, scope, body_hash, state, created_at)
       VALUES ($1,$2,$3,$4,$5,'in_progress', now())
       ON CONFLICT (operator_id, user_id, request_key) DO NOTHING`,
      [operatorId, userId, requestKey, scope, bodyHash],
    );
    if (inserted.rowCount === 1) return { kind: 'claimed' };

    const existing = (
      await tx.query(
        `SELECT body_hash, state, status_code, response_body FROM request_keys
          WHERE operator_id = $1 AND user_id = $2 AND request_key = $3 FOR UPDATE`,
        [operatorId, userId, requestKey],
      )
    ).rows[0];
    if (!existing) return { kind: 'claimed' };
    if (existing['body_hash'] !== bodyHash) throw requestKeyReuse();
    if (existing['state'] === 'in_progress') throw requestInProgress();
    return {
      kind: 'replay',
      answer: {
        status: existing['status_code'] as number,
        body: JSON.parse(existing['response_body'] as string),
      },
    };
  });
}

/** Stores a completed answer below 500 so the key replays it byte for byte. */
export async function finishRequestKey(
  operatorId: string,
  userId: string,
  requestKey: string,
  status: number,
  body: unknown,
): Promise<void> {
  if (status >= 500) {
    await releaseRequestKey(operatorId, userId, requestKey);
    return;
  }
  await query(
    `UPDATE request_keys SET state = 'done', status_code = $4, response_body = $5
      WHERE operator_id = $1 AND user_id = $2 AND request_key = $3`,
    [operatorId, userId, requestKey, status, JSON.stringify(body)],
  );
}

async function releaseRequestKey(
  operatorId: string,
  userId: string,
  requestKey: string,
): Promise<void> {
  await query(
    `DELETE FROM request_keys WHERE operator_id = $1 AND user_id = $2 AND request_key = $3`,
    [operatorId, userId, requestKey],
  );
}
