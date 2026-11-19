/** The harbour notice board: notes wait for a ranger, and only approved notes reach other players. */
import { type Db, one, pool, rows, transaction } from './db'
import { ApiError } from './errors'
import { route } from './http'
import { publish } from './live'
import type { PlayerRow } from './players'
import { assertUnused, lookUp, remember } from './request-keys'
import { inTurn } from './turns'
import { isBlank, isText, lengthOf } from './validate'
import type { Note, NoteStatus } from '../shared/types'

const NOTE_LIMIT = 140
const REASONS = ['Not about the islands', 'Unkind', 'Shares personal details']

interface NoteRow { id: string; text: string; author_id: string; author_name: string; status: NoteStatus; reason: string | null; decided_by: string | null }

const SELECT = `SELECT n.id, n.text, n.author_id, a.name AS author_name, n.status, n.reason, d.name AS decided_by
  FROM notes n JOIN players a ON a.id = n.author_id LEFT JOIN players d ON d.id = n.decided_by`

const toNote = (row: NoteRow): Note => ({ id: row.id, text: row.text, author_name: row.author_name, status: row.status, reason: row.reason, decided_by: row.decided_by })

async function noteOf(db: Db, worldId: string, id: string): Promise<NoteRow> {
  const row = await one<NoteRow>(db, `${SELECT} WHERE n.id = $1 AND n.world_id = $2`, [id, worldId])
  if (!row) throw new ApiError('not_found')
  return row
}

function assertRanger(me: PlayerRow): void {
  if (!me.ranger) throw new ApiError('not_ranger')
}

route('GET', '/api/notes', 'required', async (c) => {
  const me = c.player as PlayerRow
  const found = await rows<NoteRow>(pool, `${SELECT} WHERE n.world_id = $1 AND (n.status = 'approved' OR n.author_id = $2) ORDER BY n.created_at DESC`, [me.world_id, me.id])
  return { status: 200, body: { notes: found.map(toNote) } }
})

route('GET', '/api/ranger/notes', 'required', async (c) => {
  const me = c.player as PlayerRow
  assertRanger(me)
  const found = await rows<NoteRow>(pool, `${SELECT} WHERE n.world_id = $1 AND n.status = 'pending' ORDER BY n.created_at`, [me.world_id])
  return { status: 200, body: { notes: found.map(toNote) } }
})

route('POST', '/api/notes', 'required', async (c) => {
  const me = c.player as PlayerRow
  const body = await c.json()
  return inTurn(`note:${me.id}`, async () => {
    const state = await lookUp(me.id, 'note', c, body)
    if (state.replay) return state.replay
    if (!me.confirmed) throw new ApiError('unconfirmed')
    assertUnused(state)
    const text = isText(body.text) ? body.text : ''
    if (isBlank(text)) throw new ApiError('note_empty')
    if (lengthOf(text) > NOTE_LIMIT) throw new ApiError('note_too_long')
    const answer = await transaction(async (client) => {
      const made = (await one<{ id: string }>(client, 'INSERT INTO notes (world_id, author_id, text) VALUES ($1, $2, $3) RETURNING id', [me.world_id, me.id, text])) as { id: string }
      const stored = { status: 201, body: { note: { id: made.id, text, status: 'pending' } } }
      await remember(client, me.id, 'note', state, stored)
      return stored
    })
    await publish(pool, { rangers: me.world_id }, 'note', { kind: 'pending', note: toNote(await noteOf(pool, me.world_id, answer.body.note.id)) })
    return answer
  })
})

/** The first decision stands: later ones learn the outcome and the ranger who made it. */
async function decide(me: PlayerRow, id: string, status: 'approved' | 'declined', reason: string | null): Promise<Note> {
  const decided = await one<{ id: string }>(pool, `UPDATE notes SET status = $3, reason = $4, decided_by = $2 WHERE id = $1 AND status = 'pending' RETURNING id`, [id, me.id, status, reason])
  if (!decided) await refuseDecided(me, id)
  const note = toNote(await noteOf(pool, me.world_id, id))
  const author = (await one<{ author_id: string }>(pool, 'SELECT author_id FROM notes WHERE id = $1', [id])) as { author_id: string }
  if (status === 'approved') await publish(pool, { world: me.world_id }, 'note', { kind: 'approved', note })
  else await publish(pool, { players: [author.author_id], rangers: me.world_id }, 'note', { kind: 'declined', note })
  return note
}

async function refuseDecided(me: PlayerRow, id: string): Promise<never> {
  const row = await noteOf(pool, me.world_id, id)
  throw new ApiError('note_decided', `${row.status} by ${row.decided_by}`)
}

route('POST', '/api/notes/:id/approve', 'required', async (c) => {
  const me = c.player as PlayerRow
  const row = await noteOf(pool, me.world_id, c.params[0] as string)
  assertRanger(me)
  if (row.status !== 'pending') await refuseDecided(me, row.id)
  return { status: 200, body: { note: await decide(me, row.id, 'approved', null) } }
})

route('POST', '/api/notes/:id/decline', 'required', async (c) => {
  const me = c.player as PlayerRow
  const row = await noteOf(pool, me.world_id, c.params[0] as string)
  assertRanger(me)
  if (row.status !== 'pending') await refuseDecided(me, row.id)
  const body = await c.json()
  if (!isText(body.reason) || !REASONS.includes(body.reason)) throw new ApiError('bad_reason')
  return { status: 200, body: { note: await decide(me, row.id, 'declined', body.reason) } }
})

route('DELETE', '/api/notes/:id', 'required', async (c) => {
  const me = c.player as PlayerRow
  const row = await noteOf(pool, me.world_id, c.params[0] as string)
  assertRanger(me)
  if (row.status !== 'approved') throw new ApiError('note_not_approved')
  await pool.query('DELETE FROM notes WHERE id = $1', [row.id])
  await publish(pool, { world: me.world_id }, 'note', { kind: 'removed', note: toNote(row) })
  return { status: 204 }
})
