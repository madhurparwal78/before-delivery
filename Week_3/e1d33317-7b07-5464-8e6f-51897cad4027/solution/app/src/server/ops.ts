// Recording operation batches: validation, the stamp rules, all-or-nothing application, history and compaction.

import { durationWord, isDuration, isPitch, MeasureGrid, pitchText, plainDurationWord, type Piece } from '../shared/music.js'
import type { Author, LogEntry } from '../shared/protocol.js'
import { filterText } from '../shared/text.js'
import {
  compareStamps, DYNAMICS, durationTicksOf, idKey, SET_FIELDS, voiceToJson,
  type ElementId, type NewEvent, type Operation, type SetField, type Undo, type Voice, type VoiceElement,
} from '../shared/voice.js'
import { canEditStaff, type Seat } from './auth.js'
import { MEASURE_CAP, MEASURE_CAP_MESSAGE } from './caps.js'
import { query, transaction } from './db.js'
import { ApiError, ownStavesOnly, validation } from './errors.js'
import { broadcast } from './hub.js'
import { adopt, forget, loadScore, stableLamport, type ScoreState } from './state.js'
import { refundOperations, takeOperations } from './throttle.js'

const BATCH_MAX = 50
const TEXT_MAX = 200
const SNAPSHOT_EVERY = 100

