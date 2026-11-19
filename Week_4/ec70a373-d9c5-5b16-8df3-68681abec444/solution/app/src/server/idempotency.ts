// Idempotency keys for holds, pack purchases and check-outs: scope, binding, in-flight claim, replay.
import { one, pool, type Db } from "./db.ts";
import { ApiError } from "./http.ts";
import { json, type Reply } from "./router.ts";

/** In-flight claims older than this are treated as abandoned by a crashed process. */
const ABANDONED_MS = 5 * 60_000;

interface KeyClaim {
  scope: string;
  key: string;
}

interface KeyRow {
  binding: string;
  completed: boolean;
  status: number | null;
  body: string | null;
  started_at: Date;
}

/**
 * Claims `key` for this caller and request. Returns the stored reply for a replay, throws
 * `idempotency_in_progress` or `idempotency_conflict`, or returns the claim for a fresh request.
 */
export async function claimKey(scope: string, key: string, binding: string): Promise<KeyClaim | Reply> {
  for (;;) {
    const inserted = await pool.query(
      "INSERT INTO idempotency_keys (scope, key, binding, started_at) VALUES ($1, $2, $3, now()) ON CONFLICT DO NOTHING",
      [scope, key, binding],
    );
    if (inserted.rowCount === 1) return { scope, key };
    const row = await one<KeyRow>(pool, "SELECT binding, completed, status, body, started_at FROM idempotency_keys WHERE scope = $1 AND key = $2", [
      scope,
      key,
    ]);
    if (!row) continue;
    if (row.binding !== binding) throw new ApiError("idempotency_conflict");
    if (row.completed && row.status !== null && row.body !== null) {
      return json(row.status, row.body, { "Idempotent-Replay": "true" });
    }
    if (Date.now() - row.started_at.getTime() < ABANDONED_MS) throw new ApiError("idempotency_in_progress");
    await pool.query("DELETE FROM idempotency_keys WHERE scope = $1 AND key = $2 AND completed = false AND started_at = $3", [
      scope,
      key,
      row.started_at,
    ]);
  }
}

/** Stores the success for replay, inside the transaction that made the effect. */
export async function completeKey(db: Db, claim: KeyClaim, status: number, body: unknown): Promise<Reply> {
  const text = JSON.stringify(body);
  await db.query("UPDATE idempotency_keys SET completed = true, status = $3, body = $4 WHERE scope = $1 AND key = $2", [
    claim.scope,
    claim.key,
    status,
    text,
  ]);
  return json(status, text);
}

/** Frees the key after any refusal, so the next request with it is judged afresh. */
async function releaseKey(claim: KeyClaim): Promise<void> {
  await pool.query("DELETE FROM idempotency_keys WHERE scope = $1 AND key = $2 AND completed = false", [claim.scope, claim.key]);
}

/** Runs a fresh request under its claim: the key is released whenever the request does not succeed. */
export async function withKey(claim: KeyClaim | Reply, work: (claim: KeyClaim) => Promise<Reply>): Promise<Reply> {
  if ("kind" in claim) return claim;
  try {
    return await work(claim);
  } catch (error) {
    await releaseKey(claim);
    throw error;
  }
}
