import type { Conflict, EditResult, LiveMessage, MirrorResult, Repeat, TextResult } from '../../shared/api.ts'
import { symbolByKey } from '../../shared/symbols.ts'
import { config } from '../config.ts'
import { countEdit, serial } from '../concurrency.ts'
import { type Db, one, pool, rows, transaction } from '../db.ts'
import { analyseChart, mirrored, nextRepeatId, textBlockOf, touchesRepeat } from '../domain/chart.ts'
import { addedColumns, collapseBox, expandBox, overlaps } from '../domain/structure.ts'
import { planText } from '../domain/text.ts'
import { type Ctx, conflict, invalid, notFound, route } from '../http.ts'
import { emit } from '../live.ts'
import { type Loaded, designerAccess, derive, loadChart, noteCounts, replaceChart, structureOf } from '../store.ts'
import { object } from './accounts.ts'
import { opOf, person } from './patterns.ts'

interface Change { row: number; col: number; stitch: string; colour: string; rev: number }

const integer = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value)

async function saveChanges(db: Db, patternId: string, userId: string, changes: Change[]): Promise<void> {
  if (!changes.length) return
  await db.query(
    `UPDATE cells SET stitch = t.s, colour = t.k, rev = t.v, by_user = $2
     FROM unnest($3::int[], $4::int[], $5::text[], $6::text[], $7::int[]) AS t(r, c, s, k, v)
     WHERE cells.pattern_id = $1 AND cells.row = t.r AND cells.col = t.c`,
    [patternId, userId, changes.map((c) => c.row), changes.map((c) => c.col), changes.map((c) => c.stitch),
      changes.map((c) => c.colour), changes.map((c) => c.rev)])
}

/** One change of a pattern at a time, in arrival order: lock, work, commit, then tell the other designers. */
async function ordered<T>(patternId: string, work: (db: Db) => Promise<{ result: T; event: LiveMessage | null }>): Promise<T> {
  return serial(patternId, async () => {
    const { result, event } = await transaction(async (db) => {
      await db.query('SELECT 1 FROM patterns WHERE id = $1 FOR UPDATE', [patternId])
      return work(db)
    })
    if (event) await emit(patternId, ['designers'], event)
    return result
  })
}

async function userNames(db: Db, ids: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))]
  const found = wanted.length ? await rows<{ id: string; name: string }>(db, 'SELECT id, name FROM users WHERE id = ANY($1::uuid[])', [wanted]) : []
  return new Map(found.map((u) => [u.id, u.name]))
}

function derived(loaded: Loaded, notes: Map<number, number>) {
  const { rows: derivedRows, colourWarnings } = derive(loaded.chart, notes)
  return { rows: derivedRows, colourWarnings }
}

function readCells(body: Record<string, unknown>, loaded: Loaded): { row: number; col: number; stitch: string; colour: string; rev: number }[] {
  const { chart } = loaded
  if (!Array.isArray(body.cells)) throw invalid('cells', 'cells must be a list.')
  const letters = new Set(chart.colours.map((c) => c.letter))
  return body.cells.map((raw) => {
    const cell = object(raw)
    if (!integer(cell.row) || !integer(cell.col) || cell.row < 1 || cell.row > chart.height || cell.col < 1 || cell.col > chart.width) {
      throw invalid('cells', 'A cell is off the chart.')
    }
    if (typeof cell.stitch !== 'string' || !symbolByKey(chart.craft, chart.terms, cell.stitch)) throw invalid('cells', 'A stitch is not in this craft.')
    if (typeof cell.colour !== 'string' || !letters.has(cell.colour)) throw invalid('cells', 'A colour is not in the key.')
    if (!integer(cell.rev) || cell.rev < 0) throw invalid('cells', 'A revision must be a whole number.')
    return { row: cell.row, col: cell.col, stitch: cell.stitch, colour: cell.colour, rev: cell.rev }
  })
}

async function replayed(userId: string, op: unknown): Promise<unknown | undefined> {
  if (typeof op !== 'string' || !op) return undefined
  return (await one<{ response: unknown }>(pool, 'SELECT response FROM edit_ops WHERE user_id = $1 AND op_id = $2', [userId, op]))?.response
}