interface RecordResult {
  applied: ElementId[]
  duplicates: ElementId[]
  lamport: number
  lastSeq: number
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

const asId = (value: unknown): ElementId | null => {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  return Number.isInteger(v.lamport) && (v.lamport as number) >= 1 && typeof v.site === 'string' && v.site !== '' ? { lamport: v.lamport as number, site: v.site } : null
}

class OpError extends Error {
  constructor(readonly key: string, message: string) {
    super(message)
  }
}

/** Checks one raw operation against the voice it names and returns it in its stored shape. */
function normalize(raw: unknown, i: number, me: Seat, state: ScoreState): Operation {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const at = (field: string): string => `ops[${i}].${field}`
  const id = asId(r.id)
  if (!id) throw new OpError(at('id'), 'Give the operation a stamp with a lamport of 1 or more and a site.')
  if (id.site !== me.id) throw new OpError(at('id'), 'Site must be your collaborator id.')
  if (r.type !== 'insert' && r.type !== 'delete' && r.type !== 'set') throw new OpError(at('type'), 'Use insert, delete or set.')
  if (typeof r.staffId !== 'string' || !state.staff(r.staffId)) throw new OpError(at('staffId'), 'Unknown staff.')
  if (r.voice !== 1 && r.voice !== 2) throw new OpError(at('voice'), 'Use voice 1 or 2.')
  const voiceNumber: 1 | 2 = r.voice
  const base = { id, staffId: r.staffId, voice: voiceNumber }
  const voice = state.voice(r.staffId, r.voice)
  if (r.type === 'insert') {
    const after = r.after === null || r.after === undefined ? null : asId(r.after)
    if (r.after !== null && r.after !== undefined && !after) throw new OpError(at('after'), 'Unknown element.')
    if (after) {
      const anchor = voice.get(after)
      if (!anchor) throw new OpError(at('after'), 'Unknown element.')
      if (compareStamps(id, anchor.id) <= 0) throw new OpError(at('id'), 'Stamp must be later than the element it refers to.')
    }
    return { ...base, type: 'insert', after, event: normalizeEvent(r.event, at) }
  }
  const target = asId(r.target)
  const element = target ? voice.get(target) : undefined
  if (!target || !element) throw new OpError(at('target'), 'Unknown element.')
  if (r.type === 'delete') return { ...base, type: 'delete', target }
  if (compareStamps(id, element.id) <= 0) throw new OpError(at('id'), 'Stamp must be later than the element it refers to.')
  if (typeof r.field !== 'string' || !SET_FIELDS.includes(r.field as SetField)) throw new OpError(at('field'), 'Unknown field.')
  const field = r.field as SetField
  return { ...base, type: 'set', target, field, value: normalizeValue(field, r.value, element, at) }
}

function normalizeEvent(raw: unknown, at: (field: string) => string): NewEvent {
  const e = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  if (e.kind !== 'note' && e.kind !== 'rest') throw new OpError(at('event.kind'), 'Use note or rest.')
  if (!isDuration(e.duration)) throw new OpError(at('event.duration'), 'Choose a duration from whole to 32nd.')
  if (!Number.isInteger(e.dots) || (e.dots as number) < 0 || (e.dots as number) > 2) throw new OpError(at('event.dots'), 'Use 0, 1 or 2 dots.')
  if (e.kind === 'rest') {
    if (e.pitch !== undefined && e.pitch !== null) throw new OpError(at('event.pitch'), 'Rests have no pitch.')
    return { kind: 'rest', duration: e.duration, dots: e.dots as number }
  }
  if (!isPitch(e.pitch)) throw new OpError(at('event.pitch'), 'Choose a pitch from A0 to G9.')
  return { kind: 'note', pitch: { step: e.pitch.step, alter: e.pitch.alter, octave: e.pitch.octave }, duration: e.duration, dots: e.dots as number }
}

function normalizeValue(field: SetField, value: unknown, element: VoiceElement, at: (field: string) => string): unknown {
  const bad = (message: string): never => {
    throw new OpError(at('value'), message)
  }
  switch (field) {
    case 'pitch':
      if (element.kind === 'rest') return bad('Rests have no pitch.')
      return isPitch(value) ? { step: value.step, alter: value.alter, octave: value.octave } : bad('Choose a pitch from A0 to G9.')
    case 'duration':
      return isDuration(value) ? value : bad('Choose a duration from whole to 32nd.')
    case 'dots':
      return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 2 ? value : bad('Use 0, 1 or 2 dots.')
    case 'tie':
      return typeof value === 'boolean' ? value : bad('Use true or false.')
    case 'dynamic':
      return value === null || (typeof value === 'string' && (DYNAMICS as readonly string[]).includes(value)) ? value : bad('Use pp, p, mp, mf, f, ff, sfz, fp or null.')
    case 'dynamicPlacement':
      return value === 'above' || value === 'below' ? value : bad('Use above or below.')
    case 'text': {
      if (typeof value !== 'string') return bad('Send the text as a string.')
      const filtered = filterText(value)
      return filtered.length > TEXT_MAX ? bad('Expression text is limited to 200 characters.') : filtered.html
    }
  }
}

function positionOf(voice: Voice, id: ElementId, grid: MeasureGrid): { measure: number; beat: number } {
  let tick = 0
  for (const e of voice.elements) {
    if (e.id.lamport === id.lamport && e.id.site === id.site) {
      const first = grid.pieces(tick, durationTicksOf(e))[0] as Piece
      return { measure: first.measure, beat: first.beat }
    }
    if (!e.deleted) tick += durationTicksOf(e)
  }
  return { measure: 1, beat: 1 }
}

function describe(e: VoiceElement): string {
  return e.kind === 'note' && e.pitch ? `${pitchText(e.pitch)} ${durationWord(e.duration, e.dots)}` : `${durationWord(e.duration, e.dots)} rest`
}

function summarize(op: Operation, before: VoiceElement | undefined, after: VoiceElement | undefined): string {
  if (op.type === 'insert') return `Added ${after ? describe(after) : ''}`
  if (op.type === 'delete') return `Deleted ${before ? describe(before) : ''}`
  switch (op.field) {
    case 'pitch': return `Pitch set to ${pitchText(op.value as NonNullable<VoiceElement['pitch']>)}`
    case 'duration': return `Duration set to ${plainDurationWord(op.value as VoiceElement['duration'])}`
    case 'dots': return `Dots set to ${String(op.value)}`
    case 'tie': return op.value ? 'Tie added' : 'Tie removed'
    case 'dynamic': return op.value ? `Dynamic set to ${String(op.value)}` : 'Dynamic removed'
    case 'dynamicPlacement': return `Dynamic moved ${String(op.value)} the staff`
    case 'text': return 'Text changed'
  }
}

interface Recorded {
  op: Operation
  measure: number
  beat: number
  summary: string
}

export async function recordOps(me: Seat, scoreState: ScoreState, body: Record<string, unknown>): Promise<RecordResult> {
  const rawOps = body.ops
  const seen = Number.isInteger(body.seen) && (body.seen as number) > 0 ? (body.seen as number) : null
  const asList = Array.isArray(rawOps) ? rawOps : []
  for (const raw of asList) {
    const staffId = (raw as { staffId?: unknown } | null)?.staffId
    if (typeof staffId === 'string' && scoreState.staff(staffId) && !canEditStaff(me, staffId)) throw ownStavesOnly()
  }
  const window = await takeOperations(me.id, asList.length)
  try {
    return await commit(me, scoreState.id, rawOps, seen)
  } catch (error) {
    await refundOperations(me.id, asList.length, window)
    throw error
  }
}

async function commit(me: Seat, scoreId: string, rawOps: unknown, seen: number | null): Promise<RecordResult> {
  if (!Array.isArray(rawOps) || rawOps.length < 1 || rawOps.length > BATCH_MAX) throw validation({ ops: 'Send 1 to 50 operations.' })
  const undo: Undo[] = []
  let state: ScoreState | null = null
  try {
    return await transaction(async (client) => {
      state = await loadScore(scoreId, client, true)
      const live = state
      const ids = rawOps.map((raw) => asId((raw as { id?: unknown } | null)?.id)).filter((id): id is ElementId => id !== null)
      const existing = new Map<string, string>()
      if (ids.length) {
        const rows = await query<{ lamport: number; site: string; payload: Operation }>(
          'SELECT lamport, site, payload FROM ops WHERE score_id = $1 AND (lamport, site) IN (SELECT * FROM unnest($2::int[], $3::text[]))',
          [scoreId, ids.map((i) => i.lamport), ids.map((i) => i.site)], client)
        for (const row of rows) existing.set(idKey(row), canonical(row.payload))
      }
      const recorded: Recorded[] = []
      const applied: ElementId[] = []
      const duplicates: ElementId[] = []
      const touched = new Set<string>()
      for (const [i, raw] of rawOps.entries()) {
        let op: Operation
        try {
          op = normalize(raw, i, me, live)
        } catch (error) {
          if (error instanceof OpError) throw validation({ [error.key]: error.message })
          throw error
        }
        const known = existing.get(idKey(op.id))
        if (known !== undefined) {
          if (known !== canonical(op)) throw new ApiError(409, 'op_conflict', `Operation ${op.id.lamport}@${op.id.site} was already recorded with different content.`)
          duplicates.push(op.id)
          continue
        }
        const voice = live.voice(op.staffId, op.voice)
        const before = op.type === 'insert' ? undefined : voice.get(op.target)
        const snapshotBefore = before ? { ...before, stamps: { ...before.stamps } } : undefined
        const position = op.type === 'delete' ? positionOf(voice, op.target, live.grid) : null
        const step = voice.apply(op)
        if (step) undo.push(step)
        const after = op.type === 'insert' ? voice.get(op.id) : voice.get(op.target)
        const where = position ?? positionOf(voice, op.type === 'insert' ? op.id : op.target, live.grid)
        recorded.push({ op, ...where, summary: summarize(op, snapshotBefore, after) })
        existing.set(idKey(op.id), canonical(op))
        applied.push(op.id)
        touched.add(`${op.staffId}:${op.voice}`)
      }
      let measureCount = live.row.measure_count
      for (const key of touched) {
        const voice = live.voices.get(key) as Voice
        measureCount = Math.max(measureCount, live.grid.measuresFor(voice.totalTicks()))
      }
      if (measureCount > MEASURE_CAP) throw validation({ measures: MEASURE_CAP_MESSAGE })
      const firstSeq = live.row.last_seq + 1
      const lastSeq = live.row.last_seq + recorded.length
      const lamport = Math.max(live.row.lamport, ...recorded.map((r) => r.op.id.lamport))
      const at = new Date()
      for (const [k, r] of recorded.entries()) {
        await query(
          `INSERT INTO ops (score_id, seq, lamport, site, type, field, staff_id, voice, payload, author_id, at, measure, beat, summary)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [scoreId, firstSeq + k, r.op.id.lamport, r.op.id.site, r.op.type, r.op.type === 'set' ? r.op.field : null, r.op.staffId, r.op.voice,
            JSON.stringify(r.op), me.id, at, r.measure, r.beat, r.summary], client)
      }
      let snapshotSeq = live.row.snapshot_seq
      if (recorded.length && Math.floor(lastSeq / SNAPSHOT_EVERY) > Math.floor(live.row.last_seq / SNAPSHOT_EVERY)) {
        const stable = await stableLamport(scoreId, client, { id: me.id, seen: seen ?? 0 })
        for (const voice of live.voices.values()) voice.compact(stable)
        const voices = Object.fromEntries([...live.voices].map(([key, voice]) => [key, voiceToJson(voice)]))
        await query('INSERT INTO snapshots (score_id, seq, state) VALUES ($1, $2, $3)', [scoreId, lastSeq, JSON.stringify({ voices })], client)
        await query('DELETE FROM snapshots WHERE score_id = $1 AND seq < $2', [scoreId, lastSeq], client)
        snapshotSeq = lastSeq
      }
      if (seen !== null) await query('UPDATE collaborators SET ack_lamport = $2 WHERE id = $1 AND ack_lamport < $2', [me.id, seen], client)
      const [row] = await query<ScoreState['row']>(
        `UPDATE scores SET last_seq = $2, lamport = $3, measure_count = $4, snapshot_seq = $5, rev = rev + 1 WHERE id = $1 RETURNING *`,
        [scoreId, lastSeq, lamport, measureCount, snapshotSeq], client)
      const grown = measureCount !== live.row.measure_count
      return { applied, duplicates, lamport, lastSeq, row: row as ScoreState['row'], recorded, firstSeq, grown, state: live }
    }).then(({ row, recorded, firstSeq, grown, state: live, ...result }) => {
      adopt(live, row)
      if (recorded.length) {
        const author: Author = { id: me.id, name: me.name, role: me.role }
        const entries: LogEntry[] = recorded.map((r, k) => ({ seq: firstSeq + k, op: r.op, author }))
        broadcast(scoreId, { type: 'ops', entries })
        if (grown) broadcast(scoreId, { type: 'score', score: live.summary() })
      }
      return result
    })
  } catch (error) {
    for (const step of undo.reverse()) step()
    if (state) forget(scoreId)
    throw error
  }
}
