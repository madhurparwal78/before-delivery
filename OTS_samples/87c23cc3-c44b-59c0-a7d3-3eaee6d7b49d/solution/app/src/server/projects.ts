import { randomUUID } from 'node:crypto'
import { appendGroupBlock, insertLinkLine, removeGroupBlock, renameEntityInText } from '../shared/canonical.ts'
import { COLOR_NAMES, GRID_MAX, NAME_MAX_LENGTH, type ColorName, type Layout, type ProjectSummary, type UserJson } from '../shared/domain.ts'
import { exportDdl } from '../shared/export.ts'
import { arrangeLayout, reconcileLayout } from '../shared/layout.ts'
import { findColumn, findEntity, parseMortise, type Model } from '../shared/mortise.ts'
import { findTemplate } from '../shared/templates.ts'
import { mergeEdit, splitUnits } from '../shared/units.ts'
import { loadAccess, loadProjectRow, projectJson, requireWrite, type Access, type ProjectRow } from './access.ts'
import { requireUser } from './auth.ts'
import { config } from './config.ts'
import { one, query, transaction, type Queryable } from './db.ts'
import {
  FIELD,
  alreadyGrouped,
  editConflict,
  invalid,
  linkExists,
  noColumn,
  noEntity,
  noGroup,
  notFound,
  schemaHasErrors,
  staleRevision,
  textTooLarge,
} from './errors.ts'
import { integerParam, jsonBody, route, type Context, type Route } from './http.ts'
import { publishLayout, publishRevision } from './live.ts'

const GROUP_LIMIT = 40
const ENTITY_NAME = /^[^"`\\.]{1,64}$/

export function validProjectName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= NAME_MAX_LENGTH
}

export function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

interface Commit {
  revision: number
  layout: Layout
  layoutChanged: boolean
}

/** Records a new revision: parses the text, keeps the layout in step with the last valid parse and logs the edit. */
export async function commitText(
  db: Queryable,
  project: ProjectRow,
  text: string,
  author: UserJson,
  baseRevision: number,
  layoutBase: Layout = project.layout,
  exactLayout?: Layout,
): Promise<Commit> {
  const { model, errors } = parseMortise(text, config.limits)
  const valid = errors.length === 0
  const layout = exactLayout ?? (valid ? reconcileLayout(layoutBase, model) : layoutBase)
  const revision = project.revision + 1
  await query(
    `UPDATE projects SET text = $2, valid_text = $3, layout = $4, revision = $5, updated_at = now() WHERE id = $1`,
    [project.id, text, valid ? text : project.valid_text, JSON.stringify(layout), revision],
    db,
  )
  await query('INSERT INTO edit_log (project_id, revision, base_revision, text, author_id) VALUES ($1, $2, $3, $4, $5)', [project.id, revision, baseRevision, text, author.id], db)
  return { revision, layout, layoutChanged: JSON.stringify(layout) !== JSON.stringify(project.layout) }
}

export function publishCommit(projectId: string, text: string, commit: Commit, by: UserJson): void {
  const person = { userId: by.id, displayName: by.displayName }
  publishRevision(projectId, commit.revision, text, person)
  if (commit.layoutChanged) publishLayout(projectId, commit.layout, person)
}

async function latestAuthorOfUnit(db: Queryable, projectId: string, baseRevision: number, unit: string): Promise<string> {
  const rows = await query<{ text: string; display_name: string }>(
    `SELECT e.text, u.display_name FROM edit_log e JOIN users u ON u.id = e.author_id
     WHERE e.project_id = $1 AND e.revision >= $2 ORDER BY e.revision`,
    [projectId, baseRevision],
    db,
  )
  const body = (text: string): string | undefined => splitUnits(text).find((candidate) => candidate.name === unit)?.text
  for (let i = rows.length - 1; i >= 1; i--) {
    if (body((rows[i] as (typeof rows)[number]).text) !== body((rows[i - 1] as (typeof rows)[number]).text)) return (rows[i] as (typeof rows)[number]).display_name
  }
  return (rows[rows.length - 1] as (typeof rows)[number]).display_name
}