function requireOp(value: unknown): string {
  if (typeof value !== 'string' || !value) throw invalid('opId', 'opId must be a non-empty string.')
  return value
}

route('POST', '/api/patterns/:id/cells', 'user', async (ctx) => {
  const { pattern } = await designerAccess(pool, ctx.user.id, ctx.params.id)
  const body = object(ctx.body())
  const first = await replayed(ctx.user.id, body.opId)
  if (first !== undefined) return ctx.reply(200, first)
  countEdit(ctx.user.id)
  const op = requireOp(body.opId)
  const response = await ordered(pattern.id, async (db) => {
    const stored = await replayed(ctx.user.id, op)
    if (stored !== undefined) return { result: stored as EditResult, event: null }
    const loaded = await loadChart(db, pattern)
    const edits = readCells(body, loaded)
    const { chart } = loaded
    const changed: Change[] = []
    const applied: EditResult['applied'] = []
    const refused: { edit: (typeof edits)[number]; current: Change; by: string | null }[] = []
    for (const edit of edits) {
      const r = edit.row - 1
      const c = edit.col - 1
      const current = loaded.rev[r][c]
      const same = chart.stitch[r][c] === edit.stitch && chart.colour[r][c] === edit.colour
      if (same) applied.push({ row: edit.row, col: edit.col, rev: current })
      else if (edit.rev === current) {
        chart.stitch[r][c] = edit.stitch
        chart.colour[r][c] = edit.colour
        loaded.rev[r][c] = current + 1
        loaded.by[r][c] = ctx.user.id
        const change = { row: edit.row, col: edit.col, stitch: edit.stitch, colour: edit.colour, rev: current + 1 }
        changed.push(change)
        applied.push({ row: edit.row, col: edit.col, rev: change.rev })
      } else {
        refused.push({ edit, current: { row: edit.row, col: edit.col, stitch: chart.stitch[r][c], colour: chart.colour[r][c], rev: current },
          by: loaded.by[r][c] })
      }
    }
    await saveChanges(db, pattern.id, ctx.user.id, changed)
    const names = await userNames(db, [...refused.map((x) => x.by), pattern.owner_id])
    const conflicts: Conflict[] = refused.map((x) => ({ ...x.current, by: names.get(x.by ?? pattern.owner_id) ?? '' }))
    const out = derived(loaded, await noteCounts(db, pattern.id))
    const response: EditResult = { applied, conflicts, rows: out.rows, colourWarnings: out.colourWarnings }
    await db.query('INSERT INTO edit_ops (user_id, op_id, response) VALUES ($1, $2, $3)', [ctx.user.id, op, JSON.stringify(response)])
    const event: LiveMessage | null = changed.length
      ? { type: 'edit', by: person(ctx.user), op, cells: changed, rows: out.rows, colourWarnings: out.colourWarnings } : null
    return { result: response, event }
  })
  ctx.reply(200, response)
})

route('POST', '/api/patterns/:id/mirror', 'user', async (ctx) => {
  const { pattern } = await designerAccess(pool, ctx.user.id, ctx.params.id)
  const body = object(ctx.body())
  const first = await replayed(ctx.user.id, body.opId)
  if (first !== undefined) return ctx.reply(200, first)
  countEdit(ctx.user.id)
  const op = requireOp(body.opId)
  const response = await ordered(pattern.id, async (db) => {
    const stored = await replayed(ctx.user.id, op)
    if (stored !== undefined) return { result: stored as MirrorResult, event: null }
    const loaded = await loadChart(db, pattern)
    const { chart } = loaded
    const { fromRow, toRow, fromCol, toCol } = body
    if (!integer(fromRow) || !integer(toRow) || !integer(fromCol) || !integer(toCol) || fromRow < 1 || toRow > chart.height
      || fromCol < 1 || toCol > chart.width || fromRow > toRow || fromCol > toCol) {
      throw invalid('fromRow', 'The selection is off the chart.')
    }
    if (touchesRepeat(chart, fromRow, toRow, fromCol, toCol)) throw conflict('crosses_repeat', 'Mirror cannot cross a repeat box.')
    const changed: Change[] = []
    for (const cell of mirrored(chart, fromRow, toRow, fromCol, toCol)) {
      const r = cell.row - 1
      const c = cell.col - 1
      if (chart.stitch[r][c] === cell.stitch && chart.colour[r][c] === cell.colour) continue
      chart.stitch[r][c] = cell.stitch
      chart.colour[r][c] = cell.colour
      loaded.rev[r][c] += 1
      changed.push({ ...cell, rev: loaded.rev[r][c] })
    }
    await saveChanges(db, pattern.id, ctx.user.id, changed)
    const out = derived(loaded, await noteCounts(db, pattern.id))
    const result: MirrorResult = { applied: changed, conflicts: [], rows: out.rows, colourWarnings: out.colourWarnings }
    await db.query('INSERT INTO edit_ops (user_id, op_id, response) VALUES ($1, $2, $3)', [ctx.user.id, op, JSON.stringify(result)])
    const event: LiveMessage | null = changed.length
      ? { type: 'edit', by: person(ctx.user), op, cells: changed, rows: out.rows, colourWarnings: out.colourWarnings } : null
    return { result, event }
  })
  ctx.reply(200, response)
})

