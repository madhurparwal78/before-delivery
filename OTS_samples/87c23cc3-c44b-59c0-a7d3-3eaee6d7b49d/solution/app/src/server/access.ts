import type { Layout, ProjectJson, Role, UserJson } from '../shared/domain.ts'
import { parseMortise } from '../shared/mortise.ts'
import { config } from './config.ts'
import { one, type Queryable } from './db.ts'
import { notFound, ownerOnly, readOnly } from './errors.ts'

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface ProjectRow {
  id: string
  owner_id: string
  owner_name: string
  name: string
  text: string
  valid_text: string
  layout: Layout
  revision: number
  created_at: Date
  updated_at: Date
}

export interface Access {
  project: ProjectRow
  role: Role
  user: UserJson
}

const PROJECT_COLUMNS = `p.id, p.owner_id, u.display_name AS owner_name, p.name, p.text, p.valid_text, p.layout, p.revision, p.created_at, p.updated_at`

export async function loadProjectRow(id: string, db?: Queryable, lock = false): Promise<ProjectRow> {
  const row = await one<ProjectRow>(
    `SELECT ${PROJECT_COLUMNS} FROM projects p JOIN users u ON u.id = p.owner_id WHERE p.id = $1${lock ? ' FOR UPDATE OF p' : ''}`,
    [id],
    db,
  )
  if (!row) throw notFound()
  return row
}

async function roleOf(project: ProjectRow, userId: string, db?: Queryable): Promise<Role | null> {
  if (project.owner_id === userId) return 'owner'
  const member = await one<{ role: 'editor' | 'viewer' }>('SELECT role FROM members WHERE project_id = $1 AND user_id = $2', [project.id, userId], db)
  return member?.role ?? null
}

/** The caller's access to a project, or the not-found answer for a missing, malformed or hidden one. */
export async function loadAccess(user: UserJson, projectId: string, db?: Queryable, lock = false): Promise<Access> {
  if (!UUID.test(projectId)) throw notFound()
  const project = await loadProjectRow(projectId, db, lock)
  const role = await roleOf(project, user.id, db)
  if (!role) throw notFound()
  return { project, role, user }
}

export function requireWrite(access: Access): void {
  if (access.role === 'viewer') throw readOnly()
}

export function requireOwner(access: Access): void {
  if (access.role === 'viewer') throw readOnly()
  if (access.role === 'editor') throw ownerOnly()
}

export function projectJson(project: ProjectRow, role: Role, via?: 'link'): ProjectJson {
  return {
    id: project.id,
    name: project.name,
    role,
    revision: project.revision,
    text: project.text,
    layout: project.layout,
    errorCount: parseMortise(project.text, config.limits).errors.length,
    owner: { id: project.owner_id, displayName: project.owner_name },
    updatedAt: project.updated_at.toISOString(),
    ...(via ? { via } : {}),
  }
}
