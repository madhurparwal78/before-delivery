// Idempotency-Key records, shared by every process through PostgreSQL.
// Adapted from kit/modules/idempotency: canonical JSON fingerprint, replay or conflict decision.
import { createHash } from "node:crypto";
import { pool } from "./db.js";
import { fail } from "./http/errors.js";

const KEY_PATTERN = /^[\x21-\x7e]{1,128}$/;
const OWNER_LEASE_SECONDS = 60;
const WAIT_STEP_MS = 50;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function validKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

type Claim = { kind: "owner" } | { kind: "replay"; status: number; body: string };

export interface IdempotencyScope {
  scope: string;
  route: string;
  key: string;
}

/**
 * Claims a key for this request. The first request with a key owns it; a later or concurrent
 * request with the same body waits for the owner's stored response and replays it.
 */
export async function claim(at: IdempotencyScope, body: unknown): Promise<Claim> {
  const fingerprint = createHash("sha256").update(canonicalJson(body)).digest("hex");
  for (;;) {
    await pool.query(
      `DELETE FROM idempotency_records WHERE scope = $1 AND route = $2 AND key = $3
         AND created_at < now() - interval '24 hours'`,
      [at.scope, at.route, at.key],
    );
    const inserted = await pool.query(
      `INSERT INTO idempotency_records (scope, route, key, fingerprint, lease_until)
       VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))
       ON CONFLICT DO NOTHING RETURNING key`,
      [at.scope, at.route, at.key, fingerprint, OWNER_LEASE_SECONDS],
    );
    if (inserted.rowCount === 1) return { kind: "owner" };

    const found = await pool.query<{ fingerprint: string; status: number | null; response_body: string | null; lapsed: boolean }>(
      `SELECT fingerprint, status, response_body, lease_until < now() AS lapsed
         FROM idempotency_records WHERE scope = $1 AND route = $2 AND key = $3`,
      [at.scope, at.route, at.key],
    );
    const record = found.rows[0];
    if (record === undefined) continue;
    if (record.fingerprint !== fingerprint) throw fail.idempotencyConflict();
    if (record.status !== null && record.response_body !== null) {
      return { kind: "replay", status: record.status, body: record.response_body };
    }
    if (record.lapsed) {
      const taken = await pool.query(
        `UPDATE idempotency_records SET lease_until = now() + make_interval(secs => $4)
          WHERE scope = $1 AND route = $2 AND key = $3 AND status IS NULL AND lease_until < now()
          RETURNING key`,
        [at.scope, at.route, at.key, OWNER_LEASE_SECONDS],
      );
      if (taken.rowCount === 1) return { kind: "owner" };
    }
    await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
  }
}

/** Stores the owner's response; a 5xx is never stored, so the same key runs again. */
export async function settle(at: IdempotencyScope, status: number, body: string): Promise<void> {
  if (status >= 500) {
    await pool.query("DELETE FROM idempotency_records WHERE scope = $1 AND route = $2 AND key = $3", [
      at.scope,
      at.route,
      at.key,
    ]);
    return;
  }
  await pool.query(
    "UPDATE idempotency_records SET status = $4, response_body = $5 WHERE scope = $1 AND route = $2 AND key = $3",
    [at.scope, at.route, at.key, status, body],
  );
}
