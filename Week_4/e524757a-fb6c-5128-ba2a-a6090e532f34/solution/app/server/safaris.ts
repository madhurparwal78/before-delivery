/** Shared safaris: one host, one guest seat, sightings, and the seat that frees itself when the guest's page is gone. */
import { randomInt } from 'node:crypto'
import { config } from './config'
import { type Db, one, pool, rows } from './db'
import { ApiError } from './errors'
import { route } from './http'
import { publish } from './live'
import type { PlayerRow } from './players'
import { isIslandId, readTile } from './validate'
import { GRID } from '../shared/island'
import type { Safari, SafariStatus, Sighting } from '../shared/types'

interface SafariRow {
  id: string
  world_id: string
  code: string
  host_id: string
  guest_id: string | null
  status: SafariStatus
  host_name: string
  guest_name: string | null
}

const SELECT = `SELECT s.id, s.world_id, s.code, s.host_id, s.guest_id, s.status, h.name AS host_name, g.name AS guest_name
  FROM safaris s JOIN players h ON h.id = s.host_id LEFT JOIN players g ON g.id = s.guest_id`

async function toSafari(db: Db, row: SafariRow): Promise<Safari> {
  const sightings = await rows<Sighting>(db, 'SELECT s.island, s.x, s.y, p.name AS by FROM sightings s JOIN players p ON p.id = s.by_id WHERE s.safari_id = $1 ORDER BY s.id', [row.id])
  return {
    code: row.code,
    status: row.status,
    host: { id: row.host_id, name: row.host_name },
    guest: row.guest_id && row.guest_name ? { id: row.guest_id, name: row.guest_name } : null,
    sightings,
  }
}

const participants = (row: SafariRow): string[] => (row.guest_id ? [row.host_id, row.guest_id] : [row.host_id])

async function safariByCode(db: Db, worldId: string, code: string): Promise<SafariRow> {
  const row = await one<SafariRow>(db, `${SELECT} WHERE s.world_id = $1 AND s.code = $2`, [worldId, code])
  if (!row) throw new ApiError('no_safari')
  return row
}

/** The guest seated at this host's safari, who receives the host's photos and position. */
export async function guestOfHost(db: Db, hostId: string): Promise<string | null> {
  const row = await one<{ guest_id: string }>(db, `SELECT guest_id FROM safaris WHERE host_id = $1 AND status = 'joined'`, [hostId])
  return row?.guest_id ?? null
}

/** Puts a kept photo into the seated guest's feed; returns the guest, if any. */
export async function feedSeatedGuest(db: Db, hostId: string, photoId: string): Promise<string | null> {
  const row = await one<{ guest_id: string | null }>(
    db,
    `WITH seated AS (SELECT id, guest_id FROM safaris WHERE host_id = $1 AND status = 'joined'),
          fed AS (INSERT INTO safari_photos (safari_id, photo_id) SELECT id, $2 FROM seated)
     SELECT guest_id FROM seated`,
    [hostId, photoId],
  )
  return row?.guest_id ?? null
}

export function newCode(): string {
  return Array.from({ length: 6 }, () => String.fromCharCode(65 + randomInt(26))).join('')
}

route('POST', '/api/safaris', 'required', async (c) => {
  const player = c.player as PlayerRow
  const running = (): Promise<SafariRow | undefined> => one<SafariRow>(pool, `${SELECT} WHERE s.host_id = $1 AND s.status <> 'ended'`, [player.id])
  for (let current = await running(); ; current = await running()) {
    if (current) return { status: 200, body: { safari: await toSafari(pool, current) } }
    const made = await one<{ id: string }>(pool, 'INSERT INTO safaris (world_id, code, host_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id', [player.world_id, newCode(), player.id])
    if (made) {
      const row = (await one<SafariRow>(pool, `${SELECT} WHERE s.id = $1`, [made.id])) as SafariRow
      return { status: 201, body: { safari: await toSafari(pool, row) } }
    }
  }
})

route('GET', '/api/safaris/current', 'required', async (c) => {
  const player = c.player as PlayerRow
  const row = await one<SafariRow>(pool, `${SELECT} WHERE (s.host_id = $1 OR s.guest_id = $1) AND s.status <> 'ended' ORDER BY s.created_at DESC LIMIT 1`, [player.id])
  return { status: 200, body: { safari: row ? await toSafari(pool, row) : null } }
})

