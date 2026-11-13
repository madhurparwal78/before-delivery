import type { PoolClient } from 'pg';
import type { Db } from './db.js';
import { CAPACITY_MS } from './bucket.js';

export const PLAYER_ID_FORMAT = /^[A-Za-z0-9_-]{1,64}$/;

export async function ensurePlayer(db: Db | PoolClient, gameId: string, playerId: string): Promise<void> {
  const created = await db.query('insert into players (game_id, id, name) values ($1, $2, $2) on conflict do nothing returning id', [gameId, playerId]);
  if (created.rowCount) {
    await db.query('insert into buckets (game_id, player_id, credit_ms, refilled_at) values ($1, $2, $3, now()) on conflict do nothing', [gameId, playerId, CAPACITY_MS]);
  }
}
