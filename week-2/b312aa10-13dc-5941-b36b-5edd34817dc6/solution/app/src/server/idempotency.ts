// Retry-safe requests: a key is scoped to the signed-in person and kept for 24 hours. A repeat
// with the same path and body gets the stored status and body; a repeat still running is waited for.

import { createHash } from "node:crypto";
import { pool } from "./db.js";
import { ApiError, apiError, errorBody, type Ctx, type Reply } from "./http.js";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

const fingerprint = (ctx: Ctx): string =>
  createHash("sha256").update(`${ctx.method}\n${ctx.path}\n${canonical(ctx.body)}`).digest("hex");

const WAIT_MS = 60_000;

export async function idempotent(ctx: Ctx, run: () => Promise<Reply>): Promise<Reply> {
  const person = ctx.session!.person.id;
  const key = String(ctx.headers["idempotency-key"]);
  const print = fingerprint(ctx);
  const deadline = Date.now() + WAIT_MS;
  await pool.query("DELETE FROM idempotency_keys WHERE person_id = $1 AND key = $2 AND created_at < now() - interval '24 hours'", [person, key]);
  for (;;) {
    const inserted = await pool.query(
      "INSERT INTO idempotency_keys (person_id, key, fingerprint) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [person, key, print],
    );
    if (inserted.rowCount) {
      let reply: Reply;
      try {
        reply = await run();
      } catch (error) {
        if (!(error instanceof ApiError)) {
          await pool.query("DELETE FROM idempotency_keys WHERE person_id = $1 AND key = $2", [person, key]);
          throw error;
        }
        reply = { status: error.status, body: errorBody(error) };
      }
      await pool.query("UPDATE idempotency_keys SET status_code = $3, body = $4 WHERE person_id = $1 AND key = $2",
        [person, key, reply.status, JSON.stringify(reply.body)]);
      return reply;
    }
    const { rows } = await pool.query("SELECT fingerprint, status_code, body FROM idempotency_keys WHERE person_id = $1 AND key = $2", [person, key]);
    const stored = rows[0];
    if (stored && stored.fingerprint !== print) {
      throw apiError(409, "idempotency_key_reused");
    }
    if (stored && stored.status_code !== null) return { status: stored.status_code, body: JSON.parse(stored.body) };
    if (Date.now() > deadline) throw apiError(409, "idempotency_key_reused");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
