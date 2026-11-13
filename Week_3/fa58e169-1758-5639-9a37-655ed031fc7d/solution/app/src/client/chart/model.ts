import type { Cell, ChartShape, Colour, ColourWarning, Repeat, Row, Structure } from '../../shared/api.ts'
import type { Craft, Mode, Terms } from '../../shared/symbols.ts'

export interface CellState { stitch: string; colour: string; rev: number; repeat: string }

export interface ChartModel {
  craft: Craft
  mode: Mode
  terms: Terms | null
  castOn: number
  width: number
  height: number
  colours: Colour[]
  repeats: Repeat[]
  grid: CellState[][]
  rows: Row[]
  warnings: ColourWarning[]
}

export interface Change { row: number; col: number; stitch: string; colour: string; rev: number }

function gridOf(width: number, height: number, cells: Cell[]): CellState[][] {
  const grid: CellState[][] = Array.from({ length: height }, () => new Array<CellState>(width))
  for (const c of cells) grid[c.row - 1][c.col - 1] = { stitch: c.stitch, colour: c.colour, rev: c.rev, repeat: c.repeat }
  return grid
}

export function modelOf(shape: Omit<ChartShape, 'rows'> & { rows: Row[] }, warnings: ColourWarning[] = []): ChartModel {
  return {
    craft: shape.craft, mode: shape.mode, terms: shape.terms, castOn: shape.castOn, width: shape.width, height: shape.height,
    colours: shape.colours, repeats: shape.repeats, grid: gridOf(shape.width, shape.height, shape.cells), rows: shape.rows, warnings,
  }
}

function sameRow(a: Row, b: Row): boolean {
  return a.text === b.text && a.used === b.used && a.made === b.made && a.state === b.state && a.notes === b.notes
    && a.textBlock === b.textBlock && a.errors.join('|') === b.errors.join('|')
}

/** Keeps the old object for every row that did not change so unchanged rows are not redrawn. */
export function reuseRows(old: Row[], next: Row[]): Row[] {
  return next.map((row, i) => (old[i] && sameRow(old[i], row) ? old[i] : row))
}

export function withStructure(model: ChartModel, s: Structure): ChartModel {
  return { ...model, width: s.width, height: s.height, castOn: s.castOn, colours: s.colours, repeats: s.repeats,
    grid: gridOf(s.width, s.height, s.cells), rows: reuseRows(model.rows, s.rows), warnings: s.colourWarnings }
}

/** Applies cell changes (a change older than the held revision is ignored) and says which cells really changed. */
export function withChanges(model: ChartModel, changes: Change[], rows?: Row[], warnings?: ColourWarning[]):
  { model: ChartModel; changed: { row: number; col: number }[] } {
  const grid = model.grid.slice()
  const copied = new Set<number>()
  const changed: { row: number; col: number }[] = []
  for (const c of changes) {
    const held = grid[c.row - 1]?.[c.col - 1]
    if (!held || c.rev < held.rev) continue
    if (!copied.has(c.row)) { grid[c.row - 1] = grid[c.row - 1].slice(); copied.add(c.row) }
    if (held.stitch !== c.stitch || held.colour !== c.colour) changed.push({ row: c.row, col: c.col })
    grid[c.row - 1][c.col - 1] = { ...held, stitch: c.stitch, colour: c.colour, rev: c.rev }
  }
  return { model: { ...model, grid, rows: rows ? reuseRows(model.rows, rows) : model.rows, warnings: warnings ?? model.warnings }, changed }
}

/** New errors first in row order, then rows whose last error cleared; empty when no row's errors changed. */
export function checkAnnouncement(before: Row[], after: Row[]): string {
  const fresh: string[] = []
  const cleared: string[] = []
  after.forEach((row, i) => {
    const old = before[i]?.errors ?? []
    fresh.push(...row.errors.filter((e) => !old.includes(e)))
    if (old.length && !row.errors.length) cleared.push(`Row ${row.row} is correct.`)
  })
  return [...fresh, ...cleared].join(' ')
}

export function labelOf(row: number, col: number, name: string, colour: string, repeat: string): string {
  return `Row ${row}, column ${col}: ${name}, colour ${colour}${repeat ? `, repeat ${repeat}` : ''}`
}
