import { Queryable } from '../db.js';
import { Role, WorkspaceRow } from './types.js';

export interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  joined_at: Date;
}

export async function workspaceById(
  tx: Queryable,
  workspaceId: string,
): Promise<WorkspaceRow | null> {
  const { rows } = await tx.query<WorkspaceRow>(
    'SELECT id, name, next_block FROM workspaces WHERE id = $1',
    [workspaceId],
  );
  return rows[0] ?? null;
}

export async function allWorkspaces(tx: Queryable): Promise<WorkspaceRow[]> {
  const { rows } = await tx.query<WorkspaceRow>(
    'SELECT id, name, next_block FROM workspaces ORDER BY created_at, id',
  );
  return rows;
}

export async function membersOf(tx: Queryable, workspaceId: string): Promise<MemberRow[]> {
  const { rows } = await tx.query<MemberRow>(
    `SELECT p.id, p.name, p.email, m.role, m.joined_at
     FROM members m JOIN people p ON p.id = m.person_id
     WHERE m.workspace_id = $1
     ORDER BY m.joined_at, p.name`,
    [workspaceId],
  );
  return rows;
}

export async function roleOf(
  tx: Queryable,
  workspaceId: string,
  personId: string,
): Promise<Role | null> {
  const { rows } = await tx.query<{ role: Role }>(
    'SELECT role FROM members WHERE workspace_id = $1 AND person_id = $2',
    [workspaceId, personId],
  );
  return rows[0]?.role ?? null;
}
