// Idempotency-Key handling for sign and settle (brief: Business rules → Idempotency), adapted from
// kit/modules/idempotency: canonical-JSON fingerprint, (scope, key) rows, replay before any state check.

import { createHash } from "node:crypto";
import { one, type Db } from "./db.js";
import { conflict, type Ctx, type FieldErrors, type Reply } from "./http.js";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function fingerprint(body: unknown): string {
  return createHash("sha256").update(canonical(body)).digest("hex");
}

/** The request's key when it is 1 to 100 characters, else null. */
export function idempotencyKey(ctx: Ctx): string | null {
  const key = ctx.header("Idempotency-Key");
  return key !== undefined && key.length >= 1 && key.length <= 100 ? key : null;
}

export function requireKey(key: string | null, fields: FieldErrors): void {
  if (key === null) fields.add("Idempotency-Key", "Send an Idempotency-Key header of 1 to 100 characters");
}

/** A stored reply for this key: the same body replays it, a different body is refused. */
export async function replay(db: Db, scope: string, key: string | null, body: unknown): Promise<Reply | null> {
  if (key === null) return null;
  const stored = await one<{ fingerprint: string; status: number; body: unknown }>(
    db,
    "SELECT fingerprint, status, body FROM idempotency_keys WHERE scope = $1 AND key = $2",
    [scope, key],
  );
  if (stored === null) return null;
  if (stored.fingerprint !== fingerprint(body)) {
    throw conflict("idempotency_key_reused", "That request was already sent with different details. Reload and try again.");
  }
  return { status: stored.status, json: stored.body };
}

export async function remember(db: Db, scope: string, key: string, body: unknown, reply: Reply): Promise<void> {
  await db.query("INSERT INTO idempotency_keys (scope, key, fingerprint, status, body) VALUES ($1, $2, $3, $4, $5)", [
    scope,
    key,
    fingerprint(body),
    reply.status,
    JSON.stringify(reply.json),
  ]);
}
