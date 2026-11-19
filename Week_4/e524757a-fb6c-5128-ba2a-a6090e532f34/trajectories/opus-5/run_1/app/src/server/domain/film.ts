import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db.js';

export type FilmReason = 'start' | 'photo' | 'page' | 'refill' | 'restart';

export const FULL_FILM = 36;

/** The film figure is always the sum of the player's satchel rows. */
export async function filmCount(db: Queryable, playerId: string): Promise<number> {
  const found = await db.query<{ sum: string | null }>(
    "SELECT sum(amount)::text AS sum FROM film_ledger WHERE player_id = $1 AND account = 'satchel'",
    [playerId],
  );
  return Number(found.rows[0]?.sum ?? 0);
}

/** Every film change writes the satchel row and its opposite locker row under one change id. */
export async function recordFilmChange(
  db: Queryable,
  playerId: string,
  amount: number,
  reason: FilmReason,
): Promise<void> {
  if (amount === 0) return;
  const changeId = randomUUID();
  await db.query(
    `INSERT INTO film_ledger (player_id, change_id, account, amount, reason)
     VALUES ($1, $2, 'satchel', $3, $4), ($1, $2, 'locker', $5, $4)`,
    [playerId, changeId, amount, reason, -amount],
  );
}

export async function setFilm(db: Queryable, playerId: string, target: number, reason: FilmReason): Promise<number> {
  const current = await filmCount(db, playerId);
  await recordFilmChange(db, playerId, target - current, reason);
  return target;
}
