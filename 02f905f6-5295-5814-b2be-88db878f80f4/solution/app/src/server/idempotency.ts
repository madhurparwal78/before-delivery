// Idempotency-Key handling for intakes, drop-offs, payments and damage confirms, scoped to the user.
import { createHash } from "node:crypto";
import { pool } from "./db";
import { HttpError, type Ctx, type Reply, type SignedInCtx } from "./http";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function fingerprint(ctx: Ctx): string {
  return createHash("sha256")
    .update(`${ctx.req.method}\n${ctx.url.pathname}\n${canonicalJson(ctx.body ?? {})}`)
    .digest("hex");
}

/** A request still marked running after this long is treated as abandoned (its instance died). */
const ABANDONED_MS = 120_000;

interface KeyRow {
  fingerprint: string;
  state: "running" | "done";
  status: number | null;
  body: unknown;
  created_at: Date;
}

export async function idempotent(ctx: SignedInCtx, run: () => Promise<Reply>): Promise<Reply> {
  const user = ctx.user;
  const raw = ctx.req.headers["idempotency-key"];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (key === undefined) return run();
  if (!/^[\x21-\x7e][\x20-\x7e]{0,99}$/.test(key) || /\s$/.test(key)) {
    throw new HttpError(422, "invalid_fields", "Check these fields", {
      fields: { "Idempotency-Key": "Use 1 to 100 printable characters" },
    });
  }
  const print = fingerprint(ctx);
  const claimed = await pool.query(
    `INSERT INTO idempotency_keys (user_id, key, fingerprint, state, created_at) VALUES ($1, $2, $3, 'running', now())
     ON CONFLICT (user_id, key) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, created_at = now()
       WHERE idempotency_keys.state = 'running' AND idempotency_keys.created_at < now() - make_interval(secs => $4)
     RETURNING 1`,
    [user.id, key, print, ABANDONED_MS / 1000],
  );
  if (claimed.rowCount === 0) {
    const stored = (await pool.query<KeyRow>("SELECT * FROM idempotency_keys WHERE user_id = $1 AND key = $2", [user.id, key])).rows[0];
    if (!stored || stored.fingerprint !== print) {
      throw new HttpError(409, "idempotency_conflict", "This Idempotency-Key was used with a different request.");
    }
    if (stored.state === "running") {
      throw new HttpError(409, "idempotency_in_progress", "The first request with this Idempotency-Key is still running.");
    }
    return { status: stored.status ?? 200, body: stored.body, headers: { "Idempotent-Replayed": "true" } };
  }
  let reply: Reply;
  try {
    reply = await run();
  } catch (error) {
    if (error instanceof HttpError && error.status < 500) {
      await store(user.id, key, error.status, { error: error.code, message: error.message, ...error.extra });
    } else {
      await forget(user.id, key);
    }
    throw error;
  }
  if (reply.status >= 500) await forget(user.id, key);
  else await store(user.id, key, reply.status, reply.body ?? null);
  return reply;
}

async function store(userId: number, key: string, status: number, body: unknown): Promise<void> {
  await pool.query(`UPDATE idempotency_keys SET state = 'done', status = $3, body = $4 WHERE user_id = $1 AND key = $2`, [
    userId,
    key,
    status,
    JSON.stringify(body),
  ]);
}

async function forget(userId: number, key: string): Promise<void> {
  await pool.query("DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2", [userId, key]);
}
