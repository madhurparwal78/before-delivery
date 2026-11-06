// Idempotency keys (brief: API › Idempotency), adapted from kit/modules/idempotency. The record is
// inserted inside the effect's own transaction: a concurrent duplicate waits on that row, a failed
// attempt rolls it back, and a stored 2xx is replayed byte for byte by any process.
import { createHash } from "node:crypto";
import type pg from "pg";
import { one } from "./db.js";
import { conflict } from "./errors.js";

/** JSON with object keys sorted at every depth. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

function fingerprint(body: unknown): string {
  return createHash("sha256").update(canonicalJson(body)).digest("hex");
}

interface StoredReply {
  status: number;
  body: string;
}

export interface IdempotencyScope {
  userId: string;
  route: string;
  key: string;
}

/**
 * Claims the key inside `client`'s transaction. Returns the stored reply for a replay, null when this
 * request is the first with the key; a different body under the same key is a 409.
 */
export async function claimKey(client: pg.PoolClient, scope: IdempotencyScope, body: unknown): Promise<StoredReply | null> {
  const print = fingerprint(body);
  const inserted = await client.query(
    `INSERT INTO idempotency_records (user_id, route, key, fingerprint) VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [scope.userId, scope.route, scope.key, print],
  );
  if (inserted.rowCount === 1) return null;
  const stored = await one<{ fingerprint: string; status: number; body: string }>(
    client,
    "SELECT fingerprint, status, body FROM idempotency_records WHERE user_id = $1 AND route = $2 AND key = $3",
    [scope.userId, scope.route, scope.key],
  );
  if (!stored) throw new Error("idempotency record vanished");
  if (stored.fingerprint !== print) throw conflict("idempotency_conflict");
  return { status: stored.status, body: stored.body };
}

/** Keeps a 2xx reply with its key, in the same transaction as the effect. */
export async function storeReply(client: pg.PoolClient, scope: IdempotencyScope, reply: StoredReply): Promise<void> {
  await client.query("UPDATE idempotency_records SET status = $4, body = $5 WHERE user_id = $1 AND route = $2 AND key = $3", [
    scope.userId,
    scope.route,
    scope.key,
    reply.status,
    reply.body,
  ]);
}
