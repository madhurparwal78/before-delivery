import { createHash } from "node:crypto";
import { ApiError } from "../errors.js";
import type { Pool } from "pg";

/** Idempotency keys are scoped to the calling account and kept for the account's life. */
export async function checkIdempotency(
  pool: Pool,
  userId: string,
  key: string | undefined,
  body: unknown,
): Promise<{ status: number; body: unknown } | null> {
  if (key === undefined || key === "") {
    throw new ApiError("validation", "An Idempotency-Key header is required.", {
      fields: { "Idempotency-Key": "is required" },
    });
  }
  if (key.length < 1 || key.length > 100) {
    throw new ApiError("validation", "The Idempotency-Key must be 1 to 100 characters.", {
      fields: { "Idempotency-Key": "must be 1 to 100 characters" },
    });
  }
  const hash = createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
  const r = await pool.query(
    `SELECT request_hash, status, response_body FROM idempotency WHERE user_id = $1 AND key = $2`,
    [userId, key],
  );
  if (r.rowCount === 0) return null;
  const row = r.rows[0] as { request_hash: string; status: number; response_body: unknown };
  if (row.request_hash !== hash) {
    throw new ApiError("idempotency_conflict", "This Idempotency-Key was used with a different body.");
  }
  return { status: row.status, body: row.response_body };
}

export async function storeIdempotency(
  pool: Pool,
  userId: string,
  key: string,
  body: unknown,
  status: number,
  response: unknown,
): Promise<void> {
  const hash = createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
  await pool.query(
    `INSERT INTO idempotency (user_id, key, request_hash, status, response_body)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (user_id, key) DO NOTHING`,
    [userId, key, hash, status, JSON.stringify(response)],
  );
}