function integerField(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

async function postEdit(context: Context) {
  const user = await requireUser(context)
  const access = await loadAccess(user, context.params.id as string)
  requireWrite(access)
  const body = jsonBody(context)
  const fields: Record<string, string> = {}
  const base = integerField(body.baseRevision)
  if (base === null || base < 1) fields.baseRevision = FIELD.baseRevision
  if (typeof body.text !== 'string') fields.text = FIELD.text
  if (Object.keys(fields).length) throw invalid(fields)
  const text = body.text as string
  if (byteLength(text) > config.limits.textLimitBytes) throw textTooLarge()
  const baseRevision = base as number
  const outcome = await transaction(async (db) => {
    const project = await loadProjectRow(access.project.id, db, true)
    if (baseRevision > project.revision) throw invalid({ baseRevision: FIELD.baseRevision })
    let next = text
    if (baseRevision < project.revision) {
      const baseRow = await one<{ text: string }>('SELECT text FROM edit_log WHERE project_id = $1 AND revision = $2', [project.id, baseRevision], db)
      const merged = mergeEdit((baseRow as { text: string }).text, text, project.text)
      if (merged.conflict !== null) {
        const by = await latestAuthorOfUnit(db, project.id, baseRevision, merged.conflict)
        throw editConflict(project.revision, project.text, merged.conflict, by)
      }
      next = merged.text
    }
    if (next === project.text) return { revision: project.revision, text: next, merged: baseRevision < project.revision, commit: null }
    const commit = await commitText(db, project, next, user, baseRevision)
    return { revision: commit.revision, text: next, merged: baseRevision < project.revision, commit }
  })
  if (outcome.commit) publishCommit(access.project.id, outcome.text, outcome.commit, user)
  return { status: 200, body: { revision: outcome.revision, text: outcome.text, merged: outcome.merged } }
}

/* ------------------------------------------------- writes on valid text */

interface TextWrite {
  access: Access
  project: ProjectRow
  model: Model
}

/** Opens a locked write on valid text at the current revision: stale revision, then text errors, refuse. */
async function writeOnValidText<T>(
  context: Context,
  baseRevision: unknown,
  work: (write: TextWrite, db: Queryable) => Promise<{ result: T; text: string; layoutBase?: Layout }>,
): Promise<{ result: T; text: string; commit: Commit; user: UserJson; projectId: string }> {
  const user = await requireUser(context)
  const access = await loadAccess(user, context.params.id as string)
  requireWrite(access)
  const base = integerField(baseRevision)
  if (base === null) throw invalid({ baseRevision: FIELD.baseRevision })
  const outcome = await transaction(async (db) => {
    const project = await loadProjectRow(access.project.id, db, true)
    if (base !== project.revision) throw staleRevision(project.revision, project.text)
    const { model, errors } = parseMortise(project.text, config.limits)
    if (errors.length) throw schemaHasErrors()
    const done = await work({ access, project, model }, db)
    const commit = await commitText(db, project, done.text, user, project.revision, done.layoutBase)
    return { result: done.result, text: done.text, commit }
  })
  publishCommit(access.project.id, outcome.text, outcome.commit, user)
  return { ...outcome, user, projectId: access.project.id }
}

async function postLink(context: Context) {
  const body = jsonBody(context)
  const written = await writeOnValidText(context, body.baseRevision, async ({ project, model }) => {
    const fields: Record<string, string> = {}
    const refs = { from: parseRef(body.from), to: parseRef(body.to) }
    for (const side of ['from', 'to'] as const) {
      const ref = refs[side]
      const entity = ref ? findEntity(model, ref.entity) : undefined
      if (!ref || !entity || !findColumn(entity, ref.column)) fields[side] = noColumn(typeof body[side] === 'string' ? (body[side] as string) : '')
    }
    const from = refs.from
    const to = refs.to
    if (!Object.keys(fields).length && from && to && from.entity === to.entity && from.column === to.column) fields.to = FIELD.sameColumn
    if (Object.keys(fields).length || !from || !to) throw invalid(fields)
    const inserted = insertLinkLine(project.text, model, from, to)
    const check = parseMortise(inserted.text, config.limits).errors.filter((error) => error.line === inserted.lineNumber)
    // The parser decides what a link may join; its verdict on the new line becomes the field message or the conflict.
    if (check.some((error) => error.duplicateLink)) throw linkExists()
    const refused = check[0]
    if (refused) throw invalid({ to: refused.message })
    return { result: inserted, text: inserted.text }
  })
  const inserted = written.result
  return { status: 200, body: { revision: written.commit.revision, text: written.text, line: inserted.line, lineNumber: inserted.lineNumber } }
}

function parseRef(value: unknown): { entity: string; column: string } | null {
  if (typeof value !== 'string') return null
  const parts = value.split('.')
  return parts.length === 2 && parts[0] && parts[1] ? { entity: parts[0], column: parts[1] } : null
}

function isColor(value: unknown): value is ColorName {
  return typeof value === 'string' && (COLOR_NAMES as readonly string[]).includes(value)
}

async function postGroup(context: Context) {
  const body = jsonBody(context)
  const written = await writeOnValidText(context, body.baseRevision, async ({ project, model }) => {
    const fields: Record<string, string> = {}
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (name.length < 1 || name.length > GROUP_LIMIT || name.includes('"')) fields.name = FIELD.groupName
    const names = Array.isArray(body.entities) ? body.entities.filter((entry): entry is string => typeof entry === 'string') : []
    if (!names.length) fields.entities = FIELD.entities
    else {
      const missing = names.find((entity) => !findEntity(model, entity))
      if (missing !== undefined) fields.entities = noEntity(missing)
    }
    if (!isColor(body.color)) fields.color = FIELD.color
    if (!fields.entities) {
      for (const entity of names) {
        const owner = model.groups.find((group) => group.entities.includes(entity))
        if (owner) throw alreadyGrouped(entity, owner.name)
      }
    }
    if (!fields.name && model.groups.some((group) => group.name === name)) fields.name = FIELD.groupTaken
    if (Object.keys(fields).length) throw invalid(fields)
    const ordered = model.entities.map((entity) => entity.name).filter((entity) => names.includes(entity))
    const layoutBase: Layout = { ...project.layout, groups: { ...project.layout.groups, [name]: { color: body.color as ColorName } } }
    return { result: null, text: appendGroupBlock(project.text, name, ordered), layoutBase }
  })
  return { status: 200, body: { revision: written.commit.revision, text: written.text, layout: written.commit.layout } }
}

async function deleteGroup(context: Context) {
  const name = context.params.name as string
  const written = await writeOnValidText(context, integerParam(context.query.get('baseRevision')), async ({ project, model }) => {
    const group = model.groups.find((candidate) => candidate.name === name)
    if (!group) throw notFound()
    return { result: null, text: removeGroupBlock(project.text, group) }
  })
  return { status: 200, body: { revision: written.commit.revision, text: written.text, layout: written.commit.layout } }
}

async function renameEntity(context: Context) {
  const body = jsonBody(context)
  const written = await writeOnValidText(context, body.baseRevision, async ({ project, model }) => {
    const fields: Record<string, string> = {}
    const from = typeof body.from === 'string' ? body.from : ''
    const to = typeof body.to === 'string' ? body.to : ''
    if (!findEntity(model, from)) fields.from = noEntity(from)
    if (!ENTITY_NAME.test(to)) fields.to = FIELD.newName
    else if (findEntity(model, to)) fields.to = FIELD.nameTaken
    if (Object.keys(fields).length) throw invalid(fields)
    const moved = project.layout.entities[from]
    const entities = { ...project.layout.entities }
    delete entities[from]
    if (moved) entities[to] = moved
    return { result: null, text: renameEntityInText(project.text, model, from, to), layoutBase: { ...project.layout, entities } }
  })
  return { status: 200, body: { revision: written.commit.revision, text: written.text, layout: written.commit.layout } }
}

/* ----------------------------------------------------------------- layout */

/** The changes a layout patch names, or null when the value is not an object of objects. Missing means no changes. */
function changesOf(value: unknown): Record<string, Record<string, unknown>> | null {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const entries = Object.entries(value)
  const objects = entries.every(([, change]) => typeof change === 'object' && change !== null && !Array.isArray(change))
  return objects ? Object.fromEntries(entries as Array<[string, Record<string, unknown>]>) : null
}

async function patchLayout(context: Context) {
  const user = await requireUser(context)
  const access = await loadAccess(user, context.params.id as string)
  requireWrite(access)
  const body = jsonBody(context)
  const entityPatch = changesOf(body.entities)
  const groupPatch = changesOf(body.groups)
  if (!entityPatch || !groupPatch) throw invalid({ [entityPatch ? 'groups' : 'entities']: FIELD.patch })
  const layout = await transaction(async (db) => {
    const project = await loadProjectRow(access.project.id, db, true)
    const next: Layout = { entities: { ...project.layout.entities }, groups: { ...project.layout.groups } }
    const fields: Record<string, string> = {}
    for (const [name, patch] of Object.entries(entityPatch)) {
      const current = next.entities[name]
      if (!current) {
        fields[`entities.${name}`] = noEntity(name)
        continue
      }
      const updated = { ...current }
      for (const axis of ['x', 'y'] as const) {
        if (patch[axis] === undefined) continue
        const value = patch[axis]
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > GRID_MAX) fields[`entities.${name}.${axis}`] = FIELD.coordinate
        else updated[axis] = value
      }
      if (patch.color !== undefined) {
        if (isColor(patch.color)) updated.color = patch.color
        else fields[`entities.${name}.color`] = FIELD.color
      }
      next.entities[name] = updated
    }
    for (const [name, patch] of Object.entries(groupPatch)) {
      if (!next.groups[name]) fields[`groups.${name}`] = noGroup(name)
      else if (isColor(patch.color)) next.groups[name] = { color: patch.color }
      else fields[`groups.${name}.color`] = FIELD.color
    }
    if (Object.keys(fields).length) throw invalid(fields)
    await query('UPDATE projects SET layout = $2, updated_at = now() WHERE id = $1', [project.id, JSON.stringify(next)], db)
    return next
  })
  publishLayout(access.project.id, layout, { userId: user.id, displayName: user.displayName })
  return { status: 200, body: { layout } }
}

