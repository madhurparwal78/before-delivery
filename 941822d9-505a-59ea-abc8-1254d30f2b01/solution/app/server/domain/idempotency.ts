import { createHash } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { db, one, withLock } from "../db.js";
import { conflict, fail } from "../http/errors.js";
import type { Reply } from "../http/router.js";

// Idempotent creates (checkout, pack purchase): keys are scoped to the signed-in user and only successes are stored.

const KEY_RE = /^[\x20-\x7e]{8,128}$/;

export function idempotencyKey(headers: IncomingHttpHeaders): string {
  const key = headers["idempotency-key"];
  if (typeof key !== "string" || !KEY_RE.test(key)) throw fail(400, "idempotency_key_required");
  return key;
}

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

/**
 * Runs `create` once per (user, key). A repeat with the same body returns the stored response; a different body is
 * refused; concurrent requests with one key wait for the first. A failure stores nothing, so the key stays unused.
 */
export async function idempotent(userId: string, key: string, body: Record<string, unknown>, now: Date, create: () => Promise<Reply>): Promise<Reply> {
  const requestHash = createHash("sha256").update(canonical(body)).digest("hex");
  return withLock(`idempotency:${userId}:${key}`, async () => {
    const stored = await one<{ request_hash: string; status: number; response: string }>(
      db,
      "SELECT request_hash, status, response FROM idempotency_keys WHERE user_id = $1 AND key = $2",
      [userId, key],
    );
    if (stored) {
      if (stored.request_hash !== requestHash) throw conflict("idempotency_key_reused");
      return { status: stored.status, json: JSON.parse(stored.response) as unknown };
    }
    const reply = await create();
    await db.q("INSERT INTO idempotency_keys (user_id, key, request_hash, status, response, created_at) VALUES ($1, $2, $3, $4, $5, $6)", [
      userId,
      key,
      requestHash,
      reply.status,
      JSON.stringify(reply.json),
      now,
    ]);
    return reply;
  });
}
