// Turns each staff's placed events into drawable items (one per standard note value) bucketed by
// measure once, so planning and drawing never scan events again.

import {
  MeasureGrid, WHOLE_TICKS, formatBeat, middleLine, staffStep, transposePitch,
  type DurationName, type Pitch, type TimeSignature,
} from '../../shared/music.js'
import type { PlacedEvent } from '../../shared/voice.js'
import { accidentalWidth } from './smufl.js'
import type { EngraveRequest, StaffSource } from './types.js'

export interface Item {
  staff: number
  voice: 1 | 2
  measure: number
  /** Ticks from the start of the measure. */
  tick: number
  ticks: number
  duration: DurationName
  dots: number
  /** Written or concert pitch to draw; null for a rest. */
  pitch: Pitch | null
  /** Half-staff-spaces above the bottom line. */
  pos: number
  /** Null for the rests implied after a voice's last event. */
  event: PlacedEvent | null
  beat: string
  /** First glyph of its event: it carries the dynamic and the text. */
  leading: boolean
  /** A rest that fills its measure is centred. */
  fullMeasure: boolean
  /** Alter to write before the notehead, or null. */
  accidental: number | null
  /** Staff spaces the head moves right to clear the other voice. */
  shift: number
  /** Staff spaces the accidental moves left to clear the other voice's accidental. */
  accidentalShift: number
  tieOut: Item | null
  /** Measure of the note this one is tied from, 0 when none. */
  tieFromMeasure: number
}

export interface Cell {
  staff: number
  voices: [Item[], Item[]]
}

export interface MeasureLayout {
  /** Staff spaces taken by a time signature at the start of the measure. */
  signatureWidth: number
  /** Head offsets in staff spaces from the left barline, one per column. */
  heads: number[]
  columnOf: Map<number, number>
  width: number
}

export interface Index {
  grid: MeasureGrid
  measureCount: number
  signatureChanges: Map<number, TimeSignature>
  tempos: Map<number, number>
  cells: Map<number, Cell[]>
  layouts: Map<number, MeasureLayout>
}

interface Value {
  duration: DurationName
  dots: number
  ticks: number
}

const VALUES: readonly Value[] = [
  { duration: 'whole', dots: 0, ticks: 1920 },
  { duration: 'half', dots: 1, ticks: 1440 },
  { duration: 'half', dots: 0, ticks: 960 },
  { duration: 'quarter', dots: 1, ticks: 720 },
  { duration: 'quarter', dots: 0, ticks: 480 },
  { duration: 'eighth', dots: 1, ticks: 360 },
  { duration: 'eighth', dots: 0, ticks: 240 },
  { duration: '16th', dots: 1, ticks: 180 },
  { duration: '16th', dots: 0, ticks: 120 },
  { duration: '32nd', dots: 1, ticks: 90 },
  { duration: '32nd', dots: 0, ticks: 60 },
]
const SMALLEST: Value = { duration: '32nd', dots: 0, ticks: 60 }
const WHOLE_VALUE: Value = { duration: 'whole', dots: 0, ticks: WHOLE_TICKS }

/** The fewest standard values that add up to `ticks`, longest first. */
function splitTicks(ticks: number): Value[] {
  const out: Value[] = []
  let rest = ticks
  while (rest >= SMALLEST.ticks) {
    const value = VALUES.find((v) => v.ticks <= rest) ?? SMALLEST
    out.push(value)
    rest -= value.ticks
  }
  if (out.length === 0) out.push(SMALLEST)
  return out
}

function normaliseSignatures(signatures: readonly TimeSignature[]): TimeSignature[] {
  const sorted = [...signatures].sort((a, b) => a.measure - b.measure)
  const first = sorted[0]
  if (!first || first.measure > 1) sorted.unshift({ measure: 1, beats: first?.beats ?? 4, beatType: first?.beatType ?? 4 })
  return sorted
}

function changesOf(signatures: readonly TimeSignature[]): Map<number, TimeSignature> {
  const changes = new Map<number, TimeSignature>()
  let previous: TimeSignature | null = null
  for (const sig of signatures) {
    if (!previous || previous.beats !== sig.beats || previous.beatType !== sig.beatType) changes.set(sig.measure, sig)
    previous = sig
  }
  return changes
}

interface BuildContext {
  grid: MeasureGrid
  measureCount: number
  part: boolean
  staffIndex: number
  staff: StaffSource
  middle: number
  cellAt: (measure: number) => Cell
}

function written(build: BuildContext, pitch: Pitch): Pitch {
  return build.part ? transposePitch(pitch, build.staff.transpose, -1) : pitch
}

function itemsOf(cell: Cell, voice: 1 | 2): Item[] {
  return voice === 1 ? cell.voices[0] : cell.voices[1]
}

