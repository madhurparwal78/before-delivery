/** The player's own state: position, albums, film, restart, settings, and the world they live in. */
import type { PoolClient } from 'pg'
import { type Db, one, pool, transaction } from './db'
import { ApiError } from './errors'
import { route } from './http'
import { publish } from './live'
import { PLAYER_COLUMNS, type PlayerRow, positionOf, settingsOf, toPlayer } from './players'
import { lighthouseOf, readAlbums, stampCount } from './albums'
import { changeFilm, filmOf } from './film'
import { FULL_ROLL } from '../shared/types'
import { guestOfHost } from './safaris'
import { isHeading, isInteger, isIslandId, readTile } from './validate'
import { readTick, worldAnswer } from './world'
import { HARBOUR, SPOTS, isLand, islandById } from '../shared/island'
import type { Me, Position, Settings } from '../shared/types'

const self = (c: { player: PlayerRow | null }): PlayerRow => c.player as PlayerRow

/** Tells a seated guest where the host now is. */
async function announceHost(db: Db, host: PlayerRow, position: Position): Promise<void> {
  const guest = await guestOfHost(db, host.id)
  if (guest) await publish(db, { players: [guest] }, 'host_position', { island: position.island, tile: position.tile })
}

/** The `/api/me` answer; the page shell carries the same answer so the first screen renders without waiting for it. */
export async function meOf(me: PlayerRow): Promise<Me> {
  const stamps = await stampCount(pool, me.id)
  return { player: toPlayer(me, true), position: positionOf(me), film: await filmOf(pool, me.id), stamps, lighthouse: lighthouseOf(stamps), settings: settingsOf(me) }
}

route('GET', '/api/me', 'required', async (c) => ({ status: 200, body: await meOf(self(c)) }))

route('PUT', '/api/me/position', 'required', async (c) => {
  const me = self(c)
  const body = await c.json()
  const tile = readTile(body.tile)
  if (!isIslandId(body.island) || !tile || !isHeading(body.heading)) throw new ApiError('bad_request')
  if (!isLand(islandById(body.island) as NonNullable<ReturnType<typeof islandById>>, tile[0], tile[1])) throw new ApiError('not_land')
  const moved = (await one<PlayerRow>(pool, `UPDATE players SET island = $2, tile_x = $3, tile_y = $4, heading = $5 WHERE id = $1 RETURNING ${PLAYER_COLUMNS}`, [me.id, body.island, tile[0], tile[1], body.heading])) as PlayerRow
  const position = positionOf(moved)
  await publish(pool, { players: [me.id] }, 'position', { ...position, tab: c.tab })
  await announceHost(pool, me, position)
  return { status: 200, body: { position } }
})

route('GET', '/api/me/albums', 'required', async (c) => ({ status: 200, body: await readAlbums(pool, self(c).id) }))

const lockPlayer = (client: PoolClient, playerId: string): Promise<PlayerRow> =>
  one<PlayerRow>(client, `SELECT ${PLAYER_COLUMNS} FROM players WHERE id = $1 FOR UPDATE`, [playerId]) as Promise<PlayerRow>

route('POST', '/api/me/refill', 'required', async (c) => {
  const me = self(c)
  await transaction(async (client) => {
    const locked = await lockPlayer(client, me.id)
    if (locked.island !== HARBOUR) throw new ApiError('not_at_harbour')
    const film = await filmOf(client, me.id)
    if (film >= FULL_ROLL) throw new ApiError('film_full')
    await changeFilm(client, me.id, FULL_ROLL - film, 'refill')
  })
  await publish(pool, { players: [me.id] }, 'progress', await readAlbums(pool, me.id))
  return { status: 200, body: { film: FULL_ROLL } }
})

route('POST', '/api/me/restart', 'required', async (c) => {
  const me = self(c)
  const start = SPOTS[0] as (typeof SPOTS)[number]
  const moved = await transaction(async (client) => {
    await lockPlayer(client, me.id)
    await client.query('DELETE FROM album_pages WHERE player_id = $1', [me.id])
    await client.query('DELETE FROM stamps WHERE player_id = $1', [me.id])
    await changeFilm(client, me.id, FULL_ROLL - (await filmOf(client, me.id)), 'restart')
    return (await one<PlayerRow>(client, `UPDATE players SET island = $2, tile_x = $3, tile_y = $4, heading = $5 WHERE id = $1 RETURNING ${PLAYER_COLUMNS}`, [me.id, HARBOUR, start.tile[0], start.tile[1], start.heading])) as PlayerRow
  })
  const position = positionOf(moved)
  await publish(pool, { players: [me.id] }, 'restart', { position, progress: await readAlbums(pool, me.id) })
  await announceHost(pool, me, position)
  return { status: 200, body: { position, film: FULL_ROLL, stamps: 0, lighthouse: 'closed' } }
})

route('GET', '/api/me/settings', 'required', async (c) => ({ status: 200, body: { settings: settingsOf(self(c)) } }))

route('PUT', '/api/me/settings', 'required', async (c) => {
  const me = self(c)
  const body = await c.json()
  const volume = (value: unknown): value is number => isInteger(value) && value >= 0 && value <= 100
  if (!volume(body.music) || !volume(body.effects) || (body.graphics !== 'full' && body.graphics !== 'balanced' && body.graphics !== 'light')) throw new ApiError('bad_request')
  const saved = (await one<PlayerRow>(pool, `UPDATE players SET music = $2, effects = $3, graphics = $4 WHERE id = $1 RETURNING ${PLAYER_COLUMNS}`, [me.id, body.music, body.effects, body.graphics])) as PlayerRow
  const settings: Settings = settingsOf(saved)
  return { status: 200, body: { settings } }
})

route('GET', '/api/world', 'required', async (c) => {
  const me = self(c)
  const stamps = await stampCount(pool, me.id)
  return { status: 200, body: worldAnswer(me.world_id, await readTick(pool, me.world_id), lighthouseOf(stamps)) }
})
