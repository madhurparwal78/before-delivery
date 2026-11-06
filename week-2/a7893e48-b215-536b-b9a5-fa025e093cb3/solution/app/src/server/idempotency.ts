import { createHash } from "node:crypto";
import type { Actor } from "./auth.js";
import { one, pool } from "./db.js";
import { ApiError, type ApiRequest, type Json, type Reply } from "./http.js";

const KEY = /^[A-Za-z0-9_-]{8,128}$/;

/** JSON with object keys sorted at every depth (kit module idempotency, adapted). */
function canonicalJson(value: Json): string {
  return JSON.stringify(value, (_key, inner: Json) =>
    inner !== null && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner);
}

interface StoredKey { fingerprint: string; status_code: number | null; response: string | null }

/**
 * Runs a Key endpoint once per (user, path, key): a 2xx is stored and replayed byte for byte, an
 * error is forgotten so a retry runs afresh, a different body is idempotency_key_reused and a
 * repeat while the first is still running is request_in_progress.
 */
export async function idempotent(request: ApiRequest, actor: Actor, run: () => Promise<Reply>): Promise<Reply> {
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || !KEY.test(key)) throw new ApiError(400, "idempotency_key_required");
  const fingerprint = createHash("sha256").update(canonicalJson(request.body)).digest("hex");
  const scope = [actor.userId, request.path, key];
  await pool.query("DELETE FROM idempotency_keys WHERE user_id = $1 AND path = $2 AND key = $3 AND created_at < now() - interval '24 hours'", scope);
  const claimed = await pool.query(
    "INSERT INTO idempotency_keys (user_id, path, key, fingerprint, created_at) VALUES ($1, $2, $3, $4, now()) ON CONFLICT DO NOTHING",
    [...scope, fingerprint]);
  if (claimed.rowCount === 0) {
    const stored = await one<StoredKey>(pool, "SELECT fingerprint, status_code, response FROM idempotency_keys WHERE user_id = $1 AND path = $2 AND key = $3", scope);
    if (!stored) return idempotent(request, actor, run);
    if (stored.fingerprint !== fingerprint) throw new ApiError(409, "idempotency_key_reused");
    if (stored.status_code === null || stored.response === null) throw new ApiError(409, "request_in_progress");
    return { status: stored.status_code, body: JSON.parse(stored.response) as Json };
  }
  try {
    const reply = await run();
    if (reply.status >= 200 && reply.status < 300) {
      await pool.query("UPDATE idempotency_keys SET status_code = $4, response = $5 WHERE user_id = $1 AND path = $2 AND key = $3",
        [...scope, reply.status, JSON.stringify(reply.body ?? null)]);
    } else {
      await pool.query("DELETE FROM idempotency_keys WHERE user_id = $1 AND path = $2 AND key = $3", scope);
    }
    return reply;
  } catch (error) {
    await pool.query("DELETE FROM idempotency_keys WHERE user_id = $1 AND path = $2 AND key = $3", scope);
    throw error;
  }
}
