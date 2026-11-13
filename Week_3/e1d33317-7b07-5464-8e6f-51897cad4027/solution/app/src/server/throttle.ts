// The per-collaborator operation throttle: 120 accepted operations per 10-second window on the server clock.
// The count lives in Postgres so every instance, and every request, sees the same total.

import { rateLimited } from './errors.js'
import { query } from './db.js'

const WINDOW_MS = 10_000
const LIMIT = 120

const windowOf = (now: number): number => Math.floor(now / WINDOW_MS)

/** Counts `count` operations against the window in one statement; throws the 429 when the window would pass 120. */
export async function takeOperations(collaboratorId: string, count: number): Promise<number> {
  const now = Date.now()
  const window = windowOf(now)
  const accepted = count <= LIMIT && (await query<{ taken: number }>(
    `INSERT INTO op_throttle (collaborator_id, window_start, taken) VALUES ($1, $2, $3)
     ON CONFLICT (collaborator_id) DO UPDATE SET
       window_start = EXCLUDED.window_start,
       taken = CASE WHEN op_throttle.window_start = EXCLUDED.window_start THEN op_throttle.taken ELSE 0 END + EXCLUDED.taken
     WHERE (CASE WHEN op_throttle.window_start = EXCLUDED.window_start THEN op_throttle.taken ELSE 0 END) + EXCLUDED.taken <= ${LIMIT}
     RETURNING taken`,
    [collaboratorId, window, count])).length === 1
  if (!accepted) throw rateLimited(Math.max(1, Math.ceil(((window + 1) * WINDOW_MS - now) / 1000)))
  return window
}

/** Refused operations do not count: gives back what `takeOperations` took in `window`. */
export async function refundOperations(collaboratorId: string, count: number, window: number): Promise<void> {
  await query('UPDATE op_throttle SET taken = GREATEST(taken - $3, 0) WHERE collaborator_id = $1 AND window_start = $2', [collaboratorId, window, count])
}