function addVoice(build: BuildContext, voice: 1 | 2, events: readonly PlacedEvent[]): void {
  const { grid, measureCount } = build
  let previous: Item | null = null
  let tiePending = false
  let end: { measure: number; offset: number } | null = null
  events.forEach((event, e) => {
    const sounding = event.kind === 'note' && event.pitch ? written(build, event.pitch) : null
    const tiedOnward = event.tie && sounding !== null && events[e + 1]?.kind === 'note'
    const single = event.pieces.length === 1
    let leading = true
    event.pieces.forEach((piece, p) => {
      if (piece.measure < 1 || piece.measure > measureCount) return
      const measureLength = grid.measureLength(piece.measure)
      const beatTicks = WHOLE_TICKS / grid.signatureAt(piece.measure).beatType
      const offset = Math.round((piece.beat - 1) * beatTicks)
      const fullMeasure = sounding === null && offset === 0 && piece.ticks === measureLength
      const values = fullMeasure ? [WHOLE_VALUE] : single ? [{ duration: event.duration, dots: event.dots, ticks: piece.ticks }] : splitTicks(piece.ticks)
      let tick = offset
      values.forEach((value, k) => {
        const item: Item = {
          staff: build.staffIndex, voice, measure: piece.measure, tick, ticks: value.ticks, duration: value.duration, dots: value.dots,
          pitch: sounding, pos: sounding ? staffStep(sounding.step, sounding.octave) - build.middle + 4 : 0, event,
          beat: formatBeat(piece.beat), leading, fullMeasure, accidental: sounding && sounding.alter !== 0 ? sounding.alter : null,
          shift: 0, accidentalShift: 0, tieOut: null, tieFromMeasure: 0,
        }
        if (tiePending && sounding && previous) {
          previous.tieOut = item
          item.tieFromMeasure = previous.measure
        }
        const lastValue = p === event.pieces.length - 1 && k === values.length - 1
        tiePending = sounding !== null && (!lastValue || tiedOnward)
        previous = item
        leading = false
        tick += value.ticks
        itemsOf(build.cellAt(piece.measure), voice).push(item)
      })
      end = { measure: piece.measure, offset: offset + piece.ticks }
    })
  })
  const last = end as { measure: number; offset: number } | null
  if (!last) return
  const length = grid.measureLength(last.measure)
  if (last.offset >= length) return
  let tick = last.offset
  for (const value of splitTicks(length - last.offset)) {
    itemsOf(build.cellAt(last.measure), voice).push({
      staff: build.staffIndex, voice, measure: last.measure, tick, ticks: value.ticks, duration: value.duration, dots: value.dots,
      pitch: null, pos: 0, event: null, beat: '', leading: false, fullMeasure: false, accidental: null, shift: 0, accidentalShift: 0,
      tieOut: null, tieFromMeasure: 0,
    })
    tick += value.ticks
  }
}

/** Marks naturals after altered notes, and moves the second voice clear of the first. */
function settleCell(cell: Cell): void {
  const [upper, lower] = cell.voices
  const notes = [...upper, ...lower].filter((item) => item.pitch).sort((a, b) => a.tick - b.tick)
  const state = new Map<string, number>()
  for (const item of notes) {
    const pitch = item.pitch as Pitch
    const key = `${pitch.step}${pitch.octave}`
    if (pitch.alter === 0 && (state.get(key) ?? 0) !== 0) item.accidental = 0
    state.set(key, pitch.alter)
  }
  for (const second of lower) {
    if (!second.pitch) continue
    for (const first of upper) {
      if (first.tick !== second.tick || !first.pitch) continue
      const gap = Math.abs(first.pos - second.pos)
      const sameHead = (first.duration === 'whole') === (second.duration === 'whole') && (first.duration === 'half') === (second.duration === 'half')
      if (gap === 1 || (gap === 0 && !sameHead)) second.shift = 1.18
      if (gap <= 6 && first.accidental !== null && second.accidental !== null) second.accidentalShift = accidentalWidth(first.accidental) + 0.2
    }
  }
}

function buildIndex(req: EngraveRequest): Index {
  const signatures = normaliseSignatures(req.timeSignatures)
  const grid = new MeasureGrid(signatures)
  const cells = new Map<number, Cell[]>()
  req.staves.forEach((staff, staffIndex) => {
    const local = new Map<number, Cell>()
    const mid = middleLine(staff.clef)
    const build: BuildContext = {
      grid, measureCount: req.measureCount, part: req.view === 'part', staffIndex, staff, middle: staffStep(mid.step, mid.octave),
      cellAt: (measure) => {
        let cell = local.get(measure)
        if (!cell) {
          cell = { staff: staffIndex, voices: [[], []] }
          local.set(measure, cell)
        }
        return cell
      },
    }
    addVoice(build, 1, staff.voices[0])
    addVoice(build, 2, staff.voices[1])
    for (const [measure, cell] of local) {
      settleCell(cell)
      const list = cells.get(measure)
      if (list) list.push(cell)
      else cells.set(measure, [cell])
    }
  })
  return {
    grid, measureCount: req.measureCount, signatureChanges: changesOf(signatures), cells, layouts: new Map(),
    tempos: new Map(req.tempos.map((t) => [t.measure, t.bpm])),
  }
}

const indexes = new WeakMap<EngraveRequest, Index>()

/** The index of a request, built once per request object. */
export function indexOf(req: EngraveRequest): Index {
  let index = indexes.get(req)
  if (!index) {
    index = buildIndex(req)
    indexes.set(req, index)
  }
  return index
}
