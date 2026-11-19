/** The film ledger: every change is a satchel row and its opposite locker row sharing one change id. */
import { randomUUID } from 'node:crypto'
import type { Db } from './db'
import { one } from './db'

type FilmReason = 'start' | 'photo' | 'page' | 'refill' | 'restart'

/** The film figure: the sum of the player's satchel rows. */
export async function filmOf(db: Db, playerId: string): Promise<number> {
  const row = await one<{ film: number }>(db, `SELECT COALESCE(SUM(amount), 0)::int AS film FROM film_ledger WHERE player_id = $1 AND account = $2`, [playerId, 'satchel'])
  return (row as { film: number }).film
}

/** Writes the paired rows; a change of nothing writes none. */
export async function changeFilm(db: Db, playerId: string, amount: number, reason: FilmReason): Promise<void> {
  if (amount === 0) return
  await db.query(
    `INSERT INTO film_ledger (player_id, change_id, account, amount, reason) VALUES ($1, $2, 'satchel', $3, $4), ($1, $2, 'locker', $5, $4)`,
    [playerId, randomUUID(), amount, reason, -amount],
  )
}