route('POST', '/api/patterns/:id/text', 'user', async (ctx) => {
  const { pattern } = await designerAccess(pool, ctx.user.id, ctx.params.id)
  const body = object(ctx.body())
  countEdit(ctx.user.id)
  const response = await ordered(pattern.id, async (db) => {
    const loaded = await loadChart(db, pattern)
    const { chart } = loaded
    const row = body.row
    if (!integer(row) || row < 1 || row > chart.height) throw invalid('row', 'That row is not on the chart.')
    if (typeof body.text !== 'string') throw invalid('text', 'text must be a string.', null)
    const block = textBlockOf(chart, row)
    if (block) throw invalid('text', block, null)
    const analysis = analyseChart(chart)
    const plan = planText(chart, analysis, row, body.text, analysis.rows[row - 1].side)
    if ('failure' in plan) throw invalid('text', plan.failure.message, plan.failure.position)
    const changed: Change[] = []
    plan.cells.forEach((cell, i) => {
      if (chart.stitch[row - 1][i] === cell.stitch && chart.colour[row - 1][i] === cell.colour) return
      chart.stitch[row - 1][i] = cell.stitch
      chart.colour[row - 1][i] = cell.colour
      loaded.rev[row - 1][i] += 1
      loaded.by[row - 1][i] = ctx.user.id
      changed.push({ row, col: i + 1, stitch: cell.stitch, colour: cell.colour, rev: loaded.rev[row - 1][i] })
    })
    await saveChanges(db, pattern.id, ctx.user.id, changed)
    const out = derived(loaded, await noteCounts(db, pattern.id))
    const event: LiveMessage | null = changed.length
      ? { type: 'edit', by: person(ctx.user), op: opOf(ctx), cells: changed, rows: out.rows, colourWarnings: out.colourWarnings } : null
    return { result: { changed: changed.length, cells: changed, rows: out.rows, colourWarnings: out.colourWarnings } satisfies TextResult, event }
  })
  ctx.reply(200, response)
})

const TIMES_MESSAGE = 'Times must be from 2 to 20.'

function readTimes(value: unknown): number {
  if (!integer(value) || value < 2 || value > 20) throw invalid('times', TIMES_MESSAGE)
  return value
}

/** Runs a change of the whole chart (boxes, expansion) in order, saves it and tells the other designers. */
async function restructure(ctx: Ctx, work: (loaded: Loaded) => { chart: Loaded['chart']; rev: number[][] }, status = 200,
  extra: (chart: Loaded['chart']) => Record<string, unknown> = () => ({})): Promise<void> {
  const { pattern } = await designerAccess(pool, ctx.user.id, ctx.params.id)
  const result = await ordered(pattern.id, async (db) => {
    const loaded = await loadChart(db, pattern)
    const next = work(loaded)
    await replaceChart(db, pattern.id, next.chart, next.rev, ctx.user.id)
    const structure = structureOf(next.chart, next.rev, derive(next.chart, await noteCounts(db, pattern.id)))
    return { result: { ...structure, ...extra(next.chart) },
      event: { type: 'structure', by: person(ctx.user), op: opOf(ctx), restored: false, structure } satisfies LiveMessage }
  })
  ctx.reply(status, result)
}

