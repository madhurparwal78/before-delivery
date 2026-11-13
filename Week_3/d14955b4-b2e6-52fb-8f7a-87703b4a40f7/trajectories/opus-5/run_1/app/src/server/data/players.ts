import type { PoolClient } from 'pg';
import { limits } from '../config';
import { one, pool } from '../db';
import { newId } from '../ids';

export interface PlayerRow {
  id: string;
  game_id: string;
  player_id: string;
  name: string;
}

type Queryable = Pick<PoolClient, 'query'>;

export async function findPlayer(gameId: string, playerId: string): Promise<PlayerRow | null> {
  return one<PlayerRow>(
    `SELECT id, game_id, player_id, name FROM players WHERE game_id = $1 AND player_id = $2`,
    [gameId, playerId],
  );
}

/** The first valid request from an unknown player creates them, named by their id. */
export async function ensurePlayer(
  gameId: string,
  playerId: string,
  client: Queryable = pool,
): Promise<PlayerRow> {
  await client.query(
    `INSERT INTO players (id, game_id, player_id, name) VALUES ($1, $2, $3, $3)
       ON CONFLICT (game_id, player_id) DO NOTHING`,
    [newId('ply'), gameId, playerId],
  );
  const found = await client.query<PlayerRow>(
    `SELECT id, game_id, player_id, name FROM players WHERE game_id = $1 AND player_id = $2`,
    [gameId, playerId],
  );
  const player = found.rows[0] as PlayerRow;
  await client.query(
    `INSERT INTO buckets (player_row_id, tokens, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (player_row_id) DO NOTHING`,
    [player.id, limits.bucketCapacity],
  );
  return player;
}
