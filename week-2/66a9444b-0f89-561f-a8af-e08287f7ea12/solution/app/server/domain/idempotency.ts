// Idempotency keys (adapted from kit/modules/idempotency): keys are scoped to the caller and kept 24 hours.
// A duplicate that arrives while the first request runs waits on the same advisory lock, then replays it.
import { createHash } from "node:crypto";
import { db, withConnection } from "../db/index.ts";
import { ApiError, FieldErrors, errorReply, type Ctx, type Reply } from "../http.ts";

const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;
const KEEP_MS = 24 * 3_600_000;

function canonicalJson(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v);
}

function fingerprint(ctx: Ctx, raw: string): string {
  const body = ctx.body === undefined ? raw : canonicalJson(ctx.body);
  return createHash("sha256").update(`${ctx.method}\n${ctx.path}\n${body}`).digest("hex");
}

export async function withIdempotency(ctx: Ctx, raw: string, run: () => Promise<Reply>): Promise<Reply> {
  const key = ctx.headers["idempotency-key"];
  if (typeof key !== "string" || !KEY_RE.test(key)) return errorReply(new FieldErrors({ idempotency_key: "required" }));
  const scope = ctx.user!.id;
  const print = fingerprint(ctx, raw);
  return withConnection(async (conn) => {
    await conn.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [`${scope}\n${key}`]);
    try {
      const stored = await conn.one<{ fingerprint: string; status: number; body: unknown }>(
        "SELECT fingerprint, status, body FROM idempotency_keys WHERE scope = $1 AND key = $2 AND created_at > $3",
        [scope, key, new Date(Date.now() - KEEP_MS)]);
      if (stored) {
        if (stored.fingerprint !== print) return errorReply(new ApiError(409, "idempotency_key_reused"));
        return { status: stored.status, body: stored.body, headers: { "Idempotent-Replay": "true" } };
      }
      const reply = await run();
      if (reply.status < 500) {
        await conn.query(
          `INSERT INTO idempotency_keys (scope, key, fingerprint, status, body, created_at) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (scope, key) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, status = EXCLUDED.status,
             body = EXCLUDED.body, created_at = EXCLUDED.created_at`,
          [scope, key, print, reply.status, JSON.stringify(reply.body ?? null), new Date()]);
      }
      return reply;
    } finally {
      await conn.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [`${scope}\n${key}`]);
    }
  });
}

export async function forgetOldKeys(): Promise<void> {
  await db.query("DELETE FROM idempotency_keys WHERE created_at <= $1", [new Date(Date.now() - KEEP_MS)]);
}
