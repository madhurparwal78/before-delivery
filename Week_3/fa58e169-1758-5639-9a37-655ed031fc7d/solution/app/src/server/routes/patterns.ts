import type { Colour, DesignerPattern, PublicPattern, PublicRow, Row, TesterEntry, VersionEntry } from '../../shared/api.ts'
import { CHART_KINDS, COLOUR_LETTERS, DEFAULT_YARNS, SAMPLE_ROWS } from '../../shared/symbols.ts'
import { config, today } from '../config.ts'
import { one, pool, rows, transaction } from '../db.ts'
import { type ChartData, analyseChart, blankGrid, errorCount, stitchesOf } from '../domain/chart.ts'
import { compareCharts } from '../domain/compare.ts'
import { conflict, invalid, notFound, route } from '../http.ts'
import { emit } from '../live.ts'
import { buildSheet } from '../pdf.ts'
import { type PatternRow, accessOf, cellsOf, derive, designerAccess, isId, latestVersion, loadChart, loadSnapshot,
  noteCounts, replaceChart, saveVersion, setColours, structureOf } from '../store.ts'
import { checkEmail, object, text } from './accounts.ts'

const NAME_LIMIT = 120
const NOTE_LIMIT = 200
/** The largest whole number the database column holds. */
const MAX_CAST_ON = 2_147_483_647

export const person = (user: { id: string; name: string }) => ({ id: user.id, name: user.name })
export const opOf = (ctx: { req: { headers: Record<string, string | string[] | undefined> } }): string | null => {
  const op = ctx.req.headers['x-op-id']
  return typeof op === 'string' ? op : null
}

export async function testerEntries(patternId: string): Promise<TesterEntry[]> {
  return rows<TesterEntry>(pool,
    `SELECT u.id, u.name, t.version, t.row,
            (SELECT count(*)::int FROM notes n WHERE n.pattern_id = t.pattern_id AND n.user_id = t.user_id) AS notes
     FROM testers t JOIN users u ON u.id = t.user_id WHERE t.pattern_id = $1 ORDER BY u.name, u.id`, [patternId])
}

async function designerPayload(pattern: PatternRow, role: DesignerPattern['role']): Promise<DesignerPattern> {
  const loaded = await loadChart(pool, pattern)
  const derived = derive(loaded.chart, await noteCounts(pool, pattern.id))
  const { chart } = loaded
  return {
    id: pattern.id, name: pattern.name, craft: chart.craft, mode: chart.mode, terms: chart.terms, castOn: chart.castOn,
    width: chart.width, height: chart.height, colours: chart.colours, repeats: chart.repeats, cells: cellsOf(chart, loaded.rev),
    rows: derived.rows, colourWarnings: derived.colourWarnings, version: await latestVersion(pool, pattern.id),
    state: pattern.published_version === null ? 'draft' : 'published', role, testers: await testerEntries(pattern.id),
  }
}

/** A version number from a path or query: whole digits that fit the database's integer, or null. */
function versionNumber(raw: string | null): number | null {
  return raw !== null && /^\d{1,9}$/.test(raw) ? Number(raw) : null
}

function checkNote(value: unknown): string {
  if (value !== undefined && value !== null && typeof value !== 'string') throw invalid('note', `A version note is text of ${NOTE_LIMIT} characters at most.`)
  const note = value ?? ''
  if ([...note].length > NOTE_LIMIT) throw invalid('note', `A version note can be ${NOTE_LIMIT} characters at most.`)
  return note
}

function validCount(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max
}

