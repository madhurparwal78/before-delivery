import { createHash } from 'node:crypto';
import { inTransaction, type Database } from '../db/pool.js';
import { fail } from './apiError.js';

/** A running marker older than this is taken over, so a crash never blocks a key. */
const STALE_RUNNING_SECONDS = 60;

export interface StoredResponse {
  readonly status: number;
  readonly body: string;
}

interface KeyRow {
  request_hash: string;
  state: string;
  response_status: number | null;
  response_body: string | null;
}

export function requestHash(method: string, path: string, body: Buffer): string {
  return createHash('sha256')
    .update(method)
    .update('\n')
    .update(path)
    .update('\n')
    .update(body)
    .digest('base64url');
}

/** Claims the key for this request, or returns the response stored under it. */
export async function claimKey(
  pool: Database,
  personId: string,
  key: string,
  hash: string,
): Promise<StoredResponse | null> {
  return inTransaction(pool, async (client) => {
    const existing = await client.query<KeyRow>(
      `select request_hash, state, response_status, response_body
       from idempotency_key where person_id = $1 and key = $2 for update`,
      [personId, key],
    );
    const row = existing.rows[0];
    if (row === undefined) {
      await client.query(
        `insert into idempotency_key (person_id, key, request_hash, state, started_at)
         values ($1, $2, $3, 'running', now())`,
        [personId, key, hash],
      );
      return null;
    }
    if (row.request_hash !== hash) throw fail('idempotency_conflict');
    if (row.state === 'done') {
      return { status: row.response_status ?? 200, body: row.response_body ?? '' };
    }
    const reclaimed = await client.query(
      `update idempotency_key set started_at = now()
       where person_id = $1 and key = $2 and state = 'running'
         and started_at < now() - make_interval(secs => $3::double precision)`,
      [personId, key, STALE_RUNNING_SECONDS],
    );
    if (reclaimed.rowCount === 1) return null;
    throw fail('request_in_progress');
  });
}

export async function storeSuccess(
  pool: Database,
  personId: string,
  key: string,
  status: number,
  body: string,
): Promise<void> {
  await pool.query(
    `update idempotency_key
     set state = 'done', response_status = $3, response_body = $4
     where person_id = $1 and key = $2`,
    [personId, key, status, body],
  );
}

/** A failed request leaves no stored response and no in-progress marker. */
export async function releaseKey(pool: Database, personId: string, key: string): Promise<void> {
  await pool.query(
    `delete from idempotency_key where person_id = $1 and key = $2 and state = 'running'`,
    [personId, key],
  );
}
