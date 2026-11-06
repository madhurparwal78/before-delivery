import { IDEMPOTENCY_TTL_SECONDS } from '../config';
import { Queryable, db } from '../db';
import { JsonObject } from '../types';

export interface IdempotencyRecord {
  key: string;
  bodyHash: string;
  jobId: string;
  statusCode: number;
  responseBody: JsonObject;
}

/** Keys are scoped per team and kept for 24 hours from first use. */
export async function findIdempotency(
  teamId: string,
  key: string,
  client: Queryable = db,
): Promise<IdempotencyRecord | null> {
  const { rows } = await client.query<{
    key: string;
    body_hash: string;
    job_id: string;
    status_code: number;
    response_body: JsonObject;
  }>(
    `SELECT key, body_hash, job_id, status_code, response_body FROM idempotency_records
      WHERE team_id = $1 AND key = $2 AND created_at > now() - ($3 || ' seconds')::interval`,
    [teamId, key, String(IDEMPOTENCY_TTL_SECONDS)],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    key: row.key,
    bodyHash: row.body_hash,
    jobId: row.job_id,
    statusCode: row.status_code,
    responseBody: row.response_body,
  };
}

export async function storeIdempotency(
  client: Queryable,
  teamId: string,
  record: IdempotencyRecord,
): Promise<void> {
  await client.query(
    `INSERT INTO idempotency_records (team_id, key, body_hash, job_id, status_code, response_body, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())`,
    [teamId, record.key, record.bodyHash, record.jobId, record.statusCode, JSON.stringify(record.responseBody)],
  );
}

export async function forgetExpiredKeys(): Promise<void> {
  await db.query(
    `DELETE FROM idempotency_records WHERE created_at <= now() - ($1 || ' seconds')::interval`,
    [String(IDEMPOTENCY_TTL_SECONDS)],
  );
}
