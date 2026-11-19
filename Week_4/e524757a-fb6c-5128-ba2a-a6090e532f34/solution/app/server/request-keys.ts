/** Request keys: a repeat of a post with the same key and body returns the first answer and creates nothing. */
import { createHash } from 'node:crypto'
import { type Context } from './http'
import { type Db, one, pool } from './db'
import { ApiError } from './errors'
import { stable } from './validate'

interface Remembered { status: number; body: unknown }

interface KeyState {
  key: string | null
  hash: string
  /** The first answer, when this key and body were seen before. */
  replay: Remembered | null
  /** The key was used with another body. */
  used: boolean
}

function requestKeyOf(c: Context): string | null {
  const key = c.req.headers['request-key']
  return typeof key === 'string' && key !== '' ? key : null
}

export async function lookUp(playerId: string, kind: string, c: Context, body: Record<string, unknown>): Promise<KeyState> {
  const key = requestKeyOf(c)
  const hash = createHash('sha256').update(stable(body)).digest('hex')
  const stored = key ? await one<{ body_hash: string; status: number; response: unknown }>(pool, 'SELECT body_hash, status, response FROM request_keys WHERE player_id = $1 AND kind = $2 AND key = $3', [playerId, kind, key]) : undefined
  return { key, hash, replay: stored && stored.body_hash === hash ? { status: stored.status, body: stored.response } : null, used: stored !== undefined && stored.body_hash !== hash }
}

export function assertUnused(state: KeyState): void {
  if (state.used) throw new ApiError('request_key_reused')
}

export async function remember(db: Db, playerId: string, kind: string, state: KeyState, answer: Remembered): Promise<void> {
  if (state.key) await db.query('INSERT INTO request_keys (player_id, kind, key, body_hash, status, response) VALUES ($1, $2, $3, $4, $5, $6)', [playerId, kind, state.key, state.hash, answer.status, answer.body])
}
