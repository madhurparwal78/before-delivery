/** Challenge boards: one entry per player per island, the best entered photo, ranked by the photo's own total. */
import { type Db, one, pool, rows, transaction } from './db'
import { ApiError } from './errors'
import { route } from './http'
import { publish } from './live'
import { ownPhoto } from './photos'
import type { PlayerRow } from './players'
import { isIslandId } from './validate'
import { creatureById, islandById } from '../shared/island'
import type { Board, BoardEntry } from '../shared/types'

interface EntryRow extends BoardEntry { player_id: string }

/** Every entry of the island in this world, ranked: total high to low, then the photo's tick earlier first, then the entry made first. */
async function rankedEntries(db: Db, island: number, worldId: string): Promise<EntryRow[]> {
  return rows<EntryRow>(
    db,
    `SELECT ROW_NUMBER() OVER (ORDER BY p.total DESC, p.tick ASC, e.created_at ASC)::int AS rank,
            pl.id AS player_id, pl.name AS player, pl.handle, p.creature_id AS creature, p.total, p.tick, p.id AS photo
     FROM board_entries e JOIN players pl ON pl.id = e.player_id JOIN photos p ON p.id = e.photo_id
     WHERE e.island = $1 AND pl.world_id = $2 ORDER BY rank`,
    [island, worldId],
  )
}

const toEntry = ({ player_id: _player, ...entry }: EntryRow): BoardEntry => ({ ...entry, creature_name: creatureNameOf(entry.creature) })

const creatureNameOf = (id: string): string => (creatureById(id) as NonNullable<ReturnType<typeof creatureById>>).name

function islandOf(param: string | undefined): number {
  const island = Number(param)
  if (!isIslandId(island) || !islandById(island)) throw new ApiError('not_found')
  return island
}

route('GET', '/api/boards/:island', 'required', async (c) => {
  const me = c.player as PlayerRow
  const all = await rankedEntries(pool, islandOf(c.params[0]), me.world_id)
  const text = c.url.searchParams.get('player')
  const shown = text === null ? all : all.filter((entry) => entry.player.toLowerCase().includes(text.toLowerCase()))
  const board: Board = { entries: shown.map(toEntry), total: all.length, shown: shown.length }
  return { status: 200, body: board }
})

route('POST', '/api/boards/:island/entries', 'required', async (c) => {
  const me = c.player as PlayerRow
  const island = islandOf(c.params[0])
  const body = await c.json()
  const photo = await ownPhoto(pool, body.photo, me.id)
  if (!me.confirmed) throw new ApiError('unconfirmed')
  if (photo.island !== island) throw new ApiError('wrong_island')
  const { before, entered } = await transaction(async (client) => {
    await client.query('SELECT id FROM players WHERE id = $1 FOR UPDATE', [me.id])
    const earlier = await one<{ total: number }>(client, 'SELECT p.total FROM board_entries e JOIN photos p ON p.id = e.photo_id WHERE e.island = $1 AND e.player_id = $2', [island, me.id])
    const better = !earlier || photo.total > earlier.total
    if (!earlier) await client.query('INSERT INTO board_entries (island, player_id, photo_id) VALUES ($1, $2, $3)', [island, me.id, photo.id])
    else if (better) await client.query('UPDATE board_entries SET photo_id = $3 WHERE island = $1 AND player_id = $2', [island, me.id, photo.id])
    return { before: earlier, entered: better }
  })
  const mine = (await rankedEntries(pool, island, me.world_id)).find((entry) => entry.player_id === me.id) as EntryRow
  if (entered) await publish(pool, { world: me.world_id }, 'board', { island, player_name: me.name, rank: mine.rank })
  return { status: before ? 200 : 201, body: { entry: toEntry(mine) } }
})
