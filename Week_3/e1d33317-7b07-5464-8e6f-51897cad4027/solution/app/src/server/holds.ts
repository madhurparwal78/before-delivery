// Holds: at most one per staff, granted all-or-nothing, owned by one live connection.

import type { Author, Hold } from '../shared/protocol.js'
import { query, transaction } from './db.js'
import { type Seat, requireStaves } from './auth.js'
import { holdRequired, notConnected, staffHeld, validation } from './errors.js'
import { broadcast } from './hub.js'
import type { ScoreState } from './state.js'

interface HoldRow {
  staff_id: string
  holder_id: string
  holder_name: string
  holder_role: Author['role']
  since: Date
}

const SELECT_HOLDS = `SELECT h.staff_id, h.holder_id, c.name AS holder_name, c.role AS holder_role, h.since
  FROM holds h JOIN collaborators c ON c.id = h.holder_id WHERE h.score_id = $1 ORDER BY h.since, h.staff_id`

const toHold = (row: HoldRow): Hold => ({
  staffId: row.staff_id, holder: { id: row.holder_id, name: row.holder_name, role: row.holder_role }, since: row.since.toISOString(),
})

export async function listHolds(scoreId: string): Promise<Hold[]> {
  return (await query<HoldRow>(SELECT_HOLDS, [scoreId])).map(toHold)
}

async function publishHolds(scoreId: string): Promise<void> {
  broadcast(scoreId, { type: 'holds', holds: await listHolds(scoreId) })
}

export async function registerConnection(id: string, scoreId: string, collaboratorId: string, instanceId: string): Promise<void> {
  await query('INSERT INTO connections (id, score_id, collaborator_id, instance_id) VALUES ($1, $2, $3, $4)', [id, scoreId, collaboratorId, instanceId])
}

/** Refreshes the connections this instance still holds open; a crashed instance's rows go stale and are swept. */
export async function touchConnections(openIds: string[]): Promise<void> {
  await query('UPDATE connections SET seen_at = now() WHERE id = ANY($1)', [openIds])
}

/** Removes a closed connection and its holds. */
export async function endConnection(connectionId: string, scoreId: string): Promise<void> {
  const released = await query('DELETE FROM holds WHERE connection_id = $1 RETURNING staff_id', [connectionId])
  await query('DELETE FROM connections WHERE id = $1', [connectionId])
  if (released.length) await publishHolds(scoreId)
}

/** Connections whose owner stopped refreshing them (a crashed instance) are treated as dropped. */
export async function sweepStaleConnections(): Promise<void> {
  const stale = await query<{ id: string; score_id: string }>("SELECT id, score_id FROM connections WHERE seen_at < now() - interval '30 seconds'")
  for (const { id, score_id } of stale) await endConnection(id, score_id)
}

export async function releaseAllOf(scoreId: string, collaboratorId: string): Promise<void> {
  const released = await query('DELETE FROM holds WHERE score_id = $1 AND holder_id = $2 RETURNING staff_id', [scoreId, collaboratorId])
  if (released.length) await publishHolds(scoreId)
}

function knownStaves(state: ScoreState, staffIds: unknown): string[] {
  if (!Array.isArray(staffIds) || staffIds.length < 1 || staffIds.length > 64 || !staffIds.every((id) => typeof id === 'string')) {
    throw validation({ staffIds: 'Choose 1 to 64 staves.' })
  }
  const ids = [...new Set(staffIds as string[])]
  if (!ids.every((id) => state.staff(id))) throw validation({ staffIds: 'Unknown staff.' })
  return ids
}

export async function requestHold(me: Seat, state: ScoreState, body: Record<string, unknown>): Promise<Hold[]> {
  const rawIds = body.staffIds
  const known = Array.isArray(rawIds) ? rawIds.filter((id): id is string => typeof id === 'string' && !!state.staff(id)) : []
  requireStaves(me, known)
  const [open] = await query<{ ids: string[] }>('SELECT coalesce(array_agg(id), \'{}\') AS ids FROM connections WHERE collaborator_id = $1 AND score_id = $2', [me.id, state.id])
  if (!open || open.ids.length === 0) throw notConnected()
  const staffIds = knownStaves(state, rawIds)
  const connectionId = body.connectionId
  if (typeof connectionId !== 'string' || !open.ids.includes(connectionId)) throw validation({ connectionId: 'Unknown connection.' })
  await transaction(async (client) => {
    await query('SELECT pg_advisory_xact_lock(hashtext($1))', [`holds:${state.id}`], client)
    const taken = await query<{ staff_id: string; holder_id: string }>(
      'SELECT staff_id, holder_id FROM holds WHERE score_id = $1 AND staff_id = ANY($2) AND holder_id <> $3', [state.id, staffIds, me.id], client)
    const first = taken[0]
    if (first) {
      const overlapping = taken.filter((t) => t.holder_id === first.holder_id).map((t) => t.staff_id)
      const [holder] = await query<{ id: string; name: string; role: Author['role'] }>('SELECT id, name, role FROM collaborators WHERE id = $1', [first.holder_id], client)
      throw staffHeld(holder as Author, overlapping.map((id) => state.staff(id)?.name ?? id), overlapping)
    }
    // FOR KEY SHARE keeps the connection row from closing under the insert; if it already closed, nothing lands.
    for (const staffId of staffIds) {
      const inserted = await query(
        `INSERT INTO holds (score_id, staff_id, holder_id, connection_id)
         SELECT $1, $2, $3, id FROM connections WHERE id = $4 FOR KEY SHARE
         ON CONFLICT (score_id, staff_id) DO UPDATE SET connection_id = EXCLUDED.connection_id RETURNING staff_id`, [state.id, staffId, me.id, connectionId], client)
      if (!inserted.length) throw validation({ connectionId: 'Unknown connection.' })
    }
  })
  await publishHolds(state.id)
  return (await listHolds(state.id)).filter((h) => h.holder.id === me.id && staffIds.includes(h.staffId))
}

export async function releaseHolds(me: Seat, state: ScoreState, raw: string | null): Promise<void> {
  const staffIds = knownStaves(state, raw ? raw.split(',') : [])
  const released = await query('DELETE FROM holds WHERE score_id = $1 AND holder_id = $2 AND staff_id = ANY($3) RETURNING staff_id', [state.id, me.id, staffIds])
  if (released.length) await publishHolds(state.id)
}

/** The staves of `staffIds` that `holderId` does not hold, with who holds them, for routes that need a hold. */
async function missingHold(state: ScoreState, holderId: string, staffIds: string[]): Promise<{ holder: Author; staffIds: string[] } | 'none' | null> {
  const rows = await query<HoldRow>(SELECT_HOLDS, [state.id])
  const held = new Map(rows.map((r) => [r.staff_id, r]))
  const mine = staffIds.every((id) => held.get(id)?.holder_id === holderId)
  if (mine) return null
  const other = staffIds.map((id) => held.get(id)).find((r) => r && r.holder_id !== holderId)
  if (!other) return 'none'
  const theirs = staffIds.filter((id) => held.get(id)?.holder_id === other.holder_id)
  return { holder: { id: other.holder_id, name: other.holder_name, role: other.holder_role }, staffIds: theirs }
}

export async function requireHold(state: ScoreState, me: Seat, staffIds: string[]): Promise<void> {
  const missing = await missingHold(state, me.id, staffIds)
  if (missing === null) return
  throw missing === 'none' ? holdRequired() : staffHeld(missing.holder, missing.staffIds.map((id) => state.staff(id)?.name ?? id), missing.staffIds)
}
