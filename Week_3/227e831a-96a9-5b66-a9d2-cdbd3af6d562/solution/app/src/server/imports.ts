import { randomUUID } from 'node:crypto'
import type { Category, ImportCounts, ImportRow, ImportRun, RowRejection } from '../shared/api-types'
import { checkHeader, checkRow, FILE_MESSAGES, matchRows, MAX_CSV_ROWS, readRecords, type CheckedRow, type MatchedRow, type NewGear } from '../shared/csv'
import { itemIdentity, normaliseName } from '../shared/names'
import { asId, pool, query, transaction, uniqueViolation, type Db } from './db'
import { HttpError, refuse } from './errors'
import { declare, settle } from './fields'
import type { Route } from './http'
import { deleteObject, getObject, putObject } from './s3'

const MAX_CSV_BYTES = 1000000

interface RunRow {
  id: string
  filename: string
  bytes: number
  uploaded_at: Date
  status: ImportRun['status']
}

interface StoredRow {
  row: number
  name: string
  category_text: string
  outcome: ImportRow['outcome']
  item_id: string | null
  same_as_row: number | null
  reason: RowRejection | null
  gear: NewGear | null
}

function countsOf(rows: readonly { outcome: ImportRow['outcome'] }[]): ImportCounts {
  return {
    matched: rows.filter((row) => row.outcome === 'matched').length,
    created: rows.filter((row) => row.outcome === 'created').length,
    rejected: rows.filter((row) => row.outcome === 'rejected').length,
  }
}

function runJson(run: RunRow, rows: Pick<StoredRow, 'outcome'>[], withRows: boolean): ImportRun {
  const json: ImportRun = {
    id: run.id,
    filename: run.filename,
    bytes: run.bytes,
    uploadedAt: run.uploaded_at.toISOString(),
    status: run.status,
    counts: countsOf(rows),
  }
  if (withRows) {
    json.rows = (rows as StoredRow[]).map((row) => ({
      row: row.row, name: row.name, category: row.category_text, outcome: row.outcome,
      itemId: row.item_id, sameAsRow: row.same_as_row, reason: row.reason,
    }))
  }
  return json
}

async function closetIdentities(db: Db): Promise<Map<string, string>> {
  const items = await query<{ id: string; name: string; category: Category }>('SELECT id, name, category FROM items', [], db)
  return new Map(items.map((item) => [itemIdentity(item.name, item.category), item.id]))
}

async function loadRows(db: Db, importId: string): Promise<StoredRow[]> {
  return query<StoredRow>(
    'SELECT row, name, category_text, outcome, item_id, same_as_row, reason, gear FROM import_rows WHERE import_id = $1 ORDER BY row', [importId], db)
}

async function writeRows(db: Db, importId: string, rows: readonly MatchedRow[]): Promise<void> {
  for (const row of rows) {
    await query(
      `INSERT INTO import_rows (import_id, row, name, category_text, outcome, item_id, same_as_row, reason, gear)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (import_id, row) DO UPDATE SET outcome = $5, item_id = $6, same_as_row = $7`,
      [importId, row.row, row.name, row.categoryText, row.outcome, row.itemId, row.sameAsRow, row.reason, row.gear ? JSON.stringify(row.gear) : null],
      db,
    )
  }
}

const uploadImport: Route = {
  method: 'POST',
  pattern: '/api/imports',
  access: 'session',
  body: { kind: 'multipart', fileLimit: MAX_CSV_BYTES },
  async handler(ctx) {
    const part = ctx.file('file')
    if (part && part.data.length > MAX_CSV_BYTES) throw refuse.payloadTooLarge()
    if (!part || part.data.length === 0) throw refuse.validation({ file: FILE_MESSAGES.missingFile })
    const importId = randomUUID()
    const key = `imports/${importId}/original.csv`
    await putObject(key, part.data, 'text/csv')
    try {
      const records = readRecords(part.data)
      if (records === null) throw refuse.validation({ file: FILE_MESSAGES.unreadable })
      const header = checkHeader(records[0] ?? [])
      if (!header.ok) throw refuse.validation({ file: header.message })
      const dataRecords = records.slice(1)
      if (dataRecords.length > MAX_CSV_ROWS) throw refuse.validation({ file: FILE_MESSAGES.tooManyRows })
      const checked = dataRecords.map((cells, index) => checkRow(index + 1, cells, header.columns))
      const filename = part.filename.split(/[\\/]/).pop() || 'upload.csv'
      return await transaction(async (db) => {
        const matched = matchRows(checked, await closetIdentities(db))
        const [run] = await query<RunRow>(
          "INSERT INTO imports (id, filename, bytes, status) VALUES ($1, $2, $3, 'previewed') RETURNING id, filename, bytes, uploaded_at, status",
          [importId, filename, part.data.length], db)
        if (!run) throw refuse.internal()
        await writeRows(db, importId, matched)
        return { status: 201, body: { import: runJson(run, await loadRows(db, importId), true) } }
      })
    } catch (error) {
      await deleteObject(key).catch(() => undefined)
      throw error
    }
  },
}

