// Idempotency keys (adapted from kit/modules/idempotency): insert-first in-flight rows, stored 201/402 replays.
import { createHash } from "node:crypto";
import { config } from "../config.js";
import { one, pool } from "../db.js";
import { ApiError } from "../errors.js";

export type Outcome = { status: number; body: unknown };

function canonicalJson(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/** The request's Idempotency-Key, 1 to 200 characters, or the 400 the brief publishes. */
export function requireKey(header: string | string[] | undefined): string {
  const key = Array.isArray(header) ? header[0] : header;
  if (key === undefined || key.length < 1 || key.length > 200) throw new ApiError("idempotency_key_required");
  return key;
}

/**
 * Runs `action` once per (scope, key). A key still running answers request_in_progress; the same key and body
 * replays the stored outcome; a different body answers idempotency_conflict. Only 201 and 402 outcomes are kept.
 */
export async function runOnce(scope: string, key: string, body: unknown, action: () => Promise<Outcome>): Promise<Outcome> {
  const fingerprint = createHash("sha256").update(canonicalJson(body)).digest("hex");
  await pool.query("DELETE FROM idempotency_keys WHERE scope = $1 AND key = $2 AND created_at < clock_timestamp() - make_interval(secs => $3)", [
    scope,
    key,
    config.timers.idempotencyKeyTtl,
  ]);
  const inserted = await one<{ key: string }>(
    pool,
    "INSERT INTO idempotency_keys (scope, key, fingerprint) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING key",
    [scope, key, fingerprint],
  );
  if (!inserted) {
    const stored = await one<{ fingerprint: string; completed: boolean; status: number | null; body: unknown }>(
      pool,
      "SELECT fingerprint, completed, status, body FROM idempotency_keys WHERE scope = $1 AND key = $2",
      [scope, key],
    );
    if (!stored || !stored.completed) throw new ApiError("request_in_progress");
    if (stored.fingerprint !== fingerprint) throw new ApiError("idempotency_conflict");
    return { status: stored.status ?? 200, body: stored.body };
  }
  const keep = (outcome: Outcome): Promise<unknown> =>
    pool.query("UPDATE idempotency_keys SET completed = true, status = $3, body = $4 WHERE scope = $1 AND key = $2", [scope, key, outcome.status, JSON.stringify(outcome.body)]);
  const forget = (): Promise<unknown> => pool.query("DELETE FROM idempotency_keys WHERE scope = $1 AND key = $2", [scope, key]);
  try {
    const outcome = await action();
    if (outcome.status === 201) await keep(outcome);
    else await forget();
    return outcome;
  } catch (error) {
    if (error instanceof ApiError && error.code === "card_declined") await keep({ status: error.status, body: error.body() });
    else await forget();
    throw error;
  }
}