async function arrange(context: Context) {
  const user = await requireUser(context)
  const access = await loadAccess(user, context.params.id as string)
  requireWrite(access)
  const layout = await transaction(async (db) => {
    const project = await loadProjectRow(access.project.id, db, true)
    const next = arrangeLayout(project.layout, parseMortise(project.valid_text, config.limits).model)
    await query('UPDATE projects SET layout = $2, updated_at = now() WHERE id = $1', [project.id, JSON.stringify(next)], db)
    return next
  })
  publishLayout(access.project.id, layout, { userId: user.id, displayName: user.displayName })
  return { status: 200, body: { layout } }
}

/* ----------------------------------------------------------- project CRUD */

interface SummaryRow {
  id: string
  name: string
  role: 'owner' | 'editor' | 'viewer'
  revision: number
  layout: Layout
  updated_at: Date
}

const toSummary = (row: SummaryRow): ProjectSummary => ({
  id: row.id,
  name: row.name,
  role: row.role,
  revision: row.revision,
  entityCount: Object.keys(row.layout.entities).length,
  updatedAt: row.updated_at.toISOString(),
})

async function listProjects(context: Context) {
  const user = await requireUser(context)
  const owned = await query<SummaryRow>(
    `SELECT id, name, 'owner' AS role, revision, layout, updated_at FROM projects WHERE owner_id = $1 ORDER BY updated_at DESC, id`,
    [user.id],
  )
  const shared = await query<SummaryRow>(
    `SELECT p.id, p.name, m.role, p.revision, p.layout, p.updated_at FROM projects p JOIN members m ON m.project_id = p.id
     WHERE m.user_id = $1 ORDER BY p.updated_at DESC, p.id`,
    [user.id],
  )
  return { status: 200, body: { owned: owned.map(toSummary), shared: shared.map(toSummary) } }
}

