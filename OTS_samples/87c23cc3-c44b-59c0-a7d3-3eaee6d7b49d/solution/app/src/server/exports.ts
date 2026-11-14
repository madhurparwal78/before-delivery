import { createHash, randomUUID } from 'node:crypto'
import type { Dialect, ExportJson, ExportStatus } from '../shared/domain.ts'
import { exportDdl } from '../shared/export.ts'
import { parseMortise } from '../shared/mortise.ts'
import { UUID, loadAccess, requireWrite } from './access.ts'
import { requireUser } from './auth.ts'
import { config } from './config.ts'
import { exactlyOne, one, query, transaction } from './db.ts'
import { FIELD, exportExpired, invalid, notFound, rateLimited, schemaHasErrors, storageUnavailable } from './errors.ts'
import { jsonBody, route, type Context, type Route } from './http.ts'
import { getObject, putObject } from './storage.ts'

const WINDOW_MS = 60_000
const SLUG_LIMIT = 60

interface ExportRow {
  id: string
  project_id: string
  dialect: Dialect
  status: 'requested' | 'stored' | 'failed'
  key: string
  bytes: number
  sha256: string
  file_name: string
  revision: number
  stored_at: Date | null
  created_at: Date
}

function expiresAt(row: ExportRow): Date {
  return new Date((row.stored_at ?? row.created_at).getTime() + config.exportLinkTtlSeconds * 1000)
}

function statusOf(row: ExportRow): ExportStatus {
  return row.status === 'stored' && expiresAt(row).getTime() <= Date.now() ? 'expired' : row.status
}

function toExport(row: ExportRow): ExportJson {
  return {
    id: row.id,
    dialect: row.dialect,
    status: statusOf(row),
    key: row.key,
    bytes: row.bytes,
    sha256: row.sha256,
    fileName: row.file_name,
    revision: row.revision,
    downloadUrl: `/api/projects/${row.project_id}/exports/${row.id}/download`,
    downloadExpiresAt: expiresAt(row).toISOString(),
    createdAt: row.created_at.toISOString(),
  }
}

function fileSlug(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, SLUG_LIMIT)
  return slug === '' ? 'schema' : slug
}

async function saveExport(context: Context) {
  const user = await requireUser(context)
  const access = await loadAccess(user, context.params.id as string)
  requireWrite(access)
  const { model, errors } = parseMortise(access.project.text, config.limits)
  if (errors.length) throw schemaHasErrors()
  const dialect = jsonBody(context).dialect
  if (dialect !== 'postgresql' && dialect !== 'mysql') throw invalid({ dialect: FIELD.dialect })
  const file = Buffer.from(exportDdl(model, dialect), 'utf8')
  const sha256 = createHash('sha256').update(file).digest('hex')
  const id = randomUUID()
  const key = `exports/${access.project.id}/${id}-${dialect}.sql`
  const fileName = `${fileSlug(access.project.name)}-${dialect}.sql`
  await transaction(async (db) => {
    await query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [user.id], db)
    const recent = await exactlyOne<{ total: number; oldest: Date | null }>(
      'SELECT count(*)::int AS total, min(created_at) AS oldest FROM exports WHERE user_id = $1 AND created_at > $2',
      [user.id, new Date(Date.now() - WINDOW_MS)],
      db,
    )
    if (recent.total >= config.exportRateLimit && recent.oldest) {
      throw rateLimited(Math.max(1, Math.ceil((recent.oldest.getTime() + WINDOW_MS - Date.now()) / 1000)))
    }
    await query(
      `INSERT INTO exports (id, project_id, user_id, dialect, status, key, bytes, sha256, file_name, revision, created_at)
       VALUES ($1, $2, $3, $4, 'requested', $5, $6, $7, $8, $9, $10)`,
      [id, access.project.id, user.id, dialect, key, file.length, sha256, fileName, access.project.revision, new Date()],
      db,
    )
  })
  try {
    await putObject(key, file, sha256)
  } catch {
    await query("UPDATE exports SET status = 'failed' WHERE id = $1", [id])
    throw storageUnavailable()
  }
  const row = await one<ExportRow>("UPDATE exports SET status = 'stored', stored_at = $2 WHERE id = $1 RETURNING *", [id, new Date()])
  return { status: 201, body: toExport(row as ExportRow) }
}

async function listExports(context: Context) {
  const access = await loadAccess(await requireUser(context), context.params.id as string)
  const rows = await query<ExportRow>('SELECT * FROM exports WHERE project_id = $1 ORDER BY created_at DESC, id', [access.project.id])
  return { status: 200, body: { exports: rows.map(toExport) } }
}

async function downloadExport(context: Context) {
  const access = await loadAccess(await requireUser(context), context.params.id as string)
  const id = context.params.eid as string
  const row = UUID.test(id) ? await one<ExportRow>('SELECT * FROM exports WHERE id = $1 AND project_id = $2', [id, access.project.id]) : undefined
  if (!row || row.status === 'requested' || row.status === 'failed') throw notFound()
  if (statusOf(row) === 'expired') throw exportExpired()
  let bytes: Buffer
  try {
    bytes = await getObject(row.key)
  } catch {
    throw storageUnavailable()
  }
  return {
    status: 200,
    raw: bytes,
    contentType: 'application/sql; charset=utf-8',
    headers: { 'Content-Disposition': `attachment; filename="${row.file_name}"` },
  }
}

export const routes: Route[] = [
  route('POST', '/api/projects/:id/exports', saveExport),
  route('GET', '/api/projects/:id/exports', listExports),
  route('GET', '/api/projects/:id/exports/:eid/download', downloadExport),
]
