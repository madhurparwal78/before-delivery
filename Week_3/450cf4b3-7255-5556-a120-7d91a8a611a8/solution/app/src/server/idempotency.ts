// Idempotency keys (adapted from kit/modules/idempotency): a key belongs to the signed-in user
// and the endpoint, lives in Postgres, and replays the first 2xx exactly as it was sent.

import { createHash } from "node:crypto";
import { db } from "./db.js";
import { ApiError, conflict } from "./errors.js";
import { col, type Queryable } from "./postgres.js";

const LEASE_SECONDS = 45;
const KEY_PATTERN = /^[\x21-\x7e]{1,100}$/;

export interface KeyClaim {
  userId: string;
  endpoint: string;
  key: string;
}

type Begin =
  | { kind: "run"; claim: KeyClaim }
  | { kind: "replay"; status: number; body: string };

export function isIdempotencyKey(value: string | undefined): value is string {
  return value !== undefined && KEY_PATTERN.test(value);
}

/** JSON with object keys sorted at every depth and no whitespace. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v);
}

export function fingerprint(body: unknown): string {
  return createHash("sha256").update(canonicalJson(body)).digest("hex");
}

export async function beginKey(userId: string, endpoint: string, key: string, print: string): Promise<Begin> {
  return db.transaction(async (tx) => {
    const inserted = await tx.query(
      `INSERT INTO idempotency_keys (user_id, endpoint, key, fingerprint, state, lease_until)
       VALUES ($1, $2, $3, $4, 'running', now() + make_interval(secs => $5))
       ON CONFLICT DO NOTHING RETURNING key`,
      [userId, endpoint, key, print, LEASE_SECONDS],
    );
    const claim = { userId, endpoint, key };
    if (inserted.length === 1) return { kind: "run", claim };
    const [row] = await tx.query(
      `SELECT fingerprint, state, response_status, response_body, lease_until < now() AS lapsed
         FROM idempotency_keys WHERE user_id = $1 AND endpoint = $2 AND key = $3 FOR UPDATE`,
      [userId, endpoint, key],
    );
    if (!row) throw new ApiError(409, "idempotency_in_progress", "An earlier request with this Idempotency-Key is still running.");
    if (col.text(row, "fingerprint") !== print) {
      throw conflict("idempotency_conflict", "This Idempotency-Key was already used with a different request.");
    }
    if (col.text(row, "state") === "done") {
      return { kind: "replay", status: col.int(row, "response_status"), body: col.text(row, "response_body") };
    }
    if (!col.bool(row, "lapsed")) {
      throw conflict("idempotency_in_progress", "An earlier request with this Idempotency-Key is still running.");
    }
    await tx.query(
      `UPDATE idempotency_keys SET lease_until = now() + make_interval(secs => $4)
        WHERE user_id = $1 AND endpoint = $2 AND key = $3`,
      [userId, endpoint, key, LEASE_SECONDS],
    );
    return { kind: "run", claim };
  });
}

/** Stores a 2xx response under the key; also used by purchase recovery, inside its own transaction. */
export async function storeResponse(tx: Queryable, claim: KeyClaim, print: string, status: number, body: string): Promise<void> {
  await tx.query(
    `INSERT INTO idempotency_keys (user_id, endpoint, key, fingerprint, state, lease_until, response_status, response_body)
     VALUES ($1, $2, $3, $4, 'done', now(), $5, $6)
     ON CONFLICT (user_id, endpoint, key)
     DO UPDATE SET state = 'done', response_status = $5, response_body = $6`,
    [claim.userId, claim.endpoint, claim.key, print, status, body],
  );
}

/** After any non-2xx the key is forgotten, so the same key can be retried and runs fresh. */
export async function releaseKey(claim: KeyClaim): Promise<void> {
  await db.query(
    "DELETE FROM idempotency_keys WHERE user_id = $1 AND endpoint = $2 AND key = $3 AND state = 'running'",
    [claim.userId, claim.endpoint, claim.key],
  );
}
