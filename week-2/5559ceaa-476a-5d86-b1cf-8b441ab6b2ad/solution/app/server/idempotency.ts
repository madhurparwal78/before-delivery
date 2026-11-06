import { createHash } from "node:crypto";
import type pg from "pg";
import { one } from "./db.js";
import { ApiError, invalid } from "./errors.js";
import type { Ctx, Reply } from "./http.js";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

interface IdempotentRequest {
  key: string | null;
  fingerprint: string;
}

export function idempotentRequest(ctx: Ctx): IdempotentRequest {
  const raw = ctx.header("Idempotency-Key");
  const key = raw !== undefined && raw.length >= 1 && raw.length <= 100 ? raw : null;
  const fingerprint = createHash("sha256")
    .update(`${ctx.req.method}\n${ctx.url.pathname}\n${canonicalJson(ctx.json())}`)
    .digest("hex");
  return { key, fingerprint };
}

/**
 * A replay of a stored response, an idempotency_conflict, or undefined when the key is new. Holds a transaction
 * lock on (caller, key) so concurrent requests with one key run one at a time and later ones replay.
 */
export async function replayed(db: pg.PoolClient, userId: string, request: IdempotentRequest): Promise<Reply | undefined> {
  if (!request.key) return undefined;
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1 || '/' || $2))", [userId, request.key]);
  const stored = await one<{ fingerprint: string; status: number; body: unknown }>(
    db,
    "SELECT fingerprint, status, body FROM idempotency_keys WHERE user_id = $1 AND key = $2",
    [userId, request.key],
  );
  if (!stored) return undefined;
  if (stored.fingerprint !== request.fingerprint) throw new ApiError("idempotency_conflict");
  return { status: stored.status, body: stored.body };
}

export function requireKey(request: IdempotentRequest): void {
  if (!request.key) throw invalid({ "Idempotency-Key": "Send an Idempotency-Key header of 1 to 100 characters." });
}

export async function remember(
  db: pg.Pool | pg.PoolClient,
  userId: string,
  request: IdempotentRequest,
  reply: Reply,
  subjectUserId: string | null,
): Promise<void> {
  await db.query(
    `INSERT INTO idempotency_keys (user_id, key, fingerprint, status, body, subject_user_id) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, key) DO NOTHING`,
    [userId, request.key, request.fingerprint, reply.status, JSON.stringify(reply.body), subjectUserId],
  );
}
