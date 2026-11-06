// Idempotency keys for cancel, timesheet submission and approval: only successes are stored.
import { setTimeout as sleep } from "node:timers/promises";
import { one, pool } from "./db.js";
import { ApiError } from "./errors.js";
import type { AuthedCtx, Reply } from "./http.js";

const KEY = /^[\x21-\x7e]{1,128}$/;
const STALE_RUNNING_S = 120;
const WAIT_LIMIT_MS = 60_000;

/** JSON with object keys sorted, so bodies that parse to equal values compare equal. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

interface Stored {
  body: string;
  state: "running" | "done";
  status: number | null;
  response: string | null;
  stale: boolean;
}

/** Runs `action` once per (user, action, target, key); replays its stored success byte for byte. */
export async function idempotent(ctx: AuthedCtx, action: string, target: string, run: () => Promise<Reply>): Promise<Reply> {
  const header = ctx.req.headers["idempotency-key"];
  const key = typeof header === "string" ? header : "";
  if (!KEY.test(key)) throw new ApiError("idempotency_key_required");
  const body = canonical(ctx.body);
  const scope = [ctx.user.id, action, target, key];
  const started = Date.now();

  for (;;) {
    const claimed = await pool.query(
      `INSERT INTO idempotency_keys (user_id, action, target, key, body, state) VALUES ($1, $2, $3, $4, $5, 'running')
       ON CONFLICT DO NOTHING`,
      [...scope, body],
    );
    if (claimed.rowCount === 1) {
      let reply: Reply;
      try {
        reply = await run();
      } catch (error) {
        await pool.query("DELETE FROM idempotency_keys WHERE user_id = $1 AND action = $2 AND target = $3 AND key = $4", scope);
        throw error;
      }
      const text = JSON.stringify(reply.json);
      await pool.query(
        `UPDATE idempotency_keys SET state = 'done', status = $5, response = $6
         WHERE user_id = $1 AND action = $2 AND target = $3 AND key = $4`,
        [...scope, reply.status, text],
      );
      return { status: reply.status, text };
    }
    const stored = await one<Stored>(
      pool,
      `SELECT body, state, status, response, created_at < now() - make_interval(secs => $5) AS stale
       FROM idempotency_keys WHERE user_id = $1 AND action = $2 AND target = $3 AND key = $4`,
      [...scope, STALE_RUNNING_S],
    );
    if (stored?.state === "done" && stored.status !== null && stored.response !== null) {
      if (stored.body !== body) throw new ApiError("idempotency_conflict");
      return { status: stored.status, text: stored.response, headers: { "idempotent-replayed": "true" } };
    }
    if (stored?.state === "running" && stored.stale) {
      await pool.query(
        "DELETE FROM idempotency_keys WHERE user_id = $1 AND action = $2 AND target = $3 AND key = $4 AND state = 'running'",
        scope,
      );
    }
    if (Date.now() - started > WAIT_LIMIT_MS) throw new ApiError("internal");
    if (stored) await sleep(40);
  }
}