const listImports: Route = {
  method: 'GET',
  pattern: '/api/imports',
  access: 'session',
  async handler() {
    const runs = await query<RunRow>('SELECT id, filename, bytes, uploaded_at, status FROM imports ORDER BY seq DESC')
    const outcomes = await query<{ import_id: string; outcome: ImportRow['outcome'] }>('SELECT import_id, outcome FROM import_rows')
    return {
      status: 200,
      body: { imports: runs.map((run) => runJson(run, outcomes.filter((row) => row.import_id === run.id), false)) },
    }
  },
}

const getImport: Route = {
  method: 'GET',
  pattern: '/api/imports/:id',
  access: 'session',
  async handler(ctx) {
    const id = asId(ctx.params.id)
    const [run] = id ? await query<RunRow>('SELECT id, filename, bytes, uploaded_at, status FROM imports WHERE id = $1', [id]) : []
    if (!run) throw refuse.notFound('import')
    return { status: 200, body: { import: runJson(run, await loadRows(pool, run.id), true) } }
  },
}

const noFields = declare({})

const commitImport: Route = {
  method: 'POST',
  pattern: '/api/imports/:id/commit',
  access: 'session',
  async handler(ctx) {
    const id = asId(ctx.params.id)
    return transaction(async (db) => {
      const [run] = id ? await query<RunRow>('SELECT id, filename, bytes, uploaded_at, status FROM imports WHERE id = $1 FOR UPDATE', [id], db) : []
      if (!run) throw refuse.notFound('import')
      if (run.status === 'committed') throw new HttpError(409, 'import_committed', 'This import was already confirmed.')
      settle(noFields.read(ctx.json()))
      const stored = await loadRows(db, run.id)
      const checked: CheckedRow[] = stored.map((row) => ({
        row: row.row, name: row.name, categoryText: row.category_text, reason: row.reason, gear: row.gear,
      }))
      const matched = matchRows(checked, await closetIdentities(db))
      const createdIds = new Map<string, string>()
      const resolved: MatchedRow[] = []
      for (const row of matched) {
        const gear = row.gear
        if (gear && row.outcome === 'created') {
          const identity = itemIdentity(gear.name, gear.category)
          const itemId = await createItem(db, gear)
          createdIds.set(identity, itemId)
          resolved.push({ ...row, itemId })
        } else resolved.push(row)
      }
      const final = resolved.map((row) => {
        if (row.gear && row.outcome === 'matched' && row.itemId === null) {
          return { ...row, itemId: createdIds.get(itemIdentity(row.gear.name, row.gear.category)) ?? null }
        }
        return row
      })
      await writeRows(db, run.id, final)
      await query("UPDATE imports SET status = 'committed' WHERE id = $1", [run.id], db)
      return { status: 200, body: { import: runJson({ ...run, status: 'committed' }, await loadRows(db, run.id), true) } }
    })
  },
}

async function createItem(db: Db, gear: NewGear): Promise<string> {
  const id = randomUUID()
  try {
    await query(
      `INSERT INTO items (id, name, name_key, category, weight_grams, units_owned, price_cents, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, gear.name, normaliseName(gear.name), gear.category, gear.weightGrams, gear.unitsOwned, gear.priceCents, gear.notes], db)
  } catch (error) {
    if (!uniqueViolation(error)) throw error
    throw new HttpError(409, 'import_changed', 'The closet changed while confirming. Preview the file again.')
  }
  return id
}

const downloadOriginal: Route = {
  method: 'GET',
  pattern: '/api/imports/:id/original',
  access: 'session',
  async handler(ctx) {
    const id = asId(ctx.params.id)
    const [run] = id ? await query<RunRow>('SELECT id, filename, bytes, uploaded_at, status FROM imports WHERE id = $1', [id]) : []
    if (!run) throw refuse.notFound('import')
    const data = await getObject(`imports/${run.id}/original.csv`)
    if (!data) throw refuse.notFound('import')
    const ascii = run.filename.replace(/[^\x20-\x7e]|["\\]/g, '_')
    return {
      status: 200,
      bytes: { data, contentType: 'text/csv' },
      headers: { 'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(run.filename)}` },
    }
  },
}

export const importRoutes: Route[] = [uploadImport, listImports, getImport, commitImport, downloadOriginal]