export async function insertProject(owner: string, name: string, text: string, layout: Layout, db?: Queryable): Promise<string> {
  const id = randomUUID()
  const valid = parseMortise(text, config.limits).errors.length === 0
  await query(
    'INSERT INTO projects (id, owner_id, name, text, valid_text, layout, revision) VALUES ($1, $2, $3, $4, $5, $6, 1)',
    [id, owner, name.trim(), text, valid ? text : '', JSON.stringify(layout)],
    db,
  )
  await query('INSERT INTO edit_log (project_id, revision, base_revision, text, author_id) VALUES ($1, 1, 1, $2, $3)', [id, text, owner], db)
  return id
}

export function initialLayout(text: string, given: Layout): Layout {
  const { model, errors } = parseMortise(text, config.limits)
  return errors.length === 0 ? reconcileLayout(given, model) : given
}

async function createProject(context: Context) {
  const user = await requireUser(context)
  const body = jsonBody(context)
  const fields: Record<string, string> = {}
  if (!validProjectName(body.name)) fields.name = FIELD.projectName
  const template = body.templateId === undefined ? undefined : typeof body.templateId === 'string' ? findTemplate(body.templateId) : undefined
  if (body.templateId !== undefined && !template) fields.templateId = FIELD.template
  if (Object.keys(fields).length) throw invalid(fields)
  const text = template?.text ?? ''
  const id = await insertProject(user.id, body.name as string, text, initialLayout(text, { entities: {}, groups: {} }))
  const project = await loadProjectRow(id)
  return { status: 201, body: projectJson(project, 'owner') }
}

