/** Idempotency: scoped stored-response replay with reuse refusal. */
import { Pool, PoolClient } from 'pg';
import { createHash } from 'node:crypto';

export interface StoredResponse {
  status: number;
  body: Buffer;
  headers: Record<string, string>;
}

export function keyShape(key: string | null): boolean {
  return key !== null && /^[A-Za-z0-9_-]{1,64}$/.test(key);
}

export function bodySha(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** Try to claim an idempotency slot. Returns:
 *  - { kind: 'fresh' } when nothing exists yet (row inserted in flight)
 *  - { kind: 'replay', response } when the same key+body was stored
 *  - { kind: 'in_flight_wait' } when a duplicate is in flight
 *  - throws 'reused' when the same key holds a different body
 */
export async function claimIdempotency(
  db: Pool | PoolClient,
  userId: string,
  key: string,
  method: string,
  path: string,
  body: Buffer,
): Promise<{ kind: 'fresh' } | { kind: 'replay'; response: StoredResponse } | { kind: 'wait' }> {
  const sha = bodySha(body);
  // try insert
  const ins = await db.query(
    `INSERT INTO idempotency (user_id, key, method, path, body_sha256, status, response_body, response_headers, in_flight)
     VALUES ($1,$2,$3,$4,$5,0,'','{}',true)
     ON CONFLICT (user_id, key, method, path) DO NOTHING
     RETURNING (xmax = 0) AS inserted`,
    [userId, key, method, path, sha],
  );
  if (ins.rows.length > 0 && ins.rows[0].inserted) {
    return { kind: 'fresh' };
  }
  // existing row
  const sel = await db.query(
    `SELECT body_sha256, status, response_body, response_headers, in_flight FROM idempotency
     WHERE user_id=$1 AND key=$2 AND method=$3 AND path=$4`,
    [userId, key, method, path],
  );
  const row = sel.rows[0];
  if (!row) return { kind: 'fresh' }; // lost a race with cleanup: treat as fresh
  if (row.body_sha256 !== sha) {
    const err = new Error('reused');
    (err as { code?: string }).code = 'idempotency_key_reused';
    throw err;
  }
  if (row.in_flight) return { kind: 'wait' };
  if (row.status >= 500) return { kind: 'fresh' };
  return {
    kind: 'replay',
    response: {
      status: row.status,
      body: Buffer.from(row.response_body, 'utf8'),
      headers: row.response_headers as Record<string, string>,
    },
  };
}

export async function storeResponse(
  db: Pool | PoolClient,
  userId: string,
  key: string,
  method: string,
  path: string,
  body: Buffer,
  status: number,
  responseBody: string,
  headers: Record<string, string>,
): Promise<void> {
  await db.query(
    `UPDATE idempotency
     SET status=$6, response_body=$7, response_headers=$8, in_flight=false
     WHERE user_id=$1 AND key=$2 AND method=$3 AND path=$4 AND body_sha256=$5`,
    [userId, key, method, path, bodySha(body), status, responseBody, JSON.stringify(headers)],
  );
}

export async function releaseClaim(
  db: Pool | PoolClient,
  userId: string,
  key: string,
  method: string,
  path: string,
): Promise<void> {
  await db.query(
    `DELETE FROM idempotency WHERE user_id=$1 AND key=$2 AND method=$3 AND path=$4 AND in_flight=true`,
    [userId, key, method, path],
  );
}
