import type { Cell, Colour, ColourWarning, Repeat, Role, Row, Structure } from '../shared/api.ts'
import type { Craft, Mode, Terms } from '../shared/symbols.ts'
import { type Db, one, rows } from './db.ts'
import { type Analysis, type ChartData, analyseChart, blankGrid, toRows } from './domain/chart.ts'
import { notFound } from './http.ts'

export interface PatternRow {
  id: string
  owner_id: string
  name: string
  craft: Craft
  mode: Mode
  terms: Terms | null
  cast_on: number
  width: number
  height: number
  published_version: number | null
}

export interface Loaded {
  pattern: PatternRow
  chart: ChartData
  rev: number[][]
  by: (string | null)[][]
}

interface Snapshot {
  castOn: number
  width: number
  height: number
  colours: Colour[]
  repeats: Repeat[]
  grid: { s: string[][]; c: string[][] }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isId = (value: string): boolean => UUID.test(value)

export async function accessOf(db: Db, userId: string, patternId: string): Promise<{ pattern: PatternRow; role: Role } | null> {
  if (!isId(patternId)) return null
  const pattern = await one<PatternRow>(db, 'SELECT * FROM patterns WHERE id = $1', [patternId])
  if (!pattern) return null
  if (pattern.owner_id === userId) return { pattern, role: 'owner' }
  if (await one(db, 'SELECT 1 FROM co_designers WHERE pattern_id = $1 AND user_id = $2', [patternId, userId])) {
    return { pattern, role: 'co-designer' }
  }
  if (await one(db, 'SELECT 1 FROM testers WHERE pattern_id = $1 AND user_id = $2', [patternId, userId])) {
    return { pattern, role: 'tester' }
  }
  return null
}

export async function designerAccess(db: Db, userId: string, patternId: string): Promise<{ pattern: PatternRow; role: Role }> {
  const access = await accessOf(db, userId, patternId)
  if (!access || access.role === 'tester') throw notFound()
  return access
}

export async function testerAccess(db: Db, userId: string, patternId: string): Promise<PatternRow> {
  const access = await accessOf(db, userId, patternId)
  if (!access || access.role !== 'tester') throw notFound()
  return access.pattern
}

/** Reads the chart with the pattern row as it is now, so a width or height changed since access was checked is honoured. */
export async function loadChart(db: Db, known: PatternRow): Promise<Loaded> {
  const pattern = (await one<PatternRow>(db, 'SELECT * FROM patterns WHERE id = $1', [known.id]))!
  const cells = await rows<{ row: number; col: number; stitch: string; colour: string; rev: number; by_user: string | null }>(db,
    'SELECT row, col, stitch, colour, rev, by_user FROM cells WHERE pattern_id = $1', [pattern.id])
  const colours = await rows<Colour>(db, 'SELECT letter, name, hex FROM pattern_colours WHERE pattern_id = $1 ORDER BY letter', [pattern.id])
  const repeats = await rows<{ id: string; from_col: number; to_col: number; from_row: number; to_row: number; times: number }>(db,
    'SELECT id, from_col, to_col, from_row, to_row, times FROM repeats WHERE pattern_id = $1 ORDER BY id', [pattern.id])
  const chart: ChartData = {
    craft: pattern.craft, mode: pattern.mode, terms: pattern.terms, castOn: pattern.cast_on,
    width: pattern.width, height: pattern.height, colours,
    repeats: repeats.map((r) => ({ id: r.id, fromCol: r.from_col, toCol: r.to_col, fromRow: r.from_row, toRow: r.to_row, times: r.times })),
    stitch: blankGrid(pattern.height, pattern.width, 'ns'), colour: blankGrid(pattern.height, pattern.width, 'A'),
  }
  const rev = blankGrid(pattern.height, pattern.width, 0)
  const by = blankGrid<string | null>(pattern.height, pattern.width, null)
  for (const c of cells) {
    chart.stitch[c.row - 1][c.col - 1] = c.stitch
    chart.colour[c.row - 1][c.col - 1] = c.colour
    rev[c.row - 1][c.col - 1] = c.rev
    by[c.row - 1][c.col - 1] = c.by_user
  }
  return { pattern, chart, rev, by }
}

function chartOfSnapshot(pattern: PatternRow, snapshot: Snapshot): ChartData {
  return {
    craft: pattern.craft, mode: pattern.mode, terms: pattern.terms, castOn: snapshot.castOn,
    width: snapshot.width, height: snapshot.height, colours: snapshot.colours, repeats: snapshot.repeats,
    stitch: snapshot.grid.s, colour: snapshot.grid.c,
  }
}

function snapshotOf(chart: ChartData): Snapshot {
  return {
    castOn: chart.castOn, width: chart.width, height: chart.height, colours: chart.colours, repeats: chart.repeats,
    grid: { s: chart.stitch, c: chart.colour },
  }
}

export async function loadSnapshot(db: Db, pattern: PatternRow, version: number): Promise<ChartData | null> {
  const found = await one<{ cast_on: number; width: number; height: number; colours: Colour[]; repeats: Repeat[]; grid: Snapshot['grid'] }>(db,
    'SELECT cast_on, width, height, colours, repeats, grid FROM versions WHERE pattern_id = $1 AND version = $2', [pattern.id, version])
  if (!found) return null
  return chartOfSnapshot(pattern, { castOn: found.cast_on, width: found.width, height: found.height,
    colours: found.colours, repeats: found.repeats, grid: found.grid })
}

export async function latestVersion(db: Db, patternId: string): Promise<number> {
  return (await one<{ latest: number }>(db, 'SELECT COALESCE(MAX(version), 0)::int AS latest FROM versions WHERE pattern_id = $1', [patternId]))!.latest
}

export function cellsOf(chart: ChartData, rev: number[][]): Cell[] {
  const cells: Cell[] = []
  for (let r = 1; r <= chart.height; r++) {
    for (let c = 1; c <= chart.width; c++) {
      const box = chart.repeats.find((b) => b.fromRow <= r && r <= b.toRow && b.fromCol <= c && c <= b.toCol)
      cells.push({ row: r, col: c, stitch: chart.stitch[r - 1][c - 1], colour: chart.colour[r - 1][c - 1],
        repeat: box ? box.id : '', rev: rev[r - 1][c - 1] })
    }
  }
  return cells
}

export async function noteCounts(db: Db, patternId: string, only?: { userId: string; version: number }): Promise<Map<number, number>> {
  const found = only
    ? await rows<{ row: number; n: number }>(db,
      'SELECT row, count(*)::int AS n FROM notes WHERE pattern_id = $1 AND user_id = $2 AND version = $3 GROUP BY row',
      [patternId, only.userId, only.version])
    : await rows<{ row: number; n: number }>(db, 'SELECT row, count(*)::int AS n FROM notes WHERE pattern_id = $1 GROUP BY row', [patternId])
  return new Map(found.map((f) => [f.row, f.n]))
}

interface Derived { analysis: Analysis; rows: Row[]; colourWarnings: ColourWarning[] }

export function derive(chart: ChartData, notes: Map<number, number> = new Map()): Derived {
  const analysis = analyseChart(chart)
  return { analysis, rows: toRows(chart, analysis, (row) => notes.get(row) ?? 0), colourWarnings: analysis.warnings }
}

export function structureOf(chart: ChartData, rev: number[][], derived: Derived): Structure {
  return {
    width: chart.width, height: chart.height, castOn: chart.castOn, colours: chart.colours, repeats: chart.repeats,
    cells: cellsOf(chart, rev), rows: derived.rows, colourWarnings: derived.colourWarnings,
  }
}

/** Rewrites every cell and repeat box of a pattern from the chart (used by expansion and restore). */
export async function replaceChart(db: Db, patternId: string, chart: ChartData, rev: number[][], by: string | null): Promise<void> {
  const rs: number[] = []
  const cs: number[] = []
  const ss: string[] = []
  const ks: string[] = []
  const vs: number[] = []
  for (let r = 1; r <= chart.height; r++) {
    for (let c = 1; c <= chart.width; c++) {
      rs.push(r); cs.push(c); ss.push(chart.stitch[r - 1][c - 1]); ks.push(chart.colour[r - 1][c - 1]); vs.push(rev[r - 1][c - 1])
    }
  }
  await db.query('DELETE FROM cells WHERE pattern_id = $1', [patternId])
  await db.query(
    `INSERT INTO cells (pattern_id, row, col, stitch, colour, rev, by_user)
     SELECT $1, r, c, s, k, v, $7 FROM unnest($2::int[], $3::int[], $4::text[], $5::text[], $6::int[]) AS t(r, c, s, k, v)`,
    [patternId, rs, cs, ss, ks, vs, by])
  await db.query('DELETE FROM repeats WHERE pattern_id = $1', [patternId])
  if (chart.repeats.length) {
    await db.query(
      `INSERT INTO repeats (pattern_id, id, from_col, to_col, from_row, to_row, times)
       SELECT $1, i, a, b, c, d, t FROM unnest($2::text[], $3::int[], $4::int[], $5::int[], $6::int[], $7::int[]) AS x(i, a, b, c, d, t)`,
      [patternId, chart.repeats.map((r) => r.id), chart.repeats.map((r) => r.fromCol), chart.repeats.map((r) => r.toCol),
        chart.repeats.map((r) => r.fromRow), chart.repeats.map((r) => r.toRow), chart.repeats.map((r) => r.times)])
  }
  await db.query('UPDATE patterns SET width = $2, height = $3, cast_on = $4 WHERE id = $1',
    [patternId, chart.width, chart.height, chart.castOn])
}

export async function setColours(db: Db, patternId: string, colours: Colour[]): Promise<void> {
  await db.query('DELETE FROM pattern_colours WHERE pattern_id = $1', [patternId])
  if (colours.length) {
    await db.query(
      `INSERT INTO pattern_colours (pattern_id, letter, name, hex)
       SELECT $1, l, n, h FROM unnest($2::text[], $3::text[], $4::text[]) AS t(l, n, h)`,
      [patternId, colours.map((c) => c.letter), colours.map((c) => c.name), colours.map((c) => c.hex)])
  }
}

export async function saveVersion(db: Db, patternId: string, chart: ChartData, note: string, savedOn: string): Promise<number> {
  const version = (await latestVersion(db, patternId)) + 1
  const snap = snapshotOf(chart)
  await db.query(
    `INSERT INTO versions (pattern_id, version, note, saved_on, cast_on, width, height, colours, repeats, grid)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [patternId, version, note, savedOn, snap.castOn, snap.width, snap.height, JSON.stringify(snap.colours),
      JSON.stringify(snap.repeats), JSON.stringify(snap.grid)])
  return version
}
