// Request keys (steps 6 and 7): keyed calls run once per caller, method, path and key.
// Adapted from kit/modules/idempotency (canonical JSON, replay or conflict).
import { createHash } from "node:crypto";
import type { User } from "./auth.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { ApiError } from "./errors.js";
import { errorReply, json, type Ctx, type Reply } from "./http.js";

const KEY = /^[\x21-\x7e]{1,200}$/;

/** JSON with object keys sorted at every depth and no whitespace, so key order never matters. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v);
}

function canonicalBody(raw: Buffer): string {
  if (raw.length === 0) return canonicalJson({});
  try {
    return canonicalJson(JSON.parse(raw.toString("utf8")));
  } catch {
    return raw.toString("utf8");
  }
}

/**
 * Runs `work` once for this key. A repeat with an equal body answers the stored reply with
 * `Request-Replayed: true`; a different body answers 409; a repeat that arrives while the original
 * runs waits for it (a Postgres advisory lock, so this holds across instances). 503 is never stored.
 */
export async function keyed(ctx: Ctx, user: User, work: () => Promise<Reply>): Promise<Reply> {
  const key = ctx.req.headers["request-key"];
  if (typeof key !== "string" || !KEY.test(key)) {
    throw new ApiError("request_key_required", "Send a Request-Key header of 1 to 200 visible ASCII characters.");
  }
  const body = canonicalBody(ctx.raw);
  const scope = [user.id, ctx.method, ctx.path, key];
  const lockId = createHash("sha256").update(scope.join("\n")).digest().readBigInt64BE(0).toString();
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1::bigint)", [lockId]);
    const { rows } = await client.query<{ body: string; status: number; response: unknown }>(
      `SELECT body, status, response FROM request_keys
        WHERE user_id = $1 AND method = $2 AND path = $3 AND key = $4 AND created_at > $5`,
      [...scope, new Date(Date.now() - config.requestKeyTtlSeconds * 1000)]);
    const stored = rows[0];
    if (stored) {
      if (stored.body !== body) throw new ApiError("request_key_reused", "This request key was already used with a different body.");
      return json(stored.status, stored.response, { "Request-Replayed": "true" });
    }
    let reply: Reply;
    try {
      reply = await work();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      reply = errorReply(error);
    }
    if (reply.status !== 503) {
      await client.query(
        `INSERT INTO request_keys (user_id, method, path, key, body, status, response, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (user_id, method, path, key) DO UPDATE
           SET body = EXCLUDED.body, status = EXCLUDED.status, response = EXCLUDED.response, created_at = EXCLUDED.created_at`,
        [...scope, body, reply.status, JSON.stringify(reply.body ?? null), new Date()]);
    }
    return reply;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1::bigint)", [lockId]);
    client.release();
  }
}