async function createPattern(userId: string, input: {
  name: string; kind: (typeof CHART_KINDS)[number]; rows: number; columns: number; castOn: number; sampleRows?: Record<string, string>
}): Promise<string> {
  return transaction(async (db) => {
    const { kind } = input
    const id = (await db.query(
      `INSERT INTO patterns (owner_id, name, craft, mode, terms, cast_on, width, height)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [userId, input.name, kind.craft, kind.mode, kind.terms, input.castOn, input.columns, input.rows])).rows[0].id as string
    const colours: Colour[] = kind.colourNames.map((name, i) => ({ letter: COLOUR_LETTERS[i], name, hex: DEFAULT_YARNS[name] }))
    await setColours(db, id, colours)
    const chart: ChartData = {
      craft: kind.craft, mode: kind.mode, terms: kind.terms, castOn: input.castOn, width: input.columns, height: input.rows, colours,
      repeats: [], stitch: blankGrid(input.rows, input.columns, 'ns'), colour: blankGrid(input.rows, input.columns, 'A'),
    }
    for (const [row, line] of Object.entries(input.sampleRows ?? {})) chart.stitch[Number(row) - 1] = line.split(' ')
    await replaceChart(db, id, chart, blankGrid(input.rows, input.columns, 0), userId)
    return id
  })
}

route('GET', '/api/health', 'public', (ctx) => ctx.reply(200, { status: 'ok' }))

route('GET', '/api/config', 'public', (ctx) => {
  ctx.reply(200, { today: today(), timeZone: config.timeZone, limits: config.limits })
})

route('GET', '/api/patterns', 'user', async (ctx) => {
  const found = await rows<{ id: string; name: string; published_version: number | null; role: string }>(pool,
    `SELECT p.id, p.name, p.published_version,
            CASE WHEN p.owner_id = $1 THEN 'owner' WHEN c.user_id IS NOT NULL THEN 'co-designer' ELSE 'tester' END AS role
     FROM patterns p
     LEFT JOIN co_designers c ON c.pattern_id = p.id AND c.user_id = $1
     LEFT JOIN testers t ON t.pattern_id = p.id AND t.user_id = $1
     WHERE p.owner_id = $1 OR c.user_id IS NOT NULL OR t.user_id IS NOT NULL
     ORDER BY p.created_at DESC, p.id`, [ctx.user.id])
  ctx.reply(200, { patterns: found.map((p) => ({ id: p.id, name: p.name, state: p.published_version === null ? 'draft' : 'published', role: p.role })) })
})

route('POST', '/api/patterns', 'user', async (ctx) => {
  const body = object(ctx.body())
  if (body.sample === true) {
    const id = await createPattern(ctx.user.id, { name: 'Sample swatch', kind: CHART_KINDS[0], rows: 7, columns: 12, castOn: 12, sampleRows: SAMPLE_ROWS })
    return ctx.reply(201, { id })
  }
  const name = text(body.name).trim()
  if (!name) throw invalid('name', 'Give the pattern a name.')
  if ([...name].length > NAME_LIMIT) throw invalid('name', `A pattern name can be ${NAME_LIMIT} characters at most.`)
  const kind = CHART_KINDS.find((k) => k.label === body.kind)
  if (!kind) throw invalid('kind', 'Choose a chart kind.')
  const { maxChartRows, maxChartCols } = config.limits
  if (!validCount(body.rows, maxChartRows)) throw invalid('rows', `Rows must be from 1 to ${maxChartRows}.`)
  if (!validCount(body.columns, maxChartCols)) throw invalid('columns', `Columns must be from 1 to ${maxChartCols}.`)
  if (typeof body.castOn !== 'number' || !Number.isInteger(body.castOn) || body.castOn < 1) throw invalid('castOn', 'Cast on must be at least 1.')
  if (body.castOn > MAX_CAST_ON) throw invalid('castOn', `Cast on can be ${MAX_CAST_ON} at most.`)
  ctx.reply(201, { id: await createPattern(ctx.user.id, { name, kind, rows: body.rows, columns: body.columns, castOn: body.castOn }) })
})

route('GET', '/api/patterns/:id', 'user', async (ctx) => {
  const { pattern, role } = await designerAccess(pool, ctx.user.id, ctx.params.id)
  ctx.reply(200, await designerPayload(pattern, role))
})

route('POST', '/api/patterns/:id/colours', 'user', async (ctx) => {
  const { pattern } = await designerAccess(pool, ctx.user.id, ctx.params.id)
  const body = object(ctx.body())
  const name = text(body.name).trim()
  if (!name) throw invalid('name', 'Enter a colour name.')
  const hex = text(body.hex)
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw invalid('hex', 'Enter a colour as # and six hex digits.')
  const letter = await transaction(async (db) => {
    await db.query('SELECT 1 FROM patterns WHERE id = $1 FOR UPDATE', [pattern.id])
    const existing = await rows<Colour>(db, 'SELECT letter, name, hex FROM pattern_colours WHERE pattern_id = $1 ORDER BY letter', [pattern.id])
    if (existing.length >= config.limits.maxColours) {
      throw conflict('too_many_colours', `A pattern can have ${config.limits.maxColours} colours.`)
    }
    const next = COLOUR_LETTERS[existing.length]
    await db.query('INSERT INTO pattern_colours (pattern_id, letter, name, hex) VALUES ($1, $2, $3, $4)', [pattern.id, next, name, hex.toLowerCase()])
    return next
  })
  const colours = await rows<Colour>(pool, 'SELECT letter, name, hex FROM pattern_colours WHERE pattern_id = $1 ORDER BY letter', [pattern.id])
  void emit(pattern.id, ['designers'], { type: 'colours', op: opOf(ctx), colours })
  ctx.reply(201, { letter })
})

route('POST', '/api/patterns/:id/co-designers', 'user', async (ctx) => {
  const { pattern, role } = await designerAccess(pool, ctx.user.id, ctx.params.id)
  if (role !== 'owner') throw notFound()
  const email = checkEmail(object(ctx.body()).email)
  const found = await one<{ id: string; name: string }>(pool, 'SELECT id, name FROM users WHERE email = $1', [email])
  if (!found) throw invalid('email', 'No Twinrow account has that email.')
  if (found.id !== pattern.owner_id) {
    await pool.query('INSERT INTO co_designers (pattern_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [pattern.id, found.id])
  }
  ctx.reply(200, { id: found.id, name: found.name })
})

async function versionEntries(pattern: PatternRow): Promise<VersionEntry[]> {
  const found = await rows<{ version: number; note: string; saved_on: string }>(pool,
    'SELECT version, note, saved_on FROM versions WHERE pattern_id = $1 ORDER BY version', [pattern.id])
  const entries: VersionEntry[] = []
  for (const v of found) {
    const chart = await loadSnapshot(pool, pattern, v.version)
    entries.push({ version: v.version, note: v.note, savedOn: v.saved_on, stitches: stitchesOf(analyseChart(chart!)) })
  }
  return entries
}

route('GET', '/api/patterns/:id/versions', 'user', async (ctx) => {
  const { pattern } = await designerAccess(pool, ctx.user.id, ctx.params.id)
  ctx.reply(200, { versions: await versionEntries(pattern) })
})

route('POST', '/api/patterns/:id/versions', 'user', async (ctx) => {
  const { pattern } = await designerAccess(pool, ctx.user.id, ctx.params.id)
  const note = checkNote(object(ctx.body()).note)
  const version = await transaction(async (db) => {
    await db.query('SELECT 1 FROM patterns WHERE id = $1 FOR UPDATE', [pattern.id])
    return saveVersion(db, pattern.id, (await loadChart(db, pattern)).chart, note, today())
  })
  const entry = (await versionEntries(pattern)).find((v) => v.version === version)!
  void emit(pattern.id, ['designers', 'testers'], { type: 'versions', entry, latest: version })
  ctx.reply(201, { version })
})

function versionPayload(chart: ChartData, version: number, note: string, savedOn: string) {
  const derived = derive(chart)
  return { version, note, savedOn, castOn: chart.castOn, width: chart.width, height: chart.height, colours: chart.colours,
    repeats: chart.repeats, cells: cellsOf(chart, blankGrid(chart.height, chart.width, 0)), rows: derived.rows }
}

route('GET', '/api/patterns/:id/versions/:n', 'user', async (ctx) => {
  const access = await accessOf(pool, ctx.user.id, ctx.params.id)
  if (!access) throw notFound()
  const n = versionNumber(ctx.params.n)
  if (n === null) throw notFound()
  if (access.role === 'tester') {
    const follows = await one<{ version: number }>(pool, 'SELECT version FROM testers WHERE pattern_id = $1 AND user_id = $2', [access.pattern.id, ctx.user.id])
    if (follows?.version !== n) throw notFound()
  }
  const chart = await loadSnapshot(pool, access.pattern, n)
  if (!chart) throw notFound()
  const meta = (await one<{ note: string; saved_on: string }>(pool, 'SELECT note, saved_on FROM versions WHERE pattern_id = $1 AND version = $2', [access.pattern.id, n]))!
  ctx.reply(200, versionPayload(chart, n, meta.note, meta.saved_on))
})

route('POST', '/api/patterns/:id/versions/:n/restore', 'user', async (ctx) => {
  const { pattern } = await designerAccess(pool, ctx.user.id, ctx.params.id)
  const n = versionNumber(ctx.params.n)
  const restored = n === null ? null : await loadSnapshot(pool, pattern, n)
  if (!restored) throw notFound()
  const version = await transaction(async (db) => {
    await db.query('SELECT 1 FROM patterns WHERE id = $1 FOR UPDATE', [pattern.id])
    const before = await loadChart(db, pattern)
    const rev = blankGrid(restored.height, restored.width, 1)
    for (let r = 0; r < Math.min(restored.height, before.chart.height); r++) {
      for (let c = 0; c < Math.min(restored.width, before.chart.width); c++) rev[r][c] = before.rev[r][c] + 1
    }
    await setColours(db, pattern.id, restored.colours)
    await replaceChart(db, pattern.id, restored, rev, ctx.user.id)
    return saveVersion(db, pattern.id, restored, `Restored from version ${n}`, today())
  })
  const after = await loadChart(pool, { ...pattern, width: restored.width, height: restored.height, cast_on: restored.castOn })
  const derived = derive(after.chart, await noteCounts(pool, pattern.id))
  const op = opOf(ctx)
  void emit(pattern.id, ['designers'], { type: 'structure', by: person(ctx.user), op, restored: true, structure: structureOf(after.chart, after.rev, derived) })
  const entry = (await versionEntries(pattern)).find((v) => v.version === version)!
  void emit(pattern.id, ['designers', 'testers'], { type: 'versions', entry, latest: version })
  ctx.reply(201, { version, restoredFrom: n })
})

route('GET', '/api/patterns/:id/compare', 'user', async (ctx) => {
  const { pattern } = await designerAccess(pool, ctx.user.id, ctx.params.id)
  const a = versionNumber(ctx.url.searchParams.get('a'))
  const b = versionNumber(ctx.url.searchParams.get('b'))
  const from = a === null ? null : await loadSnapshot(pool, pattern, a)
  const to = b === null ? null : await loadSnapshot(pool, pattern, b)
  if (!from || !to) throw notFound()
  ctx.reply(200, { a, b, ...compareCharts(from, to) })
})

route('POST', '/api/patterns/:id/publish', 'user', async (ctx) => {
  const { pattern } = await designerAccess(pool, ctx.user.id, ctx.params.id)
  const latest = await latestVersion(pool, pattern.id)
  if (latest === 0) throw conflict('no_version', 'Save a version before publishing.')
  const working = errorCount(analyseChart((await loadChart(pool, pattern)).chart))
  const saved = errorCount(analyseChart((await loadSnapshot(pool, pattern, latest))!))
  const errors = working || saved
  if (errors) throw conflict('row_errors', `Fix ${errors} row error${errors === 1 ? '' : 's'} before publishing.`)
  await pool.query('UPDATE patterns SET published_version = $2 WHERE id = $1', [pattern.id, latest])
  ctx.reply(200, { state: 'published', version: latest })
})

async function published(patternId: string): Promise<{ pattern: PatternRow; version: number; chart: ChartData }> {
  const pattern = isId(patternId) ? await one<PatternRow>(pool, 'SELECT * FROM patterns WHERE id = $1', [patternId]) : undefined
  if (!pattern || pattern.published_version === null) throw notFound()
  const chart = await loadSnapshot(pool, pattern, pattern.published_version)
  return { pattern, version: pattern.published_version, chart: chart! }
}

route('GET', '/api/public/:id', 'public', async (ctx) => {
  const { pattern, version, chart } = await published(ctx.params.id)
  const derived = derive(chart)
  const publicRows: PublicRow[] = derived.rows.map(({ notes: _notes, textBlock: _block, ...row }: Row) => row)
  const payload: PublicPattern = {
    id: pattern.id, name: pattern.name, craft: chart.craft, mode: chart.mode, terms: chart.terms, version, castOn: chart.castOn,
    width: chart.width, height: chart.height, colours: chart.colours, repeats: chart.repeats,
    cells: cellsOf(chart, blankGrid(chart.height, chart.width, 0)), rows: publicRows,
  }
  ctx.reply(200, payload)
})

route('GET', '/api/patterns/:id/sheet.pdf', 'public', async (ctx) => {
  const { pattern, version, chart } = await published(ctx.params.id)
  const pdf = buildSheet(pattern.name, version, chart, derive(chart).rows.map((r) => r.text).filter(Boolean))
  ctx.res.writeHead(200, {
    'Content-Type': 'application/pdf', 'Content-Length': pdf.length,
    'Content-Disposition': `inline; filename="twinrow-${pattern.id}.pdf"`,
  })
  ctx.res.end(pdf)
})
