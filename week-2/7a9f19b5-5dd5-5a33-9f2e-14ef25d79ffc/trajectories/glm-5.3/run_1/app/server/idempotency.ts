/**
 * Idempotency records scoped to caller and endpoint.
 * Only 200, 201 and 402 replies are stored; 503 and 409 retried fresh.
 * The live set tracks requests in flight in this instance; stale in-progress
 * records from earlier failed attempts are healed on the next try.
 */
import type { DbClient } from './db.js'

export class RequestInProgress extends Error {}
export class IdempotencyConflict extends Error {}
export class IdempotencyKeyRequired extends Error {}

const live = new Set<string>()

const live_key = (user_id: number, endpoint: string, key: string): string => `${user_id}|${endpoint}|${key}`

export interface StoredReply {
  in_progress: boolean
  status: number | null
  body: unknown
}

export async function begin_idempotent(
  client: DbClient,
  user_id: number,
  endpoint: string,
  key: string | undefined,
  fingerprint: string,
): Promise<StoredReply | null> {
  if (!key) throw new IdempotencyKeyRequired()
  if (key.length < 1 || key.length > 100) throw new IdempotencyKeyRequired()
  const k = live_key(user_id, endpoint, key)
  if (live.has(k)) throw new RequestInProgress()
  const existing = await client.query(
    `SELECT in_progress, status, body, fingerprint FROM idempotency
     WHERE user_id=$1 AND endpoint=$2 AND key=$3`,
    [user_id, endpoint, key],
  )
  const row = existing.rows[0]
  if (row && row.fingerprint !== fingerprint) throw new IdempotencyConflict()
  if (row && !row.in_progress && row.status !== null) {
    return { in_progress: false, status: row.status, body: JSON.parse(row.body ?? 'null') }
  }
  if (row && row.in_progress) {
    // Stale: no live request holds this key, so the earlier outcome was retryable.
    await client.query(`DELETE FROM idempotency WHERE user_id=$1 AND endpoint=$2 AND key=$3`, [
      user_id,
      endpoint,
      key,
    ])
  }
  await client.query(
    `INSERT INTO idempotency (key, user_id, endpoint, in_progress, fingerprint) VALUES ($1,$2,$3,true,$4)
     ON CONFLICT (user_id, endpoint, key) DO NOTHING`,
    [key, user_id, endpoint, fingerprint],
  )
  live.add(k)
  return null
}

/** Mark the key as no longer in flight in this instance. */
export function release_idempotent(user_id: number, endpoint: string, key: string | undefined): void {
  if (!key) return
  live.delete(live_key(user_id, endpoint, key))
}

export async function store_reply(
  client: DbClient,
  user_id: number,
  endpoint: string,
  key: string,
  status: number,
  body: unknown,
): Promise<void> {
  await client.query(
    `UPDATE idempotency SET in_progress=false, status=$4, body=$5
     WHERE user_id=$1 AND endpoint=$2 AND key=$3`,
    [user_id, endpoint, key, status, JSON.stringify(body)],
  )
}

export async function clear_idempotent(
  client: DbClient,
  user_id: number,
  endpoint: string,
  key: string,
): Promise<void> {
  // Used when the outcome is retryable (503/409): forget the in-flight mark.
  await client.query(`DELETE FROM idempotency WHERE user_id=$1 AND endpoint=$2 AND key=$3`, [
    user_id,
    endpoint,
    key,
  ])
}
