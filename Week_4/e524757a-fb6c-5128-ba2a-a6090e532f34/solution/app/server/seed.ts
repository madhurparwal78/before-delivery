/** The main world and its ranger, seeded idempotently on every serve. */
import type pg from 'pg'
import { one } from './db'
import { createPlayer } from './players'

const MAIN_START_TICK = 6000

export async function seedMainWorld(client: pg.PoolClient): Promise<void> {
  const world = await one<{ id: string }>(client, `SELECT id FROM worlds WHERE kind = 'main'`)
  const worldId =
    world?.id ??
    (
      (await one<{ id: string }>(
        client,
        `INSERT INTO worlds (kind, frozen, tick, anchor_tick, anchor_ms) VALUES ('main', false, $1, $1, (extract(epoch from clock_timestamp()) * 1000)::bigint) RETURNING id`,
        [MAIN_START_TICK],
      )) as { id: string }
    ).id
  if (!(await one(client, 'SELECT 1 FROM players WHERE lower(email) = $1', ['ranger@hushfoot.example']))) {
    await createPlayer(client, { worldId, name: 'Sal Marram', email: 'ranger@hushfoot.example', password: 'Harbour-Ranger-1', confirmed: true, ranger: true })
  }
}
