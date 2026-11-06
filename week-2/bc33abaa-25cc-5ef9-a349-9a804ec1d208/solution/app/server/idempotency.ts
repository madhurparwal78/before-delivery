// Idempotency keys for billing requests (Business rules › Idempotency). Adapted from kit/modules/idempotency:
// the key row is inserted first, so of concurrent duplicates exactly one runs.
import { createHash } from "node:crypto";
import { one, pool } from "./db.js";
import { HttpError, conflict, invalid } from "./errors.js";
import type { AuthedContext, Reply } from "./http.js";

const KEY_PATTERN = /^[\x21-\x7e]{1,200}$/;
const KEPT_MS = 24 * 60 * 60 * 1000;

/** Runs a billing request once per key; a replay returns the stored status and body and changes nothing. */
export async function idempotent(ctx: AuthedContext, work: () => Promise<Reply>): Promise<Reply> {
  const key = ctx.headers["idempotency-key"];
  if (typeof key !== "string" || key === "") throw invalid({ "Idempotency-Key": "Required" });
  if (!KEY_PATTERN.test(key)) throw invalid({ "Idempotency-Key": "Use 1 to 200 visible ASCII characters" });
  const workspace = ctx.caller.workspaceId;
  const fingerprint = createHash("sha256").update(`${ctx.method}\n${ctx.path}\n`).update(ctx.raw).digest("hex");
  const now = new Date();
  await pool.query("DELETE FROM idempotency_keys WHERE workspace_id = $1 AND key = $2 AND created_at < $3", [workspace, key, new Date(now.getTime() - KEPT_MS)]);
  const inserted = await pool.query(
    "INSERT INTO idempotency_keys (workspace_id, key, fingerprint, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
    [workspace, key, fingerprint, now]);
  if (inserted.rowCount === 0) {
    const stored = await one<{ fingerprint: string; status: number | null; body: string | null }>(pool,
      "SELECT fingerprint, status, body FROM idempotency_keys WHERE workspace_id = $1 AND key = $2", [workspace, key]);
    if (!stored || stored.fingerprint !== fingerprint) throw conflict("idempotency_key_reused");
    if (stored.status === null || stored.body === null) throw conflict("request_in_progress");
    return { status: stored.status, body: stored.body, contentType: "application/json; charset=utf-8", headers: { "Idempotent-Replayed": "true" } };
  }
  const keep = (status: number, body: unknown) =>
    pool.query("UPDATE idempotency_keys SET status = $3, body = $4 WHERE workspace_id = $1 AND key = $2", [workspace, key, status, JSON.stringify(body)]);
  try {
    const reply = await work();
    await keep(reply.status, reply.json);
    return reply;
  } catch (error) {
    if (error instanceof HttpError && error.status !== 503) await keep(error.status, error.body);
    else await pool.query("DELETE FROM idempotency_keys WHERE workspace_id = $1 AND key = $2", [workspace, key]);
    throw error;
  }
}
