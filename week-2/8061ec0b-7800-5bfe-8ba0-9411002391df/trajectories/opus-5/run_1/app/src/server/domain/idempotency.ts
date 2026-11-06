import { createHash } from 'node:crypto';
import { now } from '../clock';
import { pool } from '../db';
import { idempotencyConflict, validationFailed } from '../errors';
import type { Db } from './pricing';

export type IdempotentEndpoint = 'payments' | 'reversal' | 'buyout' | 'exchange';

export interface StoredAnswer {
  status: number;
  /** The exact JSON text of the first answer, so a replay returns it byte for byte. */
  body: string;
}

export interface IdempotencyState {
  key: string;
  endpoint: IdempotentEndpoint;
  contractId: string;
  replay: StoredAnswer | null;
  conflict: boolean;
}

export function requestHash(parts: unknown): string {
  return createHash('sha256').update(JSON.stringify(parts ?? null)).digest('hex');
}

/** 1 to 100 printable ASCII characters, scoped to the contract and endpoint. */
export function validateIdempotencyKey(header: unknown): string {
  const key = typeof header === 'string' ? header : '';
  if (key.length < 1 || key.length > 100 || !/^[\x20-\x7e]+$/.test(key)) {
    throw validationFailed({ idempotency_key: 'Send an Idempotency-Key of 1 to 100 printable characters.' });
  }
  return key;
}

/**
 * Looks a key up for this contract and endpoint: a stored answer replays byte for byte and the same
 * key with a different body conflicts.
 */
export async function lookupIdempotency(
  contractId: string,
  endpoint: IdempotentEndpoint,
  key: string | null,
  hash: string,
): Promise<IdempotencyState> {
  if (key === null) return { key: '', endpoint, contractId, replay: null, conflict: false };
  const { rows } = await pool.query<{ request_hash: string; state: string; status: number | null; body: string | null }>(
    'select request_hash, state, status, body from idempotency_keys where contract_id = $1 and endpoint = $2 and key = $3',
    [contractId, endpoint, key],
  );
  const row = rows[0];
  if (row === undefined) return { key, endpoint, contractId, replay: null, conflict: false };
  if (row.request_hash !== hash) return { key, endpoint, contractId, replay: null, conflict: true };
  if (row.state === 'done' && row.status !== null && row.body !== null) {
    return { key, endpoint, contractId, replay: { status: row.status, body: row.body }, conflict: false };
  }
  return { key, endpoint, contractId, replay: null, conflict: false };
}

export function raiseIdempotencyConflict(state: IdempotencyState): void {
  if (state.conflict) throw idempotencyConflict();
}

/** Stores the answer in the same step as the action, so a replay changes nothing anywhere. */
export async function storeIdempotentAnswer(
  sql: Db,
  state: { contractId: string; endpoint: IdempotentEndpoint; key: string },
  hash: string,
  answer: StoredAnswer,
): Promise<void> {
  if (state.key === '') return;
  await sql.query(
    `insert into idempotency_keys (contract_id, endpoint, key, request_hash, state, status, body, created_at)
     values ($1,$2,$3,$4,'done',$5,$6,$7)
     on conflict (contract_id, endpoint, key) do update set state = 'done', status = $5, body = $6`,
    [state.contractId, state.endpoint, state.key, hash, answer.status, answer.body, now()],
  );
}
