import { PoolClient } from "pg";
import { ApiError } from "./errors";
import { hashRequest } from "./paging";
import { SessionUser } from "./http";

export interface IdempotencyOutcome {
  replay: { status: number; body: string } | null;
}

/**
 * The one Idempotency-Key handling, applied to every keyed endpoint:
 * a stored response replays for the same request, a different request
 * answers idempotency_conflict, an in-flight first request answers
 * request_in_progress, and a failed request leaves nothing behind.
 */
export async function beginIdempotent(
  client: PoolClient,
  user: SessionUser,
  key: string,
  method: string,
  path: string,
  body: Buffer | null,
): Promise<IdempotencyOutcome> {
  const requestHash = hashRequest(method, path, body);
  const existing = await client.query(
    "SELECT request_hash, response_status, response_body, in_progress FROM idempotency_keys WHERE user_id = $1 AND key = $2 FOR UPDATE",
    [user.id, key],
  );
  if (existing.rowCount === 0) {
    await client.query(
      "INSERT INTO idempotency_keys (user_id, key, method, path, request_hash, in_progress) VALUES ($1, $2, $3, $4, $5, true)",
      [user.id, key, method, path, requestHash],
    );
    return { replay: null };
  }
  const row = existing.rows[0];
  if (row.request_hash !== requestHash) {
    throw new ApiError(409, "idempotency_conflict");
  }
  if (row.in_progress) {
    throw new ApiError(409, "request_in_progress");
  }
  return { replay: { status: row.response_status as number, body: row.response_body as string } };
}

export async function storeIdempotentResponse(
  client: PoolClient,
  user: SessionUser,
  key: string,
  status: number,
  body: string,
): Promise<void> {
  await client.query(
    "UPDATE idempotency_keys SET in_progress = false, response_status = $3, response_body = $4 WHERE user_id = $1 AND key = $2",
    [user.id, key, status, body],
  );
}

/** A failed request frees the key for a brand-new attempt, once its claim is committed. */
export async function releaseIdempotencyMarker(client: PoolClient, user: SessionUser, key: string): Promise<void> {
  await client.query("DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2", [user.id, key]);
}
