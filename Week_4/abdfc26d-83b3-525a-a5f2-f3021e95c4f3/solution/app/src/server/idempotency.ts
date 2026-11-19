import { createHash } from "node:crypto";
import type { User } from "./auth.js";
import { config } from "./config.js";
import { one, pool } from "./db.js";
import { ApiError, conflict, validationFailed } from "./errors.js";
import type { Ctx, Reply } from "./http.js";

// Step 5 of the precedence. Records are keyed by user, method, path and Idempotency-Key; the key row
// is inserted before the work runs, so of simultaneous requests exactly one executes.

const KEY_FORMAT = /^[A-Za-z0-9_-]{1,128}$/;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export async function idempotent(ctx: Ctx, user: User, work: () => Promise<Reply>): Promise<Reply> {
  const header = ctx.req.headers["idempotency-key"];
  const key = Array.isArray(header) ? header.join(",") : header;
  if (key === undefined || !KEY_FORMAT.test(key)) {
    throw validationFailed({ "Idempotency-Key": "Send an Idempotency-Key of 1 to 128 letters, digits, - or _." });
  }
  const id = [user.id, ctx.method, ctx.path, key];
  const fingerprint = createHash("sha256").update(canonical(ctx.body)).digest("hex");
  await pool.query(
    `DELETE FROM idempotency_records WHERE user_id = $1 AND method = $2 AND path = $3 AND key = $4
       AND created_at < now() - make_interval(secs => $5)`,
    [...id, config.idempotencyTtlSeconds],
  );
  const inserted = await one(
    pool,
    `INSERT INTO idempotency_records (user_id, method, path, key, fingerprint) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING RETURNING key`,
    [...id, fingerprint],
  );
  if (!inserted) {
    const stored = await one<{ fingerprint: string; status: number | null; body: unknown }>(
      pool,
      "SELECT fingerprint, status, body FROM idempotency_records WHERE user_id = $1 AND method = $2 AND path = $3 AND key = $4",
      id,
    );
    if (!stored) return idempotent(ctx, user, work);
    if (stored.fingerprint !== fingerprint) throw conflict("idempotency_key_reused", "This Idempotency-Key was used with a different request.");
    if (stored.status === null) throw conflict("idempotency_in_progress", "The first request with this Idempotency-Key is still running.");
    return { status: stored.status, body: stored.body, headers: { "Idempotent-Replayed": "true" } };
  }
  let reply: Reply;
  try {
    reply = await work();
  } catch (error) {
    if (!(error instanceof ApiError) || error.status >= 500) {
      await pool.query("DELETE FROM idempotency_records WHERE user_id = $1 AND method = $2 AND path = $3 AND key = $4", id);
      throw error;
    }
    reply = { status: error.status, body: error.body };
  }
  if (reply.status >= 500) {
    await pool.query("DELETE FROM idempotency_records WHERE user_id = $1 AND method = $2 AND path = $3 AND key = $4", id);
  } else {
    await pool.query("UPDATE idempotency_records SET status = $5, body = $6 WHERE user_id = $1 AND method = $2 AND path = $3 AND key = $4", [
      ...id,
      reply.status,
      JSON.stringify(reply.body ?? null),
    ]);
  }
  return reply;
}