route('POST', '/api/patterns/:id/repeats', 'user', async (ctx) => {
  let created: Repeat | null = null
  await restructure(ctx, (loaded) => {
    const body = object(ctx.body())
    const { chart } = loaded
    const { fromCol, toCol, fromRow, toRow } = body
    if (!integer(fromCol) || !integer(toCol) || !integer(fromRow) || !integer(toRow) || fromCol < 1 || toCol > chart.width
      || fromRow < 1 || toRow > chart.height || fromCol > toCol || fromRow > toRow) {
      throw invalid('fromCol', 'The box is off the chart.')
    }
    const times = body.times === undefined ? 2 : readTimes(body.times)
    const box: Repeat = { id: typeof body.id === 'string' && /^[A-Z]$/.test(body.id) ? body.id : nextRepeatId(chart.repeats), fromCol, toCol, fromRow, toRow, times }
    if (chart.repeats.some((b) => b.id === box.id || overlaps(b, box))) throw conflict('overlap', 'Repeat boxes cannot overlap.')
    created = box
    return { chart: { ...chart, repeats: [...chart.repeats, box].sort((a, b) => a.id.localeCompare(b.id)) }, rev: loaded.rev }
  }, 201, () => ({ id: created!.id, times: created!.times }))
})

route('PATCH', '/api/patterns/:id/repeats/:rid', 'user', async (ctx) => {
  const { pattern } = await designerAccess(pool, ctx.user.id, ctx.params.id)
  const body = object(ctx.body())
  const response = await ordered(pattern.id, async (db) => {
    const loaded = await loadChart(db, pattern)
    const box = loaded.chart.repeats.find((b) => b.id === ctx.params.rid)
    if (!box) throw notFound()
    box.times = readTimes(body.times)
    await db.query('UPDATE repeats SET times = $3 WHERE pattern_id = $1 AND id = $2', [pattern.id, box.id, box.times])
    const out = derived(loaded, await noteCounts(db, pattern.id))
    const result = { rows: out.rows, repeats: loaded.chart.repeats, colourWarnings: out.colourWarnings }
    return { result, event: { type: 'times', by: person(ctx.user), op: opOf(ctx), ...result } satisfies LiveMessage }
  })
  ctx.reply(200, response)
})

route('DELETE', '/api/patterns/:id/repeats/:rid', 'user', async (ctx) => {
  await restructure(ctx, (loaded) => {
    if (!loaded.chart.repeats.some((b) => b.id === ctx.params.rid)) throw notFound()
    return { chart: { ...loaded.chart, repeats: loaded.chart.repeats.filter((b) => b.id !== ctx.params.rid) }, rev: loaded.rev }
  })
})

route('POST', '/api/patterns/:id/repeats/:rid/expand', 'user', async (ctx) => {
  let added = 0
  await restructure(ctx, (loaded) => {
    const box = loaded.chart.repeats.find((b) => b.id === ctx.params.rid)
    if (!box) throw notFound()
    added = addedColumns(box)
    if (loaded.chart.width + added > config.limits.maxChartCols) {
      throw conflict('too_wide', `That is wider than the ${config.limits.maxChartCols} column limit.`)
    }
    return expandBox(loaded, box)
  }, 200, (chart) => ({ added, width: chart.width }))
})

route('POST', '/api/patterns/:id/repeats/undo-expand', 'user', async (ctx) => {
  await restructure(ctx, (loaded) => {
    const body = object(ctx.body())
    const { id, fromCol, toCol, fromRow, toRow } = body
    const times = readTimes(body.times)
    if (typeof id !== 'string' || !/^[A-Z]$/.test(id) || !integer(fromCol) || !integer(toCol) || !integer(fromRow) || !integer(toRow)
      || fromCol < 1 || fromRow < 1 || toRow > loaded.chart.height || fromCol > toCol || fromRow > toRow) {
      throw invalid('id', 'The box is not valid.')
    }
    const box: Repeat = { id, fromCol, toCol, fromRow, toRow, times }
    if (toCol + addedColumns(box) > loaded.chart.width) throw invalid('toCol', 'The box does not fit the chart.')
    if (loaded.chart.repeats.some((b) => b.id === id)) throw conflict('overlap', 'Repeat boxes cannot overlap.')
    return collapseBox(loaded, box)
  }, 200, (chart) => ({ width: chart.width }))
})

