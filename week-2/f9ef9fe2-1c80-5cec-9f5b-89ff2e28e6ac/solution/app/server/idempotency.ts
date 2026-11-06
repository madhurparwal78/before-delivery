import { createHash } from "node:crypto";
import { pool } from "./db.js";
import type { User } from "./domain.js";
import { refuse } from "./errors.js";
import type { ApiRequest, Reply } from "./http.js";

// Idempotency keys for confirm, series and pack purchase (brief: Idempotency). Adapted from
// kit/modules/idempotency: scope = the signed-in user, fingerprint = method, path and canonical body.

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function fingerprint(request: ApiRequest): string {
  return createHash("sha256").update(`${request.method}\n${request.path}\n${canonicalJson(request.json)}`).digest("hex");
}

/** The request's Idempotency-Key: 1 to 100 printable ASCII characters, else 422. */
export function idempotencyKey(request: ApiRequest): string {
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || !/^[\x20-\x7e]{1,100}$/.test(key)) {
    throw refuse.validation({ "Idempotency-Key": "Send an Idempotency-Key of 1 to 100 printable characters." });
  }
  return key;
}

/**
 * Runs the request once per key. Concurrent requests with one key wait on a PostgreSQL advisory
 * lock and then all answer with the stored 201; failures are not stored, so a retry can succeed.
 */
export async function idempotent(user: User, key: string, request: ApiRequest, run: () => Promise<Reply>): Promise<Reply> {
  const print = fingerprint(request);
  const lock = await pool.connect();
  const lockKey = `${user.id}\n${key}`;
  try {
    await lock.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [lockKey]);
    const stored = await lock.query<{ fingerprint: string; status: number; body: string }>(
      "SELECT fingerprint, status, body FROM idempotency_keys WHERE user_id = $1 AND key = $2",
      [user.id, key],
    );
    const found = stored.rows[0];
    if (found) {
      if (found.fingerprint !== print) throw refuse.idempotencyKeyReused();
      const body: unknown = JSON.parse(found.body);
      return { status: found.status, body };
    }
    const reply = await run();
    if (reply.status === 201 && reply.body !== undefined) {
      await lock.query(
        "INSERT INTO idempotency_keys (user_id, key, fingerprint, status, body, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
        [user.id, key, print, reply.status, JSON.stringify(reply.body), new Date()],
      );
    }
    return reply;
  } finally {
    await lock.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [lockKey]);
    lock.release();
  }
}
