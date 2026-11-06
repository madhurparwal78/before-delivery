import { query, one, type Tx } from "../db.js";
import { errors } from "../http/errors.js";
import { sha256Hex, shortId } from "../passwords.js";
import type { Request } from "express";

const IDEMPOTENCY_TTL_HOURS = 24;

/** Idempotency keys, scoped to a member, kept 24 hours. */

function bodyHash(body: unknown): string {
  return sha256Hex(typeof body === "string" ? body : JSON.stringify(body ?? null));
}

export interface ReplayOutcome {
  replayed: boolean;
  status: number;
  body: string;
}

/** Looks up an existing key. Returns null when there is none. */
export async function findReplay(memberId: string, key: string): Promise<ReplayOutcome | null> {
  const row = await one<{ status: number; response_body: string }>(
    `SELECT status, response_body FROM idempotency_keys
     WHERE member_id = $1 AND key = $2 AND created_at > now() - interval '${IDEMPOTENCY_TTL_HOURS} hours'`,
    [memberId, key]
  );
  if (!row) return null;
  return { replayed: true, status: row.status, body: row.response_body };
}

async function findReplayTx(tx: Tx, memberId: string, key: string): Promise<ReplayOutcome | null> {
  const row = await tx.one<{ status: number; response_body: string }>(
    `SELECT status, response_body FROM idempotency_keys
     WHERE member_id = $1 AND key = $2 AND created_at > now() - interval '${IDEMPOTENCY_TTL_HOURS} hours'`,
    [memberId, key]
  );
  if (!row) return null;
  return { replayed: true, status: row.status, body: row.response_body };
}

export interface IdempotentRunInput {
  memberId: string;
  key: string;
  body: unknown;
  endpoint: string;
  /** Runs inside the caller's transaction. Throws to abort. Returns [status, json]. */
  execute: (tx: Tx, memberId: string) => Promise<[number, unknown]>;
  /** Fills any transaction-local state the execute step needs. */
  withTransaction: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
}

/**
 * Performs an idempotent action: replays stored responses, refuses changed bodies,
 * and stores the outcome of the first run.
 */
export async function idempotentRun(input: IdempotentRunInput): Promise<{ replayed: boolean; status: number; body: unknown }> {
  const hash = bodyHash(input.body);
  const existing = await input.withTransaction(async (tx) => findReplayTx(tx, input.memberId, input.key));
  if (existing) {
    const storedHash = await input.withTransaction(async (tx) =>
      tx.one<{ request_hash: string }>(`SELECT request_hash FROM idempotency_keys WHERE member_id = $1 AND key = $2`, [input.memberId, input.key])
    );
    if (!storedHash || storedHash.request_hash !== hash) throw errors.idempotencyKeyReused();
    return { replayed: true, status: existing.status, body: JSON.parse(existing.body) as unknown };
  }
  const [status, result] = await input.withTransaction(async (tx) => {
    const inserted = await tx.one<{ key: string }>(
      `INSERT INTO idempotency_keys (member_id, key, endpoint, request_hash, status, response_body)
       VALUES ($1, $2, $3, $4, 0, '')
       ON CONFLICT (member_id, key) DO NOTHING
       RETURNING key`,
      [input.memberId, input.key, input.endpoint, hash]
    );
    if (!inserted) {
      // Another copy inserted first inside this transaction's snapshot; re-read
      const row = await findReplayTx(tx, input.memberId, input.key);
      if (row) {
        const again = await tx.one<{ request_hash: string }>(`SELECT request_hash FROM idempotency_keys WHERE member_id = $1 AND key = $2`, [input.memberId, input.key]);
        if (!again || again.request_hash !== hash) throw errors.idempotencyKeyReused();
        return [row.status, JSON.parse(row.body) as unknown];
      }
    }
    const [status, result] = await input.execute(tx, input.memberId);
    await tx.query(`UPDATE idempotency_keys SET status = $3, response_body = $4 WHERE member_id = $1 AND key = $2`, [
      input.memberId,
      input.key,
      status,
      JSON.stringify(result),
    ]);
    return [status, result];
  });
  return { replayed: false, status, body: result };
}

export function requireIdempotencyKey(req: Request): string {
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || key.length === 0) throw errors.idempotencyKeyRequired();
  return key;
}

export async function cleanupIdempotency(): Promise<void> {
  await query(`DELETE FROM idempotency_keys WHERE created_at < now() - interval '${IDEMPOTENCY_TTL_HOURS} hours'`);
}

export function newMovementId(): string {
  return shortId("mov");
}
