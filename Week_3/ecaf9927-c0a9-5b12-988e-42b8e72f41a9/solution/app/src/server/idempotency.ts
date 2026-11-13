import { createHash } from 'node:crypto';
import { pool, transaction, type Db, type Queryable } from './db';
import { idempotencyConflict } from './errors';
import { FIELD_MESSAGES } from '../shared/messages';
import type { Validator } from './validate';

/** A response as it was sent and is replayed. */
export interface RecordedResponse {
  status: number;
  body: unknown;
}

const VISIBLE_KEY = /^[\x21-\x7e]{1,100}$/;
const SETTLE_WAIT_MS = 15000;

const keyIsValid = (key: string | undefined): key is string => key !== undefined && VISIBLE_KEY.test(key);

/** Fails the `idempotency_key` field when the header is missing or malformed. */
export function requireKey(v: Validator, key: string | undefined): void {
  if (!keyIsValid(key)) v.fail('idempotency_key', FIELD_MESSAGES.idempotencyKey);
}

interface Recorded {
  request_hash: string;
  status: number;
  response: unknown;
  settled: boolean;
}

async function recorded(db: Queryable, memberId: string, path: string, key: string): Promise<Recorded | undefined> {
  const { rows } = await db.query<Recorded>(
    'SELECT request_hash, status, response, settled FROM idempotency_keys WHERE member_id = $1 AND path = $2 AND key = $3',
    [memberId, path, key],
  );
  return rows[0];
}

interface FirstRun {
  outcome: RecordedResponse;
  /** Runs after the transaction commits; its result replaces the recorded response. */
  settle?: () => Promise<unknown>;
}

export interface Idempotent {
  replayed: boolean;
  outcome: RecordedResponse;
}

/**
 * Runs `work` once per (member, path, key). A repeat with the same body returns the first response,
 * the same key with another body is refused, and simultaneous duplicates queue behind the first.
 */
export async function once(
  memberId: string,
  path: string,
  key: string | undefined,
  body: unknown,
  work: (db: Db) => Promise<FirstRun>,
): Promise<Idempotent> {
  const requestHash = createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
  if (!keyIsValid(key)) {
    const fresh = await transaction(work);
    return { replayed: false, outcome: fresh.outcome };
  }
  let settle: FirstRun['settle'];
  const result = await transaction(async (db): Promise<Idempotent> => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${memberId}|${path}|${key}`]);
    const earlier = await recorded(db, memberId, path, key);
    if (earlier) {
      if (earlier.request_hash !== requestHash) throw idempotencyConflict();
      return { replayed: true, outcome: { status: earlier.status, body: earlier.response } };
    }
    const fresh = await work(db);
    settle = fresh.settle;
    await db.query(
      'INSERT INTO idempotency_keys (member_id, path, key, request_hash, status, response, settled) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [memberId, path, key, requestHash, fresh.outcome.status, JSON.stringify(fresh.outcome.body), !fresh.settle],
    );
    return { replayed: false, outcome: fresh.outcome };
  });
  if (result.replayed) return { replayed: true, outcome: await settled(memberId, path, key) };
  if (!settle) return result;
  const finalBody = await settle();
  await pool.query('UPDATE idempotency_keys SET response = $4, settled = true WHERE member_id = $1 AND path = $2 AND key = $3', [
    memberId,
    path,
    key,
    JSON.stringify(finalBody),
  ]);
  return { replayed: false, outcome: { status: result.outcome.status, body: finalBody } };
}

/** A duplicate that arrives while the first is still finishing waits for the first's final response. */
async function settled(memberId: string, path: string, key: string): Promise<RecordedResponse> {
  const deadline = Date.now() + SETTLE_WAIT_MS;
  for (;;) {
    const row = (await recorded(pool, memberId, path, key)) as Recorded;
    if (row.settled || Date.now() > deadline) return { status: row.status, body: row.response };
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
