// The score as the server sees it: structure from tables, music from the latest snapshot plus the operation log.
// Every request validates its cached copy against the score's revision, so several instances stay consistent.

import { MeasureGrid, type TimeSignature } from '../shared/music.js'
import type { Collaborator, Part, PartRef, ScoreSummary, Staff } from '../shared/protocol.js'
import { Voice, voiceFromJson, type Operation, type VoiceElement } from '../shared/voice.js'
import { query, type Queryable } from './db.js'
import { notFound } from './errors.js'

interface ScoreRow {
  id: string
  title: string
  measure_count: number
  time_signatures: TimeSignature[]
  tempos: { measure: number; bpm: number }[]
  lamport: number
  last_seq: number
  rev: string
  snapshot_seq: number
}

interface StaffRow {
  id: string
  name: string
  clef: Staff['clef']
  transpose: Staff['transpose']
  part_id: string
  ord: number
}

export interface PartRow {
  id: string
  name: string
  status: Part['status']
  revision: number
  extracted_at_lamport: number | null
  page_count: number | null
  layout: Part['layout']
  layout_changed: boolean
  last_error: Part['lastError']
}

export class ScoreState {
  grid: MeasureGrid
  staves: Staff[] = []
  parts: PartRef[] = []
  readonly voices = new Map<string, Voice>()
  appliedSeq = 0

  constructor(
    public row: ScoreRow,
  ) {
    this.grid = new MeasureGrid(row.time_signatures)
  }

  get id(): string {
    return this.row.id
  }

  voice(staffId: string, voice: 1 | 2): Voice {
    const key = `${staffId}:${voice}`
    let found = this.voices.get(key)
    if (!found) {
      found = new Voice()
      this.voices.set(key, found)
    }
    return found
  }

  staff(staffId: string): Staff | undefined {
    return this.staves.find((s) => s.id === staffId)
  }

  tombstones(): number {
    let n = 0
    for (const v of this.voices.values()) n += v.tombstones()
    return n
  }

  summary(): ScoreSummary {
    const r = this.row
    return {
      id: r.id, title: r.title, measureCount: r.measure_count, timeSignatures: r.time_signatures, tempos: r.tempos,
      staves: this.staves, parts: this.parts, lamport: r.lamport, lastSeq: r.last_seq,
    }
  }

  /** Rebuilds the grid after the time signatures changed. */
  resetGrid(): void {
    this.grid = new MeasureGrid(this.row.time_signatures)
  }
}

const cache = new Map<string, ScoreState>()

async function loadStructure(state: ScoreState, db?: Queryable): Promise<void> {
  const staves = await query<StaffRow>('SELECT id, name, clef, transpose, part_id, ord FROM staves WHERE score_id = $1 ORDER BY ord', [state.id], db)
  state.staves = staves.map((s) => ({ id: s.id, name: s.name, clef: s.clef, transpose: s.transpose, partId: s.part_id, order: s.ord }))
  const parts = await query<{ id: string; name: string }>('SELECT id, name FROM parts WHERE score_id = $1 ORDER BY id', [state.id], db)
  const order = new Map(state.staves.map((s, i) => [s.id, i]))
  state.parts = parts
    .map((p) => ({ id: p.id, name: p.name, staffIds: state.staves.filter((s) => s.partId === p.id).map((s) => s.id) }))
    .sort((a, b) => (order.get(a.staffIds[0] ?? '') ?? 1e9) - (order.get(b.staffIds[0] ?? '') ?? 1e9))
}

async function replay(state: ScoreState, from: number, to: number, db?: Queryable): Promise<void> {
  const ops = await query<{ payload: Operation }>('SELECT payload FROM ops WHERE score_id = $1 AND seq > $2 AND seq <= $3 ORDER BY seq', [state.id, from, to], db)
  for (const { payload } of ops) state.voice(payload.staffId, payload.voice).apply(payload)
  state.appliedSeq = to
}

async function rebuild(row: ScoreRow, db?: Queryable): Promise<ScoreState> {
  const state = new ScoreState(row)
  await loadStructure(state, db)
  const [snapshot] = await query<{ seq: number; state: { voices: Record<string, VoiceElement[]> } }>(
    'SELECT seq, state FROM snapshots WHERE score_id = $1 AND seq <= $2 ORDER BY seq DESC LIMIT 1', [row.id, row.last_seq], db)
  for (const [key, elements] of Object.entries(snapshot?.state.voices ?? {})) state.voices.set(key, voiceFromJson(elements))
  await replay(state, snapshot?.seq ?? 0, row.last_seq, db)
  return state
}

async function readScoreRow(scoreId: string, db?: Queryable, lock = false): Promise<ScoreRow | null> {
  const [row] = await query<ScoreRow>(`SELECT * FROM scores WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [scoreId], db)
  return row ?? null
}

/** The current state of a score; 404 for an unknown score. `db` joins the caller's transaction. */
export async function loadScore(scoreId: string, db?: Queryable, lock = false): Promise<ScoreState> {
  const row = await readScoreRow(scoreId, db, lock)
  if (!row) throw notFound()
  const hit = cache.get(scoreId)
  if (hit?.row.rev === row.rev) return hit
  try {
    let state: ScoreState
    if (hit && hit.row.snapshot_seq === row.snapshot_seq) {
      const from = hit.appliedSeq
      state = hit
      state.row = row
      state.resetGrid()
      await loadStructure(state, db)
      await replay(state, from, row.last_seq, db)
    } else {
      state = await rebuild(row, db)
    }
    cache.set(scoreId, state)
    return state
  } catch (error) {
    cache.delete(scoreId)
    throw error
  }
}

/** Called by the operation recorder once its transaction committed, with the state it mutated in place. */
export function adopt(state: ScoreState, row: ScoreRow): void {
  state.row = row
  state.appliedSeq = row.last_seq
  state.resetGrid()
  cache.set(row.id, state)
}

/** The smallest acknowledged stamp among active collaborators; `self` counts the stamp its batch just acknowledged. */
export async function stableLamport(scoreId: string, db?: Queryable, self?: { id: string; seen: number }): Promise<number> {
  const [row] = await query<{ stable: number }>(
    `SELECT coalesce(min(CASE WHEN id = $2 THEN greatest(ack_lamport, $3) ELSE ack_lamport END), 0) AS stable
     FROM collaborators WHERE score_id = $1 AND status = 'active'`, [scoreId, self?.id ?? '', self?.seen ?? 0], db)
  return (row as { stable: number }).stable
}

export function forget(scoreId: string): void {
  cache.delete(scoreId)
}

export function collaboratorView(row: { id: string; name: string; role: Collaborator['role']; status: Collaborator['status']; staff_ids: string[] }, state: ScoreState): Collaborator {
  return {
    id: row.id, name: row.name, role: row.role, status: row.status,
    staffIds: row.role === 'player' ? row.staff_ids : state.staves.map((s) => s.id),
  }
}
