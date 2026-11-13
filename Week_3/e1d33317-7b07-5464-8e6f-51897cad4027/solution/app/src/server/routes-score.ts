// Score, staves, measures, voices, operations, sync, history and engraving routes.

import { randomBytes } from 'node:crypto'
import { CLEFS, transposePitch, type Clef, type TimeSignature, type Transpose } from '../shared/music.js'
import type { Author, HistoryEntry, PartRef, Staff } from '../shared/protocol.js'
import { graphemeCount } from '../shared/text.js'
import { SET_FIELDS, type Operation } from '../shared/voice.js'
import { bearer, requireRole, scoped, seatFor, type Seat } from './auth.js'
import { MEASURE_CAP, MEASURE_CAP_MESSAGE, STAFF_CAP, STAFF_CAP_MESSAGE } from './caps.js'
import { query, transaction } from './db.js'
import { notFound, validation } from './errors.js'
import { planFor, systemsFrom } from './engraving.js'
import { broadcast } from './hub.js'
import { json, route } from './http.js'
import { requireHold } from './holds.js'
import { recordOps } from './ops.js'
import { collaboratorView, forget, loadScore, stableLamport } from './state.js'
import { valkeyLive } from './valkey.js'
import { loadParts } from './parts.js'


const newId = (prefix: string): string => `${prefix}-${randomBytes(6).toString('hex')}`

export function parseName(value: unknown, max: number, errors: Record<string, string>, key = 'name'): string | null {
  const name = typeof value === 'string' ? value.trim() : ''
  const length = graphemeCount(name)
  if (length < 1 || length > max) {
    errors[key] = `Use 1 to ${max} characters.`
    return null
  }
  return name
}

function parseTranspose(value: unknown, errors: Record<string, string>): Transpose | null {
  const t = value as Partial<Transpose> | null
  if (t && typeof t === 'object' && Number.isInteger(t.diatonic) && Number.isInteger(t.chromatic)) return { diatonic: t.diatonic as number, chromatic: t.chromatic as number }
  errors.transpose = 'Choose a transposition.'
  return null
}

function parseClef(value: unknown, errors: Record<string, string>): Clef | null {
  if (typeof value === 'string' && (CLEFS as readonly string[]).includes(value)) return value as Clef
  errors.clef = 'Choose a clef.'
  return null
}

async function announceScore(scoreId: string): Promise<void> {
  forget(scoreId)
  broadcast(scoreId, { type: 'score', score: (await loadScore(scoreId)).summary() })
}

