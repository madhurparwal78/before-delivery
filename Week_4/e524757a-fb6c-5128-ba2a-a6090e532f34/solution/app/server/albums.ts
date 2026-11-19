/** Album pages, stamps and the lighthouse, read from the rows at read time. */
import { type Db, rows } from './db'
import { filmOf } from './film'
import { ISLANDS, creaturesOfIsland } from '../shared/island'
import type { Albums, Lighthouse } from '../shared/types'

export const PAGE_TOTAL = 60
const STAMPS_FOR_LIGHTHOUSE = 3

export function lighthouseOf(stamps: number): Lighthouse {
  return stamps >= STAMPS_FOR_LIGHTHOUSE ? 'open' : 'closed'
}

export async function stampCount(db: Db, playerId: string): Promise<number> {
  const [row] = await rows<{ n: number }>(db, 'SELECT COUNT(*)::int AS n FROM stamps WHERE player_id = $1', [playerId])
  return (row as { n: number }).n
}

export async function readAlbums(db: Db, playerId: string): Promise<Albums> {
  const pages = await rows<{ creature_id: string; photo_id: string; total: number }>(
    db,
    'SELECT a.creature_id, a.photo_id, p.total FROM album_pages a JOIN photos p ON p.id = a.photo_id WHERE a.player_id = $1',
    [playerId],
  )
  const stamped = new Set((await rows<{ island: number }>(db, 'SELECT island FROM stamps WHERE player_id = $1', [playerId])).map((s) => s.island))
  const albums = ISLANDS.map((island) => {
    const listed = creaturesOfIsland(island.id).map((creature) => {
      const page = pages.find((p) => p.creature_id === creature.id)
      return { creature: creature.id, creature_name: creature.name, filled: page !== undefined, photo_id: page?.photo_id ?? null, total: page?.total ?? null }
    })
    return { island: island.id, island_name: island.name, pages: listed, pages_filled: listed.filter((p) => p.filled).length, stamp: stamped.has(island.id) }
  })
  return { albums, stamps: stamped.size, lighthouse: lighthouseOf(stamped.size), film: await filmOf(db, playerId) }
}
