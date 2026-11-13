import { createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import { IDEMPOTENCY_TTL_MS } from './config'
import { ApiError, fail } from './errors'
import { one, tx } from './db'

interface Stored { status: number; body: unknown }

const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** Serialises concurrent requests that carry the same key, then replays a stored 2xx or 402 reply for a repeat. */
export async function begin(client: PoolClient, scope: string, key: string | undefined, body: unknown, now: Date): Promise<Stored | null> {
  if (!key) return null
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${scope}|${key}`])
  const found = await one<{ body_hash: string; status: number; body: unknown }>(
    client, `SELECT body_hash, status, body FROM idempotency WHERE scope = $1 AND key = $2 AND at > $3`, [scope, key, new Date(now.getTime() - IDEMPOTENCY_TTL_MS)])
  if (!found) return null
  if (found.body_hash !== digest(body)) return fail(409, 'idempotency_conflict')
  return { status: found.status, body: found.body }
}

export async function remember(client: PoolClient, scope: string, key: string | undefined, body: unknown, status: number, reply: unknown, now: Date): Promise<void> {
  if (!key) return
  await client.query(
    `INSERT INTO idempotency (scope, key, body_hash, status, body, at) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (scope, key) DO UPDATE SET body_hash = EXCLUDED.body_hash, status = EXCLUDED.status, body = EXCLUDED.body, at = EXCLUDED.at`,
    [scope, key, digest(body), status, JSON.stringify(reply), now],
  )
}

/** A 402 card refusal is stored with its key (after the failed attempt rolled back), so the same refusal is replayed. */
export async function storeRefusal(scope: string, key: string | undefined, body: unknown, error: ApiError, now: Date): Promise<void> {
  if (!key) return
  await tx((client) => remember(client, scope, key, body, error.status, error.body, now))
}
