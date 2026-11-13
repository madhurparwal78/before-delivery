import type { Colour, ColourWarning, Repeat, Row, RowState, Segment } from '../../shared/api.ts'
import { CABLE_CELLS, CABLE_KEY, type Craft, type Mode, type Side, type Terms, readsLeftward, sideOf, symbolByKey, symbolText } from '../../shared/symbols.ts'
import { config } from '../config.ts'

/** A chart held as two grids indexed [row - 1][col - 1]. */
export interface ChartData {
  craft: Craft
  mode: Mode
  terms: Terms | null
  castOn: number
  width: number
  height: number
  colours: Colour[]
  repeats: Repeat[]
  stitch: string[][]
  colour: string[][]
}

interface Slot { col: number; stitch: string; colour: string }

/** One worked item of a row: a stitch, or a run of up to four cable cells. */
interface Item {
  key: string
  text: string
  colour: string
  uses: number
  makes: number
  cols: number[]
  counted: boolean
  cable: boolean
}

export interface RowAnalysis {
  row: number
  side: Side
  empty: boolean
  used: number
  made: number
  items: Item[]
  /** the stitches the nearest non-empty row below made, or the cast-on */
  needed: number
  errors: string[]
  text: string
  segments: Segment[]
}

export interface Analysis {
  rows: RowAnalysis[]
  warnings: ColourWarning[]
}

export function blankGrid<T>(height: number, width: number, value: T): T[][] {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => value))
}

function repeatsOnRow(chart: ChartData, row: number): Repeat[] {
  return chart.repeats.filter((b) => b.fromRow <= row && row <= b.toRow).sort((a, b) => a.fromCol - b.fromCol)
}

/** The row left to right with every repeat box worked `times` times. */
function slotsOf(chart: ChartData, row: number): Slot[] {
  const boxes = repeatsOnRow(chart, row)
  const stitches = chart.stitch[row - 1]
  const colours = chart.colour[row - 1]
  const slots: Slot[] = []
  let col = 1
  while (col <= chart.width) {
    const box = boxes.find((b) => b.fromCol === col)
    if (box) {
      for (let t = 0; t < box.times; t++) {
        for (let c = box.fromCol; c <= box.toCol; c++) slots.push({ col: c, stitch: stitches[c - 1], colour: colours[c - 1] })
      }
      col = box.toCol + 1
    } else {
      slots.push({ col, stitch: stitches[col - 1], colour: colours[col - 1] })
      col++
    }
  }
  return slots
}

/** The row's slots in the order they are worked. */
function inReadingOrder<T>(slots: T[], side: Side): T[] {
  return readsLeftward(side) ? [...slots].reverse() : slots
}

function itemsOf(chart: ChartData, slots: Slot[], side: Side): Item[] {
  const order = inReadingOrder(slots, side)
  const items: Item[] = []
  let i = 0
  while (i < order.length) {
    const slot = order[i]
    if (slot.stitch === 'ns') { i++; continue }
    if (slot.stitch === CABLE_KEY) {
      let end = i
      while (end < order.length && order[end].stitch === CABLE_KEY) end++
      for (let at = i; at < end; at += CABLE_CELLS) {
        const group = order.slice(at, Math.min(at + CABLE_CELLS, end))
        const symbol = symbolByKey(chart.craft, chart.terms, CABLE_KEY)!
        items.push({ key: CABLE_KEY, text: symbol.rsText, colour: group[0].colour, uses: group.length, makes: group.length,
          cols: group.map((s) => s.col), counted: false, cable: true })
      }
      i = end
      continue
    }
    const symbol = symbolByKey(chart.craft, chart.terms, slot.stitch)!
    items.push({ key: symbol.key, text: symbolText(symbol, side), colour: slot.colour, uses: symbol.uses, makes: symbol.makes,
      cols: [slot.col], counted: symbol.counted, cable: false })
    i++
  }
  return items
}

interface Run { text: string; cols: number[] }

function sameItem(a: Item, b: Item): boolean {
  return a.text === b.text && a.colour === b.colour
}

function unique(cols: number[]): number[] {
  return [...new Set(cols)]
}

function runsOf(items: Item[], multiColour: boolean): Run[] {
  const runs: Run[] = []
  let i = 0
  while (i < items.length) {
    let j = i + 1
    while (j < items.length && sameItem(items[i], items[j])) j++
    const first = items[i]
    const count = j - i
    let text = first.counted ? `${first.text}${count}` : count === 1 ? first.text : `${first.text} x${count}`
    if (multiColour) text += ` in ${first.colour}`
    runs.push({ text, cols: unique(items.slice(i, j).flatMap((it) => it.cols)) })
    i = j
  }
  return runs
}

