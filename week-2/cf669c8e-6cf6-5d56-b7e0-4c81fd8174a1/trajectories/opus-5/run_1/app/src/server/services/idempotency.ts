/**
 * Idempotency, decided in PostgreSQL so instances sharing a database behave as
 * one shop.
 *
 * The primary key on `(user_id, key)` is the claim. The owner runs the work and
 * stores the answer; a repeat with the same body replays it, a concurrent
 * repeat waits for it, and the same key with a different body conflicts.
 *
 * A refusal before any provider call stores nothing, so the key stays usable.
 */

import { createHash } from 'node:crypto';

import { query } from '../db/pool.js';
import { ApiError, IdempotentReplay, ValidationError } from '../http/errors.js';

const MAX_KEY_LENGTH = 200;
const WAIT_INTERVAL_MS = 40;
const WAIT_TIMEOUT_MS = 20_000;

export interface Answer {
  status: number;
  body: unknown;
}

export function requireIdempotencyKey(header: unknown): string {
  if (typeof header !== 'string' || header.length === 0) {
    throw new ValidationError({ idempotencyKey: 'Required.' });
  }
  if (header.length > MAX_KEY_LENGTH) {
    throw new ValidationError({ idempotencyKey: `Keep the key to ${MAX_KEY_LENGTH} characters.` });
  }
  return header;
}

function hashRequest(endpoint: string, body: unknown): string {
  return createHash('sha256').update(`${endpoint}\n${JSON.stringify(body ?? null)}`).digest('hex');
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `work` at most once for this key.
 *
 * `work` receives `markProviderCalled`, which it must call immediately before
 * its first provider request. If it throws without having called it, the key is
 * released so the rider can press again with the same key.
 */
export async function runIdempotent(
  userId: string,
  key: string,
  endpoint: string,
  requestBody: unknown,
  work: (markProviderCalled: () => void) => Promise<Answer>,
): Promise<Answer> {
  const requestHash = hashRequest(endpoint, requestBody);
  const deadline = Date.now() + WAIT_TIMEOUT_MS;

  for (;;) {
    const claimed = await query(
      `INSERT INTO idempotency_records(user_id, key, endpoint, request_hash)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, key) DO NOTHING
       RETURNING key`,
      [userId, key, endpoint, requestHash],
    );

    if (claimed.rowCount === 1) {
      let providerCalled = false;
      try {
        const answer = await work(() => {
          providerCalled = true;
        });
        await store(userId, key, answer);
        return answer;
      } catch (error) {
        if (!providerCalled) {
          await release(userId, key);
          throw error;
        }
        const answer = answerForError(error);
        if (!answer) {
          await release(userId, key);
          throw error;
        }
        await store(userId, key, answer);
        throw error;
      }
    }

    const existing = await query<{
      request_hash: string;
      completed: boolean;
      status_code: number | null;
      body: unknown;
    }>('SELECT request_hash, completed, status_code, body FROM idempotency_records WHERE user_id = $1 AND key = $2', [
      userId,
      key,
    ]);
    const row = existing.rows[0];

    // The owner released the key after a refusal; try to claim it ourselves.
    if (!row) continue;

    if (row.request_hash !== requestHash) throw new ApiError(409, 'idempotency_conflict');

    if (row.completed && row.status_code !== null) {
      throw new IdempotentReplay(row.status_code, row.body);
    }

    if (Date.now() > deadline) throw new ApiError(409, 'idempotency_conflict');
    await sleep(WAIT_INTERVAL_MS);
  }
}

/** Only an answer Kill Bill itself decided is worth storing. */
function answerForError(error: unknown): Answer | null {
  if (error instanceof ApiError && error.status === 402) {
    return { status: error.status, body: { error: error.code } };
  }
  return null;
}

async function store(userId: string, key: string, answer: Answer): Promise<void> {
  await query(
    `UPDATE idempotency_records
     SET completed = true, status_code = $3, body = $4
     WHERE user_id = $1 AND key = $2`,
    [userId, key, answer.status, JSON.stringify(answer.body ?? null)],
  );
}

async function release(userId: string, key: string): Promise<void> {
  await query('DELETE FROM idempotency_records WHERE user_id = $1 AND key = $2 AND completed = false', [
    userId,
    key,
  ]);
}
