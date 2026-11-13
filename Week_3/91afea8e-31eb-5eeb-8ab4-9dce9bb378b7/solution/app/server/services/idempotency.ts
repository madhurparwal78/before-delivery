import { createHash } from "node:crypto";
import { config } from "../config.js";
import { query } from "../db.js";
import { ApiError, errorBody } from "../errors.js";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonical(inner)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

interface Outcome {
  status: number;
  body: Record<string, unknown>;
}

const POLL_MS = 100;
const GIVE_UP_MS = 120_000;

/**
 * Keys are scoped to the shopper. The same key with the same body returns the stored outcome (failures included),
 * a second request that arrives while the first still runs waits for it, and a different body is a 409.
 */
export async function withIdempotency(
  accountId: string,
  key: string,
  requestBody: Record<string, unknown>,
  nowMs: number,
  run: () => Promise<Outcome>,
): Promise<Outcome & { replayed: boolean }> {
  const hash = createHash("sha256").update(canonical(requestBody)).digest("hex");
  await query("DELETE FROM idempotency_keys WHERE account_id = $1 AND key = $2 AND created_at <= $3", [accountId, key, nowMs - config.seconds.idempotencyTtl * 1000]);
  const claimed = await query(
    "INSERT INTO idempotency_keys (account_id, key, request_hash, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING key",
    [accountId, key, hash, nowMs],
  );
  if (claimed.length === 0) {
    const deadline = Date.now() + GIVE_UP_MS;
    while (Date.now() < deadline) {
      const [row] = await query<{ request_hash: string; status: number | null; body: Record<string, unknown> | null }>(
        "SELECT request_hash, status, body FROM idempotency_keys WHERE account_id = $1 AND key = $2",
        [accountId, key],
      );
      if (!row) return withIdempotency(accountId, key, requestBody, nowMs, run);
      if (row.request_hash !== hash) throw new ApiError(409, "idempotency_key_reused");
      if (row.status !== null && row.body !== null) return { status: row.status, body: row.body, replayed: true };
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    throw new ApiError(503, "payments_unavailable");
  }
  try {
    const outcome = await run();
    await query("UPDATE idempotency_keys SET status = $3, body = $4 WHERE account_id = $1 AND key = $2", [accountId, key, outcome.status, JSON.stringify(outcome.body)]);
    return { ...outcome, replayed: false };
  } catch (error) {
    if (error instanceof ApiError) {
      await query("UPDATE idempotency_keys SET status = $3, body = $4 WHERE account_id = $1 AND key = $2", [accountId, key, error.status, JSON.stringify(errorBody(error))]);
    } else {
      await query("DELETE FROM idempotency_keys WHERE account_id = $1 AND key = $2", [accountId, key]);
    }
    throw error;
  }
}