export function registerScoreRoutes(): void {
  route('GET', '/api/me', async (ctx) => {
    const me = await seatFor(bearer(ctx.req))
    const state = await loadScore(me.score_id)
    const [row] = await query<{ id: string; name: string; role: Seat['role']; status: 'active'; staff_ids: string[] }>(
      'SELECT id, name, role, status, staff_ids FROM collaborators WHERE id = $1', [me.id])
    return json(200, { collaborator: collaboratorView(row as NonNullable<typeof row>, state), score: { id: state.id, title: state.row.title } })
  })

  route('GET', '/api/scores/:scoreId', async (ctx) => json(200, { score: (await scoped(ctx)).state.summary() }))

  route('POST', '/api/scores/:scoreId/staves', async (ctx) => {
    const { me, state } = await scoped(ctx)
    requireRole(me, 'composer')
    const body = ctx.json()
    const errors: Record<string, string> = {}
    const name = parseName(body.name, 40, errors)
    const clef = parseClef(body.clef, errors)
    const transpose = parseTranspose(body.transpose, errors)
    const partId = body.partId ?? null
    const part = partId === null ? null : state.parts.find((p) => p.id === partId)
    if (partId !== null && !part) errors.partId = 'Unknown part.'
    const afterId = body.afterStaffId ?? null
    const after = afterId === null ? null : state.staff(String(afterId))
    if (afterId !== null && !after) errors.afterStaffId = 'Unknown staff.'
    if (Object.keys(errors).length === 0 && state.staves.length >= STAFF_CAP) errors.staves = STAFF_CAP_MESSAGE
    if (Object.keys(errors).length) throw validation(errors)
    const staff: Staff = { id: newId('st'), name: name as string, clef: clef as Clef, transpose: transpose as Transpose, partId: part?.id ?? newId('p'), order: 0 }
    await transaction(async (client) => {
      await query('SELECT id FROM scores WHERE id = $1 FOR UPDATE', [state.id], client)
      const [{ count }] = (await query<{ count: string }>('SELECT count(*) FROM staves WHERE score_id = $1', [state.id], client)) as [{ count: string }]
      if (Number(count) >= STAFF_CAP) throw validation({ staves: STAFF_CAP_MESSAGE })
      const [anchor] = after ? await query<{ ord: number }>('SELECT ord FROM staves WHERE id = $1', [after.id], client) : []
      staff.order = anchor ? anchor.ord + 1 : Number(count)
      if (!part) await query('INSERT INTO parts (id, score_id, name) VALUES ($1, $2, $3)', [staff.partId, state.id, staff.name], client)
      await query('UPDATE staves SET ord = ord + 1 WHERE score_id = $1 AND ord >= $2', [state.id, staff.order], client)
      await query('INSERT INTO staves (id, score_id, name, clef, transpose, part_id, ord) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [staff.id, state.id, staff.name, staff.clef, JSON.stringify(staff.transpose), staff.partId, staff.order], client)
      await query('UPDATE scores SET rev = rev + 1 WHERE id = $1', [state.id], client)
    })
    await announceScore(state.id)
    const fresh = await loadScore(state.id)
    const partRef = fresh.parts.find((p) => p.id === staff.partId) as PartRef
    return json(201, { staff: fresh.staff(staff.id), part: partRef })
  })

  route('PATCH', '/api/scores/:scoreId/staves/:staffId', async (ctx) => {
    const { me, state } = await scoped(ctx)
    const staff = state.staff(ctx.params.staffId as string)
    if (!staff) throw notFound()
    requireRole(me, 'composer', 'copyist')
    await requireHold(state, me, [staff.id])
    const body = ctx.json()
    const errors: Record<string, string> = {}
    const changes: Partial<Pick<Staff, 'name' | 'clef' | 'transpose'>> = {}
    if ('name' in body) changes.name = parseName(body.name, 40, errors) ?? undefined
    if ('clef' in body) changes.clef = parseClef(body.clef, errors) ?? undefined
    if ('transpose' in body) changes.transpose = parseTranspose(body.transpose, errors) ?? undefined
    if (!Object.keys(changes).length && !Object.keys(errors).length) errors.name = 'Change the name, clef or transposition.'
    if (Object.keys(errors).length) throw validation(errors)
    await query(
      `UPDATE staves SET name = coalesce($3, name), clef = coalesce($4, clef), transpose = coalesce($5, transpose) WHERE id = $1 AND score_id = $2`,
      [staff.id, state.id, changes.name ?? null, changes.clef ?? null, changes.transpose ? JSON.stringify(changes.transpose) : null])
    await query('UPDATE scores SET rev = rev + 1 WHERE id = $1', [state.id])
    await announceScore(state.id)
    return json(200, { staff: (await loadScore(state.id)).staff(staff.id) })
  })

  route('POST', '/api/scores/:scoreId/measures', async (ctx) => {
    const { me, state } = await scoped(ctx)
    requireRole(me, 'composer')
    const body = ctx.json()
    const errors: Record<string, string> = {}
    const count = body.count
    if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > MEASURE_CAP) errors.count = 'Add 1 to 2000 measures.'
    let signature: TimeSignature | null = null
    if (body.timeSignature !== undefined && body.timeSignature !== null) {
      const t = body.timeSignature as Record<string, unknown>
      if (Number.isInteger(t.beats) && (t.beats as number) >= 1 && (t.beats as number) <= 16 && [1, 2, 4, 8, 16].includes(t.beatType as number)) {
        signature = { measure: state.row.measure_count + 1, beats: t.beats as number, beatType: t.beatType as number }
      } else errors.timeSignature = 'Use 1 to 16 beats over a 1, 2, 4, 8 or 16 note.'
    }
    if (Object.keys(errors).length === 0 && state.row.measure_count + (count as number) > MEASURE_CAP) errors.measures = MEASURE_CAP_MESSAGE
    if (Object.keys(errors).length) throw validation(errors)
    const result = await transaction(async (client) => {
      const fresh = await loadScore(state.id, client, true)
      const sigs = fresh.row.time_signatures
      const last = sigs[sigs.length - 1] as TimeSignature
      const next = signature && (signature.beats !== last.beats || signature.beatType !== last.beatType) ? [...sigs, { ...signature, measure: fresh.row.measure_count + 1 }] : sigs
      const total = fresh.row.measure_count + (count as number)
      if (total > MEASURE_CAP) throw validation({ measures: MEASURE_CAP_MESSAGE })
      await query('UPDATE scores SET measure_count = $2, time_signatures = $3, rev = rev + 1 WHERE id = $1', [state.id, total, JSON.stringify(next)], client)
      return { measureCount: total, timeSignatures: next }
    })
    await announceScore(state.id)
    return json(200, result)
  })

  route('GET', '/api/scores/:scoreId/staves/:staffId/voices/:voice', async (ctx) => {
    const { state } = await scoped(ctx)
    const staff = state.staff(ctx.params.staffId as string)
    const voice = Number(ctx.params.voice)
    if (!staff || (voice !== 1 && voice !== 2)) throw notFound()
    const pitch = ctx.url.searchParams.get('pitch') ?? 'concert'
    if (pitch !== 'concert' && pitch !== 'written') throw validation({ pitch: 'Use concert or written.' })
    const events = state.voice(staff.id, voice).events(state.grid)
    return json(200, {
      staffId: staff.id, voice,
      events: pitch === 'concert' ? events : events.map((e) => ({ ...e, pitch: e.pitch && transposePitch(e.pitch, staff.transpose, -1) })),
    })
  })

  route('POST', '/api/scores/:scoreId/ops', async (ctx) => {
    const { me, state } = await scoped(ctx)
    return json(200, await recordOps(me, state, ctx.json()))
  })

  route('GET', '/api/scores/:scoreId/ops', async (ctx) => {
    const { state } = await scoped(ctx)
    const params = ctx.url.searchParams
    const errors: Record<string, string> = {}
    const afterSeq = params.has('afterSeq') ? Number(params.get('afterSeq')) : 0
    const limit = params.has('limit') ? Number(params.get('limit')) : 200
    if (!Number.isInteger(afterSeq) || afterSeq < 0) errors.afterSeq = 'Use a sequence number of 0 or more.'
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) errors.limit = 'Ask for 1 to 500 operations.'
    if (Object.keys(errors).length) throw validation(errors)
    const rows = await query<{ seq: number; payload: Operation; id: string; name: string; role: Author['role'] }>(
      `SELECT o.seq, o.payload, c.id, c.name, c.role FROM ops o JOIN collaborators c ON c.id = o.author_id
       WHERE o.score_id = $1 AND o.seq > $2 ORDER BY o.seq LIMIT $3`, [state.id, afterSeq, limit])
    return json(200, {
      ops: rows.map((r) => ({ seq: r.seq, op: r.payload, author: { id: r.id, name: r.name, role: r.role } })),
      lastSeq: state.row.last_seq, lamport: state.row.lamport,
    })
  })

  route('GET', '/api/scores/:scoreId/sync', async (ctx) => {
    const { state } = await scoped(ctx)
    return json(200, { lamport: state.row.lamport, stableLamport: await stableLamport(state.id), tombstones: state.tombstones(), lastSeq: state.row.last_seq, live: valkeyLive() })
  })

  route('GET', '/api/scores/:scoreId/history', async (ctx) => {
    const { state } = await scoped(ctx)
    const p = ctx.url.searchParams
    const errors: Record<string, string> = {}
    const limit = p.has('limit') ? Number(p.get('limit')) : 50
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) errors.limit = 'Ask for 1 to 100 entries.'
    let before = 2_147_483_647
    if (p.has('before')) {
      const decoded = /^h:(\d+)$/.exec(Buffer.from(p.get('before') as string, 'base64url').toString('utf8'))
      if (decoded) before = Number(decoded[1])
      else errors.before = 'Unknown cursor.'
    }
    const staffId = p.get('staffId')
    if (staffId !== null && !state.staff(staffId)) errors.staffId = 'Unknown staff.'
    const type = p.get('type')
    if (type !== null && !['insert', 'delete', 'set'].includes(type)) errors.type = 'Unknown filter.'
    const fields = p.has('field') ? (p.get('field') as string).split(',') : null
    if (fields && !fields.every((f) => (SET_FIELDS as readonly string[]).includes(f))) errors.field = 'Unknown filter.'
    if (Object.keys(errors).length) throw validation(errors)
    const rows = await query<{
      seq: number; lamport: number; site: string; type: HistoryEntry['type']; field: string | null; staff_id: string; staff_name: string | null
      voice: number; measure: number; beat: number; at: Date; summary: string; aid: string; aname: string; arole: Author['role']
    }>(
      `SELECT o.seq, o.lamport, o.site, o.type, o.field, o.staff_id, s.name AS staff_name, o.voice, o.measure, o.beat, o.at, o.summary,
              c.id AS aid, c.name AS aname, c.role AS arole
       FROM ops o JOIN collaborators c ON c.id = o.author_id LEFT JOIN staves s ON s.id = o.staff_id
       WHERE o.score_id = $1 AND o.seq < $2 AND ($3::text IS NULL OR o.staff_id = $3) AND ($4::text IS NULL OR o.type = $4)
         AND ($5::text[] IS NULL OR (o.type = 'set' AND o.field = ANY($5)))
       ORDER BY o.seq DESC LIMIT $6`,
      [state.id, before, staffId, type, fields, limit + 1])
    const page = rows.slice(0, limit)
    const last = page[page.length - 1]
    return json(200, {
      entries: page.map((r): HistoryEntry => ({
        seq: r.seq, opId: `${r.lamport}@${r.site}`, type: r.type, field: r.field, staffId: r.staff_id, staffName: r.staff_name ?? r.staff_id, voice: r.voice,
        measure: r.measure, beat: r.beat, author: { id: r.aid, name: r.aname, role: r.arole }, at: r.at.toISOString(), summary: r.summary,
      })),
      nextCursor: rows.length > limit && last ? Buffer.from(`h:${last.seq}`).toString('base64url') : null,
    })
  })

  route('GET', '/api/scores/:scoreId/engraving', async (ctx) => {
    const { state } = await scoped(ctx)
    const p = ctx.url.searchParams
    const errors: Record<string, string> = {}
    const limit = p.has('limit') ? Number(p.get('limit')) : 8
    if (!Number.isInteger(limit) || limit < 1 || limit > 16) errors.limit = 'Ask for 1 to 16 systems.'
    const view = p.get('view') ?? 'score'
    if (view !== 'score' && view !== 'part') errors.view = 'Use score or part.'
    const part = view === 'part' ? (await loadParts(state)).find((x) => x.id === p.get('partId')) : undefined
    if (view === 'part' && !part) errors.partId = 'Choose a part.'
    let from = 1
    if (p.has('cursor')) {
      const decoded = /^m:(\d+)$/.exec(Buffer.from(p.get('cursor') as string, 'base64url').toString('utf8'))
      if (decoded) from = Number(decoded[1])
      else errors.cursor = 'Unknown cursor.'
    }
    if (Object.keys(errors).length) throw validation(errors)
    const { request, plans } = planFor(state, view as 'score' | 'part', part ?? null)
    const { systems, next } = systemsFrom(request, plans, from, limit)
    return json(200, {
      view, partId: part?.id ?? null, lamport: state.row.lamport, systems,
      nextCursor: next === null ? null : Buffer.from(`m:${next}`).toString('base64url'),
    })
  })
}