interface Repetition { period: number; start: number; copies: number }

/** The first (period, start) whose unit is not uniform and is followed at once by itself. */
function findRepetition(items: Item[]): Repetition | null {
  const ids = new Map<string, number>()
  const code = items.map((it) => {
    const label = `${it.text}|${it.colour}`
    if (!ids.has(label)) ids.set(label, ids.size)
    return ids.get(label)!
  })
  const n = code.length
  const uniform = new Array<number>(n).fill(1)
  for (let i = n - 2; i >= 0; i--) uniform[i] = code[i] === code[i + 1] ? uniform[i + 1] + 1 : 1
  for (let period = 2; period <= Math.floor(n / 2); period++) {
    const match = new Array<number>(n - period + 1).fill(0)
    for (let i = n - period - 1; i >= 0; i--) match[i] = code[i] === code[i + period] ? match[i + 1] + 1 : 0
    for (let start = 0; start + 2 * period <= n; start++) {
      if (match[start] >= period && uniform[start] < period) {
        return { period, start, copies: Math.floor((match[start] + period) / period) }
      }
    }
  }
  return null
}

function sum(items: Item[], pick: (item: Item) => number): number {
  return items.reduce((total, item) => total + pick(item), 0)
}

function countText(made: number): string {
  return made === 1 ? '(1 st)' : `(${made} sts)`
}

function lineOf(label: string, items: Item[], made: number): { text: string; segments: Segment[] } {
  const multi = new Set(items.map((it) => it.colour)).size > 1
  const pieces: Segment[] = [{ text: `${label} ` }]
  const plain = (text: string) => pieces.push({ text })
  const token = (run: Run) => pieces.push({ text: run.text, cols: run.cols })
  const joined = (runs: Run[]) => runs.forEach((run, i) => { if (i) plain(', '); token(run) })
  const repetition = findRepetition(items)
  if (!repetition) {
    joined(runsOf(items, multi))
    plain('.')
  } else {
    const { period, start, copies } = repetition
    const before = items.slice(0, start)
    const tail = items.slice(start + copies * period)
    const copyRuns = Array.from({ length: copies }, (_, c) =>
      runsOf(items.slice(start + c * period, start + (c + 1) * period), multi))
    const unitRuns = copyRuns[0].map((run, j) => ({ text: run.text, cols: unique(copyRuns.flatMap((runs) => runs[j].cols)) }))
    const beforeRuns = runsOf(before, multi)
    joined(beforeRuns)
    if (beforeRuns.length) plain(', ')
    plain('*')
    joined(unitRuns)
    plain('; rep from * to ')
    if (!tail.length) {
      plain('end.')
    } else {
      const tailUses = sum(tail, (it) => it.uses)
      plain(tailUses === 0 ? 'end, ' : tailUses === 1 ? 'last st, ' : `last ${tailUses} sts, `)
      joined(runsOf(tail, multi))
      plain('.')
    }
  }
  plain(` ${countText(made)}`)
  const segments: Segment[] = []
  for (const piece of pieces) {
    const last = segments[segments.length - 1]
    if (!piece.cols && last && !last.cols) last.text += piece.text
    else segments.push({ ...piece })
  }
  return { text: segments.map((s) => s.text).join(''), segments }
}

function labelOf(side: Side, row: number): string {
  return side === 'RND' ? `Rnd ${row}:` : `Row ${row} (${side}):`
}

function rowErrors(chart: ChartData, row: number, side: Side, slots: Slot[], used: number, needed: number): string[] {
  const errors: string[] = []
  if (used !== needed) errors.push(`Row ${row} needs ${needed} stitches, found ${used}.`)
  const order = inReadingOrder(slots, side)
  let brokenCable = false
  let run = 0
  for (const slot of [...order, { col: 0, stitch: 'ns', colour: 'A' }]) {
    if (slot.stitch === CABLE_KEY) run++
    else {
      if (run % CABLE_CELLS !== 0) brokenCable = true
      run = 0
    }
  }
  if (brokenCable) errors.push(`Row ${row}: a 2/2 cable needs 4 cells.`)
  if (chart.mode === 'flat' && side === 'WS' && order.some((s) => s.stitch === CABLE_KEY)) {
    errors.push(`Row ${row}: 2/2 LC can only be worked on a right-side row.`)
  }
  return errors
}

