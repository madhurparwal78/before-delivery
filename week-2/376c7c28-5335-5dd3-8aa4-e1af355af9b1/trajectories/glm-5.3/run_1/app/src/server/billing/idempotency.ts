import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { pool, one } from "../db";
import { lockName } from "../lockname";
import { ApiError } from "../errors";

// Idempotency keys: scoped to the studio, never expiring. A repeat with the same key
// and body returns the stored response; a different body under the same key is
// refused. Only 200, 201 and 4xx responses are stored. A repeat that arrives while
// the first request is still running waits for it, then follows the same rules.

export function bodyHash(body: unknown): string {
  const normalized = JSON.stringify(body ?? {});
  return createHash("sha256").update(normalized).digest("hex");
}

export function validateKey(key: string | undefined): void {
  // 1 to 100 visible characters; missing or empty answers idempotency_key_required.
  if (key === undefined || key.length === 0) {
    throw new ApiError(400, "idempotency_key_required", "Send an Idempotency-Key header.");
  }
  if (key.length > 100 || /[\u0000-\u001f\u007f]/.test(key)) {
    throw new ApiError(400, "idempotency_key_required", "Send an Idempotency-Key header.");
  }
}

export type StoredResponse = { status: number; body: string } | null;

export async function lookupStored(studioId: string, endpoint: string, key: string, hash: string): Promise<StoredResponse> {
  const row = await one<{ status_code: number; response_body: string; body_hash: string }>(
    pool,
    "SELECT status_code, response_body, body_hash FROM idempotency WHERE studio_id = $1 AND endpoint = $2 AND key = $3",
    [studioId, endpoint, key],
  );
  if (!row) return null;
  if (row.body_hash !== hash) {
    throw new ApiError(409, "idempotency_conflict", "That key was used with a different request body.");
  }
  return { status: row.status_code, body: row.response_body };
}

export async function storeResponse(client: PoolClient | typeof pool, studioId: string, endpoint: string, key: string, hash: string, status: number, body: string): Promise<void> {
  // Only 200, 201 and 4xx responses are stored.
  if (status >= 200 && status < 400 && status !== 200 && status !== 201) return;
  if (status >= 500) return;
  await client.query(
    `INSERT INTO idempotency (studio_id, endpoint, key, body_hash, status_code, response_body, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,now(),now())
     ON CONFLICT (studio_id, endpoint, key) DO NOTHING`,
    [studioId, endpoint, key, hash, status, body],
  );
}

// Serialize a keyed request across instances: a session-level advisory lock held for
// the whole request, so a repeat that arrives mid-flight waits for it.
export async function withKeyLock<T>(studioId: string, endpoint: string, key: string, fn: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  await client.query("SELECT pg_advisory_lock(hashtext($1))", [lockName.idem(studioId, endpoint, key)]);
  try {
    return await fn();
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockName.idem(studioId, endpoint, key)]);
    } finally {
      client.release();
    }
  }
}
