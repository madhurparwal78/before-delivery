import type { Db } from './db.js';

export interface IdempotencyRecord {
  body_hash: string;
  in_progress: boolean;
  status_code: number | null;
  response_body: unknown;
}

/**
 * Claims the key for this request. Returns null when the claim is new, or the
 * stored record when the same key has been seen inside its 24-hour life.
 */
export async function claimIdempotency(
  db: Db,
  scope: string,
  route: string,
  key: string,
  bodyHash: string,
): Promise<IdempotencyRecord | null> {
  const result = await db.query<IdempotencyRecord>(
    `insert into idempotency_records (scope, route, key, body_hash, in_progress)
     values ($1, $2, $3, $4, true)
     on conflict (scope, route, key) do update
       set body_hash = excluded.body_hash
       where idempotency_records.created_at < now() - interval '24 hours'
     returning body_hash, in_progress, status_code, response_body`,
    [scope, route, key, bodyHash],
  );
  if (result.rows.length > 0) {
    // The insert or the expiry-driven update won, so this request owns the key.
    await db.query(
      `update idempotency_records set in_progress = true, status_code = null,
         response_body = null, created_at = now()
       where scope = $1 and route = $2 and key = $3`,
      [scope, route, key],
    );
    return null;
  }
  const existing = await db.query<IdempotencyRecord>(
    `select body_hash, in_progress, status_code, response_body
     from idempotency_records where scope = $1 and route = $2 and key = $3`,
    [scope, route, key],
  );
  return existing.rows[0] ?? null;
}

export async function storeIdempotency(
  db: Db,
  scope: string,
  route: string,
  key: string,
  statusCode: number,
  body: unknown,
): Promise<void> {
  await db.query(
    `update idempotency_records set in_progress = false, status_code = $4, response_body = $5::jsonb
     where scope = $1 and route = $2 and key = $3`,
    [scope, route, key, statusCode, JSON.stringify(body)],
  );
}

/** A 503 answer is not stored, so the same key may retry after an outage. */
export async function releaseIdempotency(
  db: Db,
  scope: string,
  route: string,
  key: string,
): Promise<void> {
  await db.query(
    'delete from idempotency_records where scope = $1 and route = $2 and key = $3',
    [scope, route, key],
  );
}
