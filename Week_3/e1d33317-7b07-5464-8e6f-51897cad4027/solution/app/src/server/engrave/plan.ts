// Measure widths and the choice of systems and pages. Widths come from the content of each measure
// across every staff and both voices; everything is measured in staff spaces until drawing.

import { textRuns } from '../../shared/text.js'
import { WHOLE_TICKS } from '../../shared/music.js'
import { accidentalWidth, DOT_ADVANCE, headWidth, restWidth, TIME_DIGIT_WIDTH } from './smufl.js'
import { indexOf, type Index, type Item, type MeasureLayout } from './model.js'
import type { EngraveRequest, SystemPlan } from './types.js'

export interface Metrics {
  /** User units per staff space. */
  sp: number
  /** Width of the drawing area in user units. */
  width: number
  /** Where the staff lines start, in user units. */
  left: number
  names: boolean
}

const SCORE_METRICS: Metrics = { sp: 7, width: 1000, left: 100, names: true }
export const PART_PAGE = { width: 864, height: 1152, margin: 54 }
export const PART_METRICS: Metrics = { sp: 6, width: PART_PAGE.width - 2 * PART_PAGE.margin, left: 0, names: false }

const MEASURE_PAD = 1
const REST_MEASURE_WIDTH = 7.2
const FINAL_BARLINE_EXTRA = 0.9
export const TEXT_SIZE = 1.7
const TEXT_WIDTH_CAP = 12
const SCORE_PAGE_HEIGHT = 1400
const SYSTEM_GAP = 2.5
const MAX_PART_SYSTEMS = 10

/** Staff spaces from the staff start to the first barline: the room for the clef. */
export const HEADER_WIDTH = 4.4

/** Space taken by the note value alone, after the notehead. */
function bodyWidth(item: Item): number {
  const head = item.pitch ? headWidth(item.duration) : restWidth(item.duration)
  return head + item.shift + (item.dots > 0 ? 0.35 + item.dots * DOT_ADVANCE : 0)
}

function textWidth(item: Item): number {
  if (!item.leading || !item.event?.text) return 0
  let widest = 0
  let line = 0
  for (const run of textRuns(item.event.text)) {
    if (run.breakBefore) line = 0
    line += run.text.length * TEXT_SIZE * 0.52
    widest = Math.max(widest, line)
  }
  return Math.min(widest, TEXT_WIDTH_CAP)
}

function spacing(ticks: number): number {
  return 2 + Math.log2(Math.max(ticks, 60) / 60)
}

function signatureWidth(index: Index, measure: number): number {
  const sig = index.signatureChanges.get(measure)
  if (!sig) return 0
  const digits = Math.max(String(sig.beats).length, String(sig.beatType).length)
  return digits * TIME_DIGIT_WIDTH + 1
}

function layoutMeasure(index: Index, measure: number): MeasureLayout {
  const signature = signatureWidth(index, measure)
  const finalExtra = measure === index.measureCount ? FINAL_BARLINE_EXTRA : 0
  const cells = index.cells.get(measure)
  const columns = new Map<number, { lead: number; right: number }>()
  for (const cell of cells ?? []) {
    for (const items of cell.voices) {
      for (const item of items) {
        if (item.fullMeasure) continue
        const lead = item.accidental === null ? 0 : accidentalWidth(item.accidental) + 0.45 + item.accidentalShift
        const right = Math.max(bodyWidth(item), textWidth(item))
        const column = columns.get(item.tick)
        if (column) {
          column.lead = Math.max(column.lead, lead)
          column.right = Math.max(column.right, right)
        } else columns.set(item.tick, { lead, right })
      }
    }
  }
  const ticks = [...columns.keys()].sort((a, b) => a - b)
  const heads: number[] = []
  const columnOf = new Map<number, number>()
  const restWidthTotal = signature + REST_MEASURE_WIDTH + finalExtra
  if (ticks.length === 0) return { signatureWidth: signature, heads, columnOf, width: restWidthTotal }
  const length = index.grid.measureLength(measure)
  let x = signature + MEASURE_PAD
  let right = 0
  ticks.forEach((tick, i) => {
    const column = columns.get(tick) ?? { lead: 0, right: 0 }
    if (i === 0) x += column.lead
    else {
      const previousTick = ticks[i - 1] ?? 0
      x += Math.max(spacing(tick - previousTick), right + column.lead + 0.5)
    }
    heads.push(x)
    columnOf.set(tick, i)
    right = column.right
  })
  const lastTick = ticks[ticks.length - 1] ?? 0
  const width = x + Math.max(spacing(length - lastTick) - 0.6, right + 0.7) + finalExtra
  return { signatureWidth: signature, heads, columnOf, width: Math.max(width, restWidthTotal) }
}