export function analyseChart(chart: ChartData): Analysis {
  const rows: RowAnalysis[] = []
  let previousMade = chart.castOn
  for (let row = 1; row <= chart.height; row++) {
    const side = sideOf(chart.mode, row)
    const slots = slotsOf(chart, row)
    const empty = slots.every((s) => s.stitch === 'ns')
    if (empty) {
      rows.push({ row, side, empty, used: 0, made: 0, items: [], needed: previousMade, errors: [], text: '', segments: [] })
      continue
    }
    const items = itemsOf(chart, slots, side)
    const used = sum(items, (it) => it.uses)
    const made = sum(items, (it) => it.makes)
    const line = lineOf(labelOf(side, row), items, made)
    rows.push({ row, side, empty, used, made, items, needed: previousMade, errors: rowErrors(chart, row, side, slots, used, previousMade),
      text: line.text, segments: line.segments })
    previousMade = made
  }
  return { rows, warnings: colourWarnings(rows) }
}

function colourWarnings(rows: RowAnalysis[]): ColourWarning[] {
  const warnings: ColourWarning[] = []
  const { coloursPerRow, maxFloat } = config.limits
  for (const analysis of rows) {
    if (analysis.empty) continue
    const colours = [...new Set(analysis.items.map((it) => it.colour))].sort()
    if (colours.length > coloursPerRow) {
      warnings.push({ row: analysis.row, message: `Row ${analysis.row} uses ${colours.length} colours, the limit is ${coloursPerRow}.` })
    }
    for (const colour of colours) {
      let longest = 0
      let last = -1
      let gap = 0
      analysis.items.forEach((item, index) => {
        if (item.colour === colour) {
          if (last >= 0 && index > last + 1) longest = Math.max(longest, gap)
          last = index
          gap = 0
        } else {
          gap += item.cable ? item.cols.length : 1
        }
      })
      if (longest > maxFloat) {
        warnings.push({ row: analysis.row, message: `Row ${analysis.row}: float of ${longest} stitches in colour ${colour}.` })
      }
    }
  }
  return warnings
}

function rowState(analysis: RowAnalysis): RowState {
  return analysis.empty ? 'empty' : analysis.errors.length ? 'error' : 'ok'
}

export function textBlockOf(chart: ChartData, row: number): string | null {
  const box = repeatsOnRow(chart, row).sort((a, b) => a.id.localeCompare(b.id))[0]
  return box ? `Row ${row}: expand repeat ${box.id} before editing this row as text.` : null
}

export function toRows(chart: ChartData, analysis: Analysis, notes: (row: number) => number | null): Row[] {
  return analysis.rows.map((a) => ({
    row: a.row, side: a.side, used: a.used, made: a.made, state: rowState(a), errors: a.errors, text: a.text,
    notes: notes(a.row) ?? 0, segments: a.segments, textBlock: textBlockOf(chart, a.row),
  }))
}

/** What the top non-empty row makes. */
export function stitchesOf(analysis: Analysis): number {
  for (let r = analysis.rows.length - 1; r >= 0; r--) {
    if (!analysis.rows[r].empty) return analysis.rows[r].made
  }
  return 0
}

export function errorCount(analysis: Analysis): number {
  return analysis.rows.reduce((total, r) => total + r.errors.length, 0)
}

export function nextRepeatId(repeats: Repeat[]): string {
  const taken = new Set(repeats.map((r) => r.id))
  for (let code = 65; code < 91; code++) {
    const id = String.fromCharCode(code)
    if (!taken.has(id)) return id
  }
  return String(repeats.length + 1)
}

/** Reverses each selected row inside the selection, swapping the mirrored partners; colours travel with their cells. */
export function mirrored(chart: ChartData, fromRow: number, toRow: number, fromCol: number, toCol: number): { row: number; col: number; stitch: string; colour: string }[] {
  const out: { row: number; col: number; stitch: string; colour: string }[] = []
  for (let row = fromRow; row <= toRow; row++) {
    for (let col = fromCol; col <= toCol; col++) {
      const source = fromCol + toCol - col
      const stitch = chart.stitch[row - 1][source - 1]
      const swapped = symbolByKey(chart.craft, chart.terms, stitch)?.mirror ?? stitch
      out.push({ row, col, stitch: swapped, colour: chart.colour[row - 1][source - 1] })
    }
  }
  return out
}

export function touchesRepeat(chart: ChartData, fromRow: number, toRow: number, fromCol: number, toCol: number): boolean {
  return chart.repeats.some((b) => b.fromRow <= toRow && b.toRow >= fromRow && b.fromCol <= toCol && b.toCol >= fromCol)
}
