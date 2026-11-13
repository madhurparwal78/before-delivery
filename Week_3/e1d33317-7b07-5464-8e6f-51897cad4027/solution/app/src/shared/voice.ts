// A voice is one replicated sequence of notes and rests. The insert ordering rule and the
// field winner rule are decided here, once; the server and every editor use this module.

import { durationTicks, MeasureGrid, type DurationName, type Piece, type Pitch } from './music.js'

export interface ElementId {
  lamport: number
  site: string
}

export type SetField = 'pitch' | 'duration' | 'dots' | 'tie' | 'dynamic' | 'dynamicPlacement' | 'text'
export const SET_FIELDS: readonly SetField[] = ['pitch', 'duration', 'dots', 'tie', 'dynamic', 'dynamicPlacement', 'text']
export const DYNAMICS = ['pp', 'p', 'mp', 'mf', 'f', 'ff', 'sfz', 'fp'] as const
export type Dynamic = (typeof DYNAMICS)[number]
type Placement = 'above' | 'below'

export interface NewEvent {
  kind: 'note' | 'rest'
  pitch?: Pitch
  duration: DurationName
  dots: number
}

interface OpBase {
  id: ElementId
  staffId: string
  voice: 1 | 2
}
export interface InsertOp extends OpBase {
  type: 'insert'
  after: ElementId | null
  event: NewEvent
}
interface DeleteOp extends OpBase {
  type: 'delete'
  target: ElementId
}
interface SetOp extends OpBase {
  type: 'set'
  target: ElementId
  field: SetField
  value: unknown
}
export type Operation = InsertOp | DeleteOp | SetOp

export interface VoiceElement {
  id: ElementId
  kind: 'note' | 'rest'
  pitch: Pitch | null
  duration: DurationName
  dots: number
  tie: boolean
  dynamic: Dynamic | null
  dynamicPlacement: Placement
  text: string
  stamps: Partial<Record<SetField, ElementId>>
  deleted: ElementId | null
}

export interface PlacedEvent {
  id: ElementId
  kind: 'note' | 'rest'
  pitch: Pitch | null
  duration: DurationName
  dots: number
  ticks: number
  tie: boolean
  dynamic: Dynamic | null
  dynamicPlacement: Placement | null
  text: string
  measure: number
  beat: number
  pieces: Piece[]
}

export const durationTicksOf = (e: Pick<VoiceElement, 'duration' | 'dots'>): number => durationTicks(e.duration, e.dots)

export const idKey = (id: ElementId): string => `${id.lamport}@${id.site}`

/** Greater stamp first: compares lamport, then site as plain text. Positive when `a` is later than `b`. */
export function compareStamps(a: ElementId, b: ElementId): number {
  if (a.lamport !== b.lamport) return a.lamport - b.lamport
  return a.site === b.site ? 0 : a.site > b.site ? 1 : -1
}

export type Undo = () => void

export class Voice {
  elements: VoiceElement[] = []
  readonly byId = new Map<string, VoiceElement>()
  private placed: { grid: MeasureGrid; events: PlacedEvent[] } | null = null

  has(id: ElementId): boolean {
    return this.byId.has(idKey(id))
  }

  get(id: ElementId): VoiceElement | undefined {
    return this.byId.get(idKey(id))
  }

  /** Applies one operation. Returns how to take it back, or null when it changed nothing. */
  apply(op: Operation): Undo | null {
    this.placed = null
    if (op.type === 'insert') return this.insert(op)
    const target = this.byId.get(idKey(op.target))
    if (!target) return null
    if (op.type === 'delete') {
      if (target.deleted) return null
      target.deleted = op.id
      return () => {
        target.deleted = null
        this.placed = null
      }
    }
    const current = target.stamps[op.field] ?? target.id
    if (compareStamps(op.id, current) <= 0) return null
    const previousValue = target[op.field]
    const previousStamp = target.stamps[op.field]
    ;(target as unknown as Record<string, unknown>)[op.field] = op.value
    target.stamps[op.field] = op.id
    return () => {
      ;(target as unknown as Record<string, unknown>)[op.field] = previousValue
      if (previousStamp) target.stamps[op.field] = previousStamp
      else delete target.stamps[op.field]
      this.placed = null
    }
  }

  private insert(op: InsertOp): Undo | null {
    if (this.byId.has(idKey(op.id))) return null
    let at = 0
    if (op.after) {
      const anchor = this.elements.findIndex((e) => e.id.lamport === op.after?.lamport && e.id.site === op.after.site)
      if (anchor === -1) return null
      at = anchor + 1
    }
    while (at < this.elements.length && compareStamps((this.elements[at] as VoiceElement).id, op.id) > 0) at++
    const element: VoiceElement = {
      id: op.id,
      kind: op.event.kind,
      pitch: op.event.kind === 'note' ? (op.event.pitch ?? null) : null,
      duration: op.event.duration,
      dots: op.event.dots,
      tie: false,
      dynamic: null,
      dynamicPlacement: 'below',
      text: '',
      stamps: {},
      deleted: null,
    }
    this.elements.splice(at, 0, element)
    this.byId.set(idKey(op.id), element)
    return () => {
      this.elements.splice(this.elements.indexOf(element), 1)
      this.byId.delete(idKey(op.id))
      this.placed = null
    }
  }

  tombstones(): number {
    let n = 0
    for (const e of this.elements) if (e.deleted) n++
    return n
  }

  /** Drops deleted elements whose delete stamp is at or below `stable`. */
  compact(stable: number): number {
    const kept = this.elements.filter((e) => !e.deleted || e.deleted.lamport > stable)
    const dropped = this.elements.length - kept.length
    if (dropped) {
      for (const e of this.elements) if (e.deleted && e.deleted.lamport <= stable) this.byId.delete(idKey(e.id))
      this.elements = kept
      this.placed = null
    }
    return dropped
  }

  /** Visible events in order with measure, beat and barline pieces. */
  events(grid: MeasureGrid): PlacedEvent[] {
    if (this.placed?.grid === grid) return this.placed.events
    const events: PlacedEvent[] = []
    let tick = 0
    for (const e of this.elements) {
      if (e.deleted) continue
      const ticks = durationTicks(e.duration, e.dots)
      const pieces = grid.pieces(tick, ticks)
      const first = pieces[0] as Piece
      events.push({
        id: e.id, kind: e.kind, pitch: e.pitch, duration: e.duration, dots: e.dots, ticks, tie: e.tie, dynamic: e.dynamic,
        dynamicPlacement: e.kind === 'rest' ? null : e.dynamicPlacement, text: e.text, measure: first.measure, beat: first.beat, pieces,
      })
      tick += ticks
    }
    this.placed = { grid, events }
    return events
  }

  totalTicks(): number {
    let tick = 0
    for (const e of this.elements) if (!e.deleted) tick += durationTicks(e.duration, e.dots)
    return tick
  }
}

/** Serializable form of a voice for snapshots. */
export function voiceToJson(voice: Voice): VoiceElement[] {
  return voice.elements
}

export function voiceFromJson(elements: VoiceElement[]): Voice {
  const voice = new Voice()
  voice.elements = elements
  for (const e of elements) voice.byId.set(idKey(e.id), e)
  return voice
}