/** The layout of a measure; measures with no notes are cheap and are not kept. */
export function measureLayout(index: Index, measure: number): MeasureLayout {
  const kept = index.layouts.get(measure)
  if (kept) return kept
  const layout = layoutMeasure(index, measure)
  if (index.cells.has(measure)) index.layouts.set(measure, layout)
  return layout
}

/** Beat group length in ticks used when beaming eighths and shorter notes. */
export function beamGroupTicks(index: Index, measure: number): number {
  const { beats, beatType } = index.grid.signatureAt(measure)
  const unit = WHOLE_TICKS / beatType
  return beats % 3 === 0 && beats >= 6 && beatType >= 8 ? unit * 3 : Math.min(unit, 480)
}

export function availableWidth(metrics: Metrics): number {
  return (metrics.width - metrics.left) / metrics.sp - HEADER_WIDTH
}

/** The height a system is given when pages are filled, before its content is known. */
function nominalSystemHeight(staffCount: number, sp: number): number {
  const staves = Math.max(1, staffCount)
  return (3.1 + 2 + staves * 4 + (staves - 1) * 4.4 + 1.6 + SYSTEM_GAP) * sp
}

export function metricsFor(req: EngraveRequest): Metrics {
  return req.view === 'part' ? PART_METRICS : SCORE_METRICS
}

export function partPageCapacity(staffCount: number): number {
  return Math.max(1, Math.floor(MAX_PART_SYSTEMS / Math.max(1, staffCount)))
}

export function planSystems(req: EngraveRequest): SystemPlan[] {
  const count = Math.floor(req.measureCount)
  if (count < 1) return []
  const index = indexOf(req)
  const metrics = metricsFor(req)
  const available = availableWidth(metrics)
  const part = req.view === 'part'
  const systemBreaks = new Set(part ? req.layout.systemBreaks : [])
  const pageBreaks = new Set(part ? req.layout.pageBreaks : [])
  const capacity = partPageCapacity(req.staves.length)
  const systemHeight = nominalSystemHeight(req.staves.length, metrics.sp)
  const plans: SystemPlan[] = []
  let page = 1
  let onPage = 0
  let heightOnPage = 0

  const close = (firstMeasure: number, lastMeasure: number, pageTurn: boolean): void => {
    if (part) {
      if (onPage >= capacity) {
        page++
        onPage = 0
      }
      plans.push({ index: plans.length + 1, page, firstMeasure, lastMeasure })
      onPage++
      if (pageTurn) {
        page++
        onPage = 0
      }
      return
    }
    if (heightOnPage > 0 && heightOnPage + systemHeight > SCORE_PAGE_HEIGHT) {
      page++
      heightOnPage = 0
    }
    plans.push({ index: plans.length + 1, page, firstMeasure, lastMeasure })
    heightOnPage += systemHeight
  }

  let first = 1
  let used = 0
  for (let measure = 1; measure <= count; measure++) {
    const width = measureLayout(index, measure).width
    if (measure > first && used + width > available) {
      close(first, measure - 1, false)
      first = measure
      used = 0
    }
    used += width
    const turn = pageBreaks.has(measure)
    if (measure === count || turn || systemBreaks.has(measure)) {
      close(first, measure, turn)
      first = measure + 1
      used = 0
    }
  }
  return plans
}
