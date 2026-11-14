import { printEntityUnit } from '../shared/canonical.ts'
import { NAME_MAX_LENGTH, type Comparison, type Layout, type UserJson, type VersionDetail, type VersionJson } from '../shared/domain.ts'
import { parseMortise, type Model } from '../shared/mortise.ts'
import { loadAccess, loadProjectRow, projectJson, requireWrite, type ProjectRow } from './access.ts'
import { requireUser } from './auth.ts'
import { config } from './config.ts'
import { exactlyOne, one, query, transaction, type Queryable } from './db.ts'
import { FIELD, invalid, notFound, versionHasErrors } from './errors.ts'
import { jsonBody, route, type Context, type Reply, type Route } from './http.ts'
import { commitText, publishCommit } from './projects.ts'

interface VersionRow {
  number: number
  name: string
  revision: number
  text: string
  layout: Layout
  created_at: Date
  created_by: string
  created_by_name: string
  restored_from: number | null
}

const SELECT_VERSION = `SELECT v.number, v.name, v.revision, v.text, v.layout, v.created_at, v.created_by, u.display_name AS created_by_name, v.restored_from
  FROM versions v JOIN users u ON u.id = v.created_by`

const toVersion = (row: VersionRow): VersionJson => ({
  number: row.number,
  name: row.name,
  revision: row.revision,
  createdAt: row.created_at.toISOString(),
  createdBy: { id: row.created_by, displayName: row.created_by_name },
  restoredFrom: row.restored_from,
})

const toDetail = (row: VersionRow): VersionDetail => ({ ...toVersion(row), text: row.text, layout: row.layout })

function versionNumber(value: string | null): number | null {
  return value !== null && /^[1-9][0-9]{0,8}$/.test(value) ? Number(value) : null
}

export async function listVersions(projectId: string): Promise<Reply> {
  const rows = await query<VersionRow>(`${SELECT_VERSION} WHERE v.project_id = $1 ORDER BY v.number DESC`, [projectId])
  return { status: 200, body: { versions: rows.map(toVersion) } }
}

async function findVersion(projectId: string, number: number | null, db?: Queryable): Promise<VersionRow> {
  const row = number === null ? undefined : await one<VersionRow>(`${SELECT_VERSION} WHERE v.project_id = $1 AND v.number = $2`, [projectId, number], db)
  if (!row) throw notFound()
  return row
}

export async function versionDetail(projectId: string, raw: string): Promise<Reply> {
  return { status: 200, body: toDetail(await findVersion(projectId, versionNumber(raw))) }
}

function entityBlocks(model: Model): Map<string, string> {
  return new Map(model.entities.map((entity) => [entity.name, printEntityUnit(model, entity).join('\n')]))
}

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

export async function compareVersions(projectId: string, rawFrom: string | null, rawTo: string | null): Promise<Reply> {
  const from = await findVersion(projectId, versionNumber(rawFrom))
  const to = await findVersion(projectId, versionNumber(rawTo))
  const before = parseMortise(from.text, config.limits)
  const after = parseMortise(to.text, config.limits)
  if (before.errors.length || after.errors.length) throw versionHasErrors()
  const left = entityBlocks(before.model)
  const right = entityBlocks(after.model)
  const result: Comparison = {
    from: from.number,
    to: to.number,
    added: [...right.keys()].filter((name) => !left.has(name)).sort(byName),
    removed: [...left.keys()].filter((name) => !right.has(name)).sort(byName),
    changed: [...left.keys()].filter((name) => right.has(name) && left.get(name) !== right.get(name)).sort(byName),
  }
  return { status: 200, body: result }
}

async function saveVersion(context: Context) {
  const user = await requireUser(context)
  const access = await loadAccess(user, context.params.id as string)
  requireWrite(access)
  const name = jsonBody(context).name
  if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > NAME_MAX_LENGTH) throw invalid({ name: FIELD.versionName })
  const number = await transaction(async (db) => {
    const project = await loadProjectRow(access.project.id, db, true)
    return insertVersion(db, project, name.trim(), user, null)
  })
  const row = await findVersion(access.project.id, number)
  return { status: 201, body: toVersion(row) }
}

async function insertVersion(db: Queryable, project: ProjectRow, name: string, user: UserJson, restoredFrom: number | null): Promise<number> {
  const { next: number } = await exactlyOne<{ next: number }>('SELECT coalesce(max(number), 0) + 1 AS next FROM versions WHERE project_id = $1', [project.id], db)
  await query(
    `INSERT INTO versions (project_id, number, name, revision, text, layout, created_by, restored_from)
     SELECT id, $2, $3, revision, text, layout, $4, $5 FROM projects WHERE id = $1`,
    [project.id, number, name, user.id, restoredFrom],
    db,
  )
  return number
}

async function restoreVersion(context: Context) {
  const user = await requireUser(context)
  const access = await loadAccess(user, context.params.id as string)
  requireWrite(access)
  const wanted = versionNumber(context.params.n as string)
  const outcome = await transaction(async (db) => {
    const project = await loadProjectRow(access.project.id, db, true)
    const version = await findVersion(project.id, wanted, db)
    const commit = await commitText(db, project, version.text, user, project.revision, version.layout, version.layout)
    const fresh = await loadProjectRow(project.id, db)
    const number = await insertVersion(db, fresh, `Restored from version ${version.number}`, user, version.number)
    return { commit, text: version.text, number }
  })
  publishCommit(access.project.id, outcome.text, outcome.commit, user)
  const project = await loadProjectRow(access.project.id)
  return {
    status: 201,
    body: { version: toVersion(await findVersion(project.id, outcome.number)), project: projectJson(project, access.role) },
  }
}

export const routes: Route[] = [
  route('GET', '/api/projects/:id/versions', async (context) => {
    const access = await loadAccess(await requireUser(context), context.params.id as string)
    return listVersions(access.project.id)
  }),
  route('GET', '/api/projects/:id/versions/compare', async (context) => {
    const access = await loadAccess(await requireUser(context), context.params.id as string)
    return compareVersions(access.project.id, context.query.get('from'), context.query.get('to'))
  }),
  route('GET', '/api/projects/:id/versions/:n', async (context) => {
    const access = await loadAccess(await requireUser(context), context.params.id as string)
    return versionDetail(access.project.id, context.params.n as string)
  }),
  route('POST', '/api/projects/:id/versions', saveVersion),
  route('POST', '/api/projects/:id/versions/:n/restore', restoreVersion),
]
