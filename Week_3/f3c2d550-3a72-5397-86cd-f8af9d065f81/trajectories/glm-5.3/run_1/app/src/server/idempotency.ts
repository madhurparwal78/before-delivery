// Idempotency holds and records (Business rules): a Postgres row per method,
// path and key, so holds are visible to every app copy sharing the database.
// Only a success is recorded; any error releases the hold and records nothing.

import type { Pool } from "pg";

export type IdempotencyResult =
  | { kind: "acquired" }
  | { kind: "in_flight" }
  | { kind: "replay"; status: number; body: string }
  | { kind: "content_conflict" };

export interface IdempotencyOutcome { result: IdempotencyResult; release: () => Promise<void> }

// Acquire a hold for (method, path, key). `requestHash` identifies the content of
// the request for replays. The hold is a row with state 'hold'; a success replaces
// it with the recorded response; an error releases it entirely.
export async function idempotencyAcquire(
  pool: Pool,
  method: string,
  path: string,
  key: string,
  requestHash: string,
): Promise<IdempotencyOutcome> {
  const { rows } = await pool.query(
    `INSERT INTO idempotency (method, path, key, state, request_hash)
     VALUES ($1, $2, $3, 'hold', $4)
     ON CONFLICT (method, path, key) DO UPDATE SET
       key = EXCLUDED.key, created_at = idempotency.created_at
     WHERE idempotency.state = 'hold' OR idempotency.state = 'recorded'
     RETURNING idempotency.state, idempotency.request_hash,
       idempotency.response_status, idempotency.response_body, idempotency.created_at, (xmax = 0) AS inserted`,
    [method, path, key, requestHash],
  );
  if (rows.length === 0) {
    return { result: { kind: "in_flight" }, release: async () => {} };
  }
  const row = rows[0];
  if (row.inserted) {
    return {
      result: { kind: "acquired" },
      release: async () => {
        await pool.query(
          `DELETE FROM idempotency WHERE method = $1 AND path = $2 AND key = $3 AND state = 'hold'`,
          [method, path, key],
        );
      },
    };
  }
  if (row.state === "hold") return { result: { kind: "in_flight" }, release: async () => {} };
  if (row.state === "recorded") {
    if (row.request_hash === requestHash) {
      return { result: { kind: "replay", status: row.response_status, body: row.response_body }, release: async () => {} };
    }
    return { result: { kind: "content_conflict" }, release: async () => {} };
  }
  return { result: { kind: "in_flight" }, release: async () => {} };
}

// Record a success against the key, replacing the hold.
export async function idempotencyRecord(
  pool: Pool,
  method: string,
  path: string,
  key: string,
  requestHash: string,
  status: number,
  body: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO idempotency (method, path, key, state, request_hash, response_status, response_body)
     VALUES ($1, $2, $3, 'recorded', $4, $5, $6)
     ON CONFLICT (method, path, key) DO UPDATE SET
       state = 'recorded', request_hash = EXCLUDED.request_hash,
       response_status = EXCLUDED.response_status, response_body = EXCLUDED.response_body, created_at = now()`,
    [method, path, key, requestHash, status, body],
  );
}

// Purge holds and records older than 24 hours.
export async function idempotencySweep(pool: Pool): Promise<void> {
  await pool.query(`DELETE FROM idempotency WHERE created_at < now() - interval '24 hours'`);
}
