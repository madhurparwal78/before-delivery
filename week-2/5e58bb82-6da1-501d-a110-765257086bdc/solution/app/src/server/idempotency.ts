// Idempotency keys for mission creation and service logging (adapted from kit/modules/idempotency).
import { createHash } from "node:crypto";
import type pg from "pg";
import { only, tx } from "./db.js";
import { conflict, invalid } from "./http.js";
import type { IdempotencyKeyRecord } from "./records.js";

const KEEP_MS = 24 * 60 * 60 * 1000;

function canonicalJson(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v);
}

export function fingerprint(method: string, path: string, body: unknown): string {
  return createHash("sha256").update(`${method}\n${path}\n${canonicalJson(body)}`).digest("hex");
}

interface Outcome {
  status: number;
  body: unknown;
}

/**
 * Runs `work` once per (user, endpoint, key). The key row is inserted first in the effect's transaction,
 * so concurrent duplicates wait on it and then replay the stored response; a refusal rolls the key back.
 */
export async function idempotent(
  userId: string, endpoint: string, key: string | undefined, print: string, work: (db: pg.PoolClient) => Promise<Outcome>,
): Promise<Outcome> {
  if (key === undefined) return tx(work);
  if (key.length < 1 || key.length > 100) {
    throw invalid({ idempotency_key: "Send an Idempotency-Key of 1 to 100 characters" });
  }
  return tx(async (db) => {
    await db.query("DELETE FROM idempotency_keys WHERE user_id = $1 AND endpoint = $2 AND key = $3 AND created_at < $4",
      [userId, endpoint, key, new Date(Date.now() - KEEP_MS)]);
    const inserted = await db.query(
      "INSERT INTO idempotency_keys (user_id, endpoint, key, fingerprint, created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
      [userId, endpoint, key, print, new Date()]);
    if (!inserted.rowCount) {
      // The insert waited for the first request's commit, so a key that already existed holds its stored response.
      const stored = await only<IdempotencyKeyRecord & { status: number }>(db, "SELECT * FROM idempotency_keys WHERE user_id = $1 AND endpoint = $2 AND key = $3 FOR UPDATE",
        [userId, endpoint, key]);
      if (stored.fingerprint !== print) {
        throw conflict("idempotency_conflict", "This idempotency key was already used for a different request.");
      }
      return { status: stored.status, body: stored.response };
    }
    const outcome = await work(db);
    await db.query("UPDATE idempotency_keys SET status = $4, response = $5 WHERE user_id = $1 AND endpoint = $2 AND key = $3",
      [userId, endpoint, key, outcome.status, JSON.stringify(outcome.body)]);
    return outcome;
  });
}
