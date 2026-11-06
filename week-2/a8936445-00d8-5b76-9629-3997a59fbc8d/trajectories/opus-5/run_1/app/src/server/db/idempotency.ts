import { pool } from './pool.js';

export interface StoredResponse {
  status: number;
  /** The exact JSON text of the first response, replayed byte for byte. */
  body: string;
}

export type IdempotencyOutcome =
  | { mode: 'run' }
  | { mode: 'replay'; response: StoredResponse }
  | { mode: 'conflict' };

const STORED_STATUSES = new Set([200, 201, 409, 410, 422]);
const WAIT_STEP_MS = 50;
const WAIT_LIMIT_MS = 30_000;

interface RecordRow {
  body_fingerprint: string;
  response_status: number | null;
  response_body: string | null;
}

async function read(
  userId: string,
  method: string,
  path: string,
  key: string,
): Promise<RecordRow | null> {
  const result = await pool.query<RecordRow>(
    `SELECT body_fingerprint, response_status, response_body
       FROM idempotency_records
      WHERE user_id = $1 AND method = $2 AND path = $3 AND idempotency_key = $4`,
    [userId, method, path, key],
  );
  return result.rows[0] ?? null;
}

export async function beginIdempotent(
  userId: string,
  method: string,
  path: string,
  key: string,
  fingerprint: string,
): Promise<IdempotencyOutcome> {
  const inserted = await pool.query(
    `INSERT INTO idempotency_records (user_id, method, path, idempotency_key, body_fingerprint)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING`,
    [userId, method, path, key, fingerprint],
  );
  if (inserted.rowCount === 1) return { mode: 'run' };

  const deadline = Date.now() + WAIT_LIMIT_MS;
  for (;;) {
    const row = await read(userId, method, path, key);
    if (!row) return { mode: 'run' };
    if (row.body_fingerprint !== fingerprint) return { mode: 'conflict' };
    if (row.response_status !== null) {
      return { mode: 'replay', response: { status: row.response_status, body: row.response_body ?? 'null' } };
    }
    if (Date.now() > deadline) return { mode: 'run' };
    await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
  }
}

export async function finishIdempotent(
  userId: string,
  method: string,
  path: string,
  key: string,
  response: StoredResponse,
): Promise<void> {
  if (STORED_STATUSES.has(response.status)) {
    await pool.query(
      `UPDATE idempotency_records
          SET response_status = $5, response_body = $6
        WHERE user_id = $1 AND method = $2 AND path = $3 AND idempotency_key = $4`,
      [userId, method, path, key, response.status, response.body],
    );
    return;
  }
  await pool.query(
    `DELETE FROM idempotency_records
      WHERE user_id = $1 AND method = $2 AND path = $3 AND idempotency_key = $4
        AND response_status IS NULL`,
    [userId, method, path, key],
  );
}