route('POST', '/api/safaris/:code/join', 'required', async (c) => {
  const player = c.player as PlayerRow
  const row = await safariByCode(pool, player.world_id, c.params[0] as string)
  if (row.guest_id === player.id && row.status === 'joined') return { status: 200, body: { safari: await toSafari(pool, row) } }
  if (row.host_id === player.id) throw new ApiError('own_safari')
  if (row.status === 'ended') throw new ApiError('safari_ended')
  const seated = await one<{ id: string }>(pool, `UPDATE safaris SET guest_id = $2, status = 'joined', guest_seen_at = now() WHERE id = $1 AND status = 'open' RETURNING id`, [row.id, player.id])
  if (!seated) throw new ApiError('safari_full')
  const safari = await toSafari(pool, (await safariByCode(pool, player.world_id, row.code)))
  await publish(pool, { players: [row.host_id, player.id] }, 'safari_joined', { guest_name: player.name, safari })
  const host = (await one<{ island: number; tile_x: number; tile_y: number }>(pool, 'SELECT island, tile_x, tile_y FROM players WHERE id = $1', [row.host_id])) as { island: number; tile_x: number; tile_y: number }
  await publish(pool, { players: [player.id] }, 'host_position', { island: host.island, tile: [host.tile_x, host.tile_y] })
  return { status: 200, body: { safari } }
})

route('POST', '/api/safaris/:code/sightings', 'required', async (c) => {
  const player = c.player as PlayerRow
  const row = await safariByCode(pool, player.world_id, c.params[0] as string)
  if (row.host_id !== player.id) throw new ApiError('not_host')
  if (row.status === 'ended') throw new ApiError('safari_ended')
  const body = await c.json()
  const tile = readTile(body.tile)
  if (!isIslandId(body.island) || !tile || tile.some((n) => n < 0 || n >= GRID)) throw new ApiError('bad_request')
  const marked = await one(pool, `INSERT INTO sightings (safari_id, island, x, y, by_id)
    SELECT id, $2, $3, $4, $5 FROM safaris WHERE id = $1 AND status <> 'ended' RETURNING id`, [row.id, body.island, tile[0], tile[1], player.id])
  if (!marked) throw new ApiError('safari_ended')
  const sighting: Sighting = { island: body.island, x: tile[0], y: tile[1], by: player.name }
  await publish(pool, { players: participants(row) }, 'sighting', { sighting, host_name: player.name })
  return { status: 201, body: { sighting } }
})

route('POST', '/api/safaris/:code/leave', 'required', async (c) => {
  const player = c.player as PlayerRow
  const row = await safariByCode(pool, player.world_id, c.params[0] as string)
  if (row.guest_id !== player.id || row.status !== 'joined') throw new ApiError('no_safari')
  const left = await one(pool, `UPDATE safaris SET guest_id = NULL, status = 'open', guest_seen_at = NULL WHERE id = $1 AND guest_id = $2 AND status = 'joined' RETURNING id`, [row.id, player.id])
  if (!left) throw new ApiError('no_safari')
  const safari = await toSafari(pool, await safariByCode(pool, player.world_id, row.code))
  await publish(pool, { players: [row.host_id, player.id] }, 'safari_left', { guest_name: player.name, safari })
  return { status: 200, body: { safari } }
})

route('POST', '/api/safaris/:code/end', 'required', async (c) => {
  const player = c.player as PlayerRow
  const row = await safariByCode(pool, player.world_id, c.params[0] as string)
  if (row.host_id !== player.id) throw new ApiError('not_host')
  if (row.status === 'ended') throw new ApiError('safari_ended')
  const ended = await one(pool, `UPDATE safaris SET status = 'ended' WHERE id = $1 AND status <> 'ended' RETURNING id`, [row.id])
  if (!ended) throw new ApiError('safari_ended')
  const safari = await toSafari(pool, await safariByCode(pool, player.world_id, row.code))
  await publish(pool, { players: participants(row) }, 'safari_ended', { safari })
  return { status: 200, body: { safari } }
})

/** Frees every seat whose guest's last live stream ended more than the release time ago. */
async function freeSeats(): Promise<void> {
  const freed = await rows<{ id: string; guest_id: string }>(
    pool,
    `WITH stale AS (
       SELECT id, guest_id FROM safaris
       WHERE status = 'joined' AND guest_seen_at < now() - make_interval(secs => $1) FOR UPDATE SKIP LOCKED)
     UPDATE safaris s SET guest_id = NULL, status = 'open', guest_seen_at = NULL FROM stale WHERE s.id = stale.id
     RETURNING s.id, stale.guest_id`,
    [config.safariSeatReleaseSeconds],
  )
  for (const { id, guest_id } of freed) {
    const row = (await one<SafariRow>(pool, `${SELECT} WHERE s.id = $1`, [id])) as SafariRow
    const guest = (await one<{ name: string }>(pool, 'SELECT name FROM players WHERE id = $1', [guest_id])) as { name: string }
    await publish(pool, { players: [row.host_id, guest_id] }, 'safari_left', { guest_name: guest.name, safari: await toSafari(pool, row) })
  }
}

export function startSeatSweeper(): void {
  setInterval(() => void freeSeats().catch(() => undefined), 500)
}
