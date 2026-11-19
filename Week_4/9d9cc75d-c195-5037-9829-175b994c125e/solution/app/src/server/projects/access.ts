import type { Role } from '../../shared/model.ts';
import type { App, AuthUser } from '../http/app.ts';
import { forbidden, notFound } from '../http/errors.ts';

export const projectSchema = [
  `CREATE TABLE IF NOT EXISTS projects (
     id text PRIMARY KEY,
     name text NOT NULL,
     explorers_schedule boolean NOT NULL DEFAULT false,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS project_members (
     project_id text NOT NULL REFERENCES projects(id),
     user_id text NOT NULL REFERENCES users(id),
     role text NOT NULL,
     PRIMARY KEY (project_id, user_id)
   )`,
];

const RANK: Record<Role, number> = { viewer: 0, explorer: 1, creator: 2 };

const ROLES: readonly Role[] = ['viewer', 'explorer', 'creator'];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && ROLES.some((role) => role === value);
}

function atLeast(role: Role, minimum: Role): boolean {
  return RANK[role] >= RANK[minimum];
}

/** 403 when `role` is below `minimum`. Call it after the 404 checks. */
export function requireRole(role: Role, minimum: Role): void {
  if (!atLeast(role, minimum)) throw forbidden();
}

export interface ProjectRow {
  id: string;
  name: string;
  explorers_schedule: boolean;
}

interface ProjectAccess {
  project: ProjectRow;
  role: Role;
}

/**
 * The project and the caller's role in it. A project that does not exist and one the caller is not a member of
 * answer the same 404, which is also how every id inside a project is guarded.
 */
export async function projectAccess(app: App, user: AuthUser, projectId: string): Promise<ProjectAccess> {
  const found = await app.db.row<ProjectRow & { role: Role }>(
    `SELECT p.id, p.name, p.explorers_schedule, m.role
       FROM projects p JOIN project_members m ON m.project_id = p.id
      WHERE p.id = $1 AND m.user_id = $2`,
    [projectId, user.id],
  );
  if (!found) throw notFound();
  return { project: { id: found.id, name: found.name, explorers_schedule: found.explorers_schedule }, role: found.role };
}

/** The user ids that are members of a project (every role). */
export async function memberIds(app: App, projectId: string): Promise<string[]> {
  const rows = await app.db.rows<{ user_id: string }>(`SELECT user_id FROM project_members WHERE project_id = $1`, [
    projectId,
  ]);
  return rows.map((row) => row.user_id);
}
