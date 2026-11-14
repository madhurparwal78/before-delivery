import { createHash, randomUUID } from 'node:crypto'
import type { Dialect, ImportJson, ImportRecord } from '../shared/domain.ts'
import { parseMortise } from '../shared/mortise.ts'
import { UUID, loadAccess, loadProjectRow, requireWrite } from './access.ts'
import { requireUser } from './auth.ts'
import { config } from './config.ts'
import { one, query, transaction } from './db.ts'
import { parseDdl } from './ddl.ts'
import { FIELD, ddlTooLarge, importFailed, invalid, notFound, schemaHasErrors, staleRevision, storageUnavailable } from './errors.ts'
import { integerParam, route, type Context, type Route } from './http.ts'
import { planImport, type ImportMode } from './importing.ts'
import { commitText, publishCommit } from './projects.ts'
import { getObject, putObject } from './storage.ts'

interface ImportRow {
  id: string
  dialect: Dialect
  mode: ImportMode
  key: string
  bytes: number
  sha256: string
  created_at: Date
}

const lineOf = (error: { line: number; column: number; message: string }): string => `Line ${error.line}, column ${error.column}: ${error.message}`

async function runImport(context: Context) {
  const user = await requireUser(context)
  const access = await loadAccess(user, context.params.id as string)
  requireWrite(access)
  const base = integerParam(context.query.get('baseRevision'))
  const dialect = context.query.get('dialect')
  const mode = context.query.get('mode')
  const project = access.project
  if (base === null) throw invalid({ baseRevision: FIELD.baseRevision })
  if (base !== project.revision) throw staleRevision(project.revision, project.text)
  const current = parseMortise(project.text, config.limits)
  if (mode === 'merge' && current.errors.length) throw schemaHasErrors()
  const fields: Record<string, string> = {}
  if (dialect !== 'postgresql' && dialect !== 'mysql') fields.dialect = FIELD.dialect
  if (mode !== 'merge' && mode !== 'replace') fields.mode = FIELD.mode
  if (Object.keys(fields).length) throw invalid(fields)

  const body = context.rawBody
  const parsed = parseDdl(body, dialect as Dialect, config.limits)
  if (!parsed.ok) throw importFailed(parsed.errors.sort((a, b) => a.line - b.line || a.column - b.column).map(lineOf))
  const planned = planImport(parsed.value, mode as ImportMode, project.text, config.limits)
  if (!planned.ok) throw importFailed(planned.errors.sort((a, b) => a.line - b.line || a.column - b.column).map(lineOf))
  if (body.length > config.limits.textLimitBytes) throw ddlTooLarge()

  const id = randomUUID()
  const key = `imports/${project.id}/${id}.sql`
  const sha256 = createHash('sha256').update(body).digest('hex')
  try {
    await putObject(key, body, sha256)
  } catch {
    throw storageUnavailable()
  }
  const outcome = await transaction(async (db) => {
    const locked = await loadProjectRow(project.id, db, true)
    if (locked.revision !== project.revision) throw staleRevision(locked.revision, locked.text)
    const changed = planned.plan.text !== locked.text
    const commit = changed ? await commitText(db, locked, planned.plan.text, user, locked.revision) : null
    await query('INSERT INTO imports (id, project_id, user_id, dialect, mode, key, bytes, sha256) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [
      id,
      project.id,
      user.id,
      dialect,
      mode,
      key,
      body.length,
      sha256,
    ], db)
    return { changed, commit, revision: commit?.revision ?? locked.revision }
  })
  if (outcome.commit) publishCommit(project.id, planned.plan.text, outcome.commit, user)
  const result: ImportJson = {
    id,
    dialect: dialect as Dialect,
    mode: mode as ImportMode,
    revision: outcome.revision,
    changed: outcome.changed,
    originalKey: key,
    bytes: body.length,
    sha256,
    report: planned.plan.report,
    notes: planned.plan.notes,
    counts: planned.plan.counts,
  }
  return { status: 201, body: result }
}

const toRecord = (row: ImportRow): ImportRecord => ({
  id: row.id,
  dialect: row.dialect,
  mode: row.mode,
  bytes: row.bytes,
  sha256: row.sha256,
  createdAt: row.created_at.toISOString(),
})

async function listImports(context: Context) {
  const access = await loadAccess(await requireUser(context), context.params.id as string)
  const rows = await query<ImportRow>('SELECT * FROM imports WHERE project_id = $1 ORDER BY created_at DESC, id', [access.project.id])
  return { status: 200, body: { imports: rows.map(toRecord) } }
}

async function originalDdl(context: Context) {
  const access = await loadAccess(await requireUser(context), context.params.id as string)
  const id = context.params.iid as string
  const row = UUID.test(id) ? await one<ImportRow>('SELECT * FROM imports WHERE id = $1 AND project_id = $2', [id, access.project.id]) : undefined
  if (!row) throw notFound()
  let bytes: Buffer
  try {
    bytes = await getObject(row.key)
  } catch {
    throw storageUnavailable()
  }
  return { status: 200, raw: bytes, contentType: 'application/sql' }
}

export const routes: Route[] = [
  route('POST', '/api/projects/:id/imports', runImport),
  route('GET', '/api/projects/:id/imports', listImports),
  route('GET', '/api/projects/:id/imports/:iid/original', originalDdl),
]

