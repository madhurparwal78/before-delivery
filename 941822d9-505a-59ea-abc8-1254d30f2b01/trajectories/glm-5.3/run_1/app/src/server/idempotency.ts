import { createHash, randomUUID } from "node:crypto";
import { err, validationError } from "./errors.ts";
import { query } from "./db.ts";

// Idempotency for checkout and pack purchase: keys are scoped to the signed-in
// user; only success responses are stored; concurrent requests with one key
// wait for the first and get its response.

const KEY_PATTERN = /^[\x20-\x7E]{8,128}$/;

export const validateKey = (raw: string | undefined): string =>
  raw !== undefined && KEY_PATTERN.test(raw) ? raw : (() => { throw err(400, "idempotency_key_required"); })();

export const hashBody = (body: unknown): string =>
  createHash("sha256").update(body === undefined ? "null" : JSON.stringify(body)).digest("hex");

type LockEntry = { queue: Array<() => void> };
const locks = new Map<string, LockEntry>();

async function withLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
  const entry = locks.get(lockKey) ?? { queue: [] };
  locks.set(lockKey, entry);
  const gate = new Promise<void>((resolve) => entry.queue.push(resolve));
  if (entry.queue.length > 1) await gate;
  try {
    return await fn();
  } finally {
    entry.queue.shift();
    locks.delete(lockKey);
    entry.queue[0]?.();
  }
}

export type StoredResponse = { status: number; body: unknown };

/**
 * Runs fn under the idempotency key. Replays return the stored response; a
 * different body gets the reused 409; failures leave the key unused.
 */
export async function withIdempotency<T>(
  userId: string,
  key: string,
  scope: string,
  body: unknown,
  fn: () => Promise<T & { __status?: number }>,
): Promise<{ replay: false; result: T; store: (response: StoredResponse) => Promise<void> } | { replay: true; response: StoredResponse }> {
  const bodyHash = hashBody(body);
  const lockKey = `${userId}:${scope}:${key}`;
  return withLock(lockKey, async () => {
    const existing = await query<{ body_hash: string; status: number | null; response_body: unknown }>(
      `SELECT body_hash, status, response_body FROM idempotency_keys WHERE user_id = $1 AND key = $2 AND scope = $3`,
      [userId, key, scope],
    );
    const row = existing.rows[0];
    if (row) {
      if (row.body_hash !== bodyHash) throw err(409, "idempotency_key_reused");
      if (row.status !== null) {
        return { replay: true, response: { status: row.status, body: row.response_body } };
      }
      // Another process holds an in-flight reservation; wait for it.
      for (let i = 0; i < 100; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const poll = await query<{ status: number | null; response_body: unknown }>(
          `SELECT status, response_body FROM idempotency_keys WHERE user_id = $1 AND key = $2 AND scope = $3`,
          [userId, key, scope],
        );
        const r = poll.rows[0];
        if (r?.status !== null && r !== undefined) {
          return { replay: true, response: { status: r.status, body: r.response_body } };
        }
        if (r === undefined) break;
      }
      throw err(409, "idempotency_key_reused");
    }

    const id = randomUUID();
    const inserted = await query<{ id: string }>(
      `INSERT INTO idempotency_keys (id, user_id, key, scope, body_hash) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, key, scope) DO NOTHING RETURNING id`,
      [id, userId, key, scope, bodyHash],
    );
    if (inserted.rows.length === 0) throw err(409, "idempotency_key_reused");

    let outcome: { failed: boolean; error?: unknown; result?: T };
    try {
      const result = await fn();
      outcome = { failed: false, result };
    } catch (e) {
      outcome = { failed: true, error: e };
    }
    if (outcome.failed) {
      await query(`DELETE FROM idempotency_keys WHERE id = $1`, [id]);
      throw outcome.error;
    }
    return {
      replay: false,
      result: outcome.result as T,
      store: async (response) => {
        await query(`UPDATE idempotency_keys SET status = $2, response_body = $3 WHERE id = $1`, [
          id,
          response.status,
          JSON.stringify(response.body),
        ]);
      },
    };
  });
}