async function getProject(context: Context) {
  const user = await requireUser(context)
  const access = await loadAccess(user, context.params.id as string)
  return { status: 200, body: projectJson(access.project, access.role) }
}

async function renameProject(context: Context) {
  const user = await requireUser(context)
  const access = await loadAccess(user, context.params.id as string)
  requireWrite(access)
  const body = jsonBody(context)
  if (!validProjectName(body.name)) throw invalid({ name: FIELD.projectName })
  await query('UPDATE projects SET name = $2, updated_at = now() WHERE id = $1', [access.project.id, body.name.trim()])
  const project = await loadProjectRow(access.project.id)
  return { status: 200, body: projectJson(project, access.role) }
}

async function getDdl(context: Context) {
  const user = await requireUser(context)
  const access = await loadAccess(user, context.params.id as string)
  const { model, errors } = parseMortise(access.project.text, config.limits)
  if (errors.length) throw schemaHasErrors()
  const dialect = context.query.get('dialect')
  if (dialect !== 'postgresql' && dialect !== 'mysql') throw invalid({ dialect: FIELD.dialect })
  return { status: 200, raw: Buffer.from(exportDdl(model, dialect), 'utf8'), contentType: 'text/plain; charset=utf-8' }
}

export const routes: Route[] = [
  route('GET', '/api/projects', listProjects),
  route('POST', '/api/projects', createProject),
  route('GET', '/api/projects/:id', getProject),
  route('PATCH', '/api/projects/:id', renameProject),
  route('POST', '/api/projects/:id/edits', postEdit),
  route('PATCH', '/api/projects/:id/layout', patchLayout),
  route('POST', '/api/projects/:id/layout/arrange', arrange),
  route('POST', '/api/projects/:id/links', postLink),
  route('POST', '/api/projects/:id/groups', postGroup),
  route('DELETE', '/api/projects/:id/groups/:name', deleteGroup),
  route('POST', '/api/projects/:id/entities/rename', renameEntity),
  route('GET', '/api/projects/:id/ddl', getDdl),
]
