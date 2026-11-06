import { queryOne } from '../db';
import { errors } from '../http/errors';
import type { Role } from '../../shared/types';
import type { SessionUser } from './sessions';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export interface DiagramAccess {
  diagramId: string;
  title: string;
  ownerId: string;
  ownerName: string;
  updatedAt: Date;
  role: Role;
}

interface AccessRow {
  id: string;
  title: string;
  owner_id: string;
  owner_name: string;
  updated_at: Date;
  share_role: 'editor' | 'viewer' | null;
}

/** The caller's live role on one diagram, read from the database on every request. */
export async function diagramAccess(diagramId: string, user: SessionUser): Promise<DiagramAccess | null> {
  if (!isUuid(diagramId)) return null;
  const row = await queryOne<AccessRow>(
    `select d.id, d.title, d.owner_id, d.updated_at, o.display_name as owner_name,
            (select s.role from shares s
              where s.diagram_id = d.id and s.email = $2 and s.status = 'active'
              limit 1) as share_role
     from diagrams d join users o on o.id = d.owner_id
     where d.id = $1`,
    [diagramId, user.email.toLowerCase()],
  );
  if (!row) return null;
  const role: Role | null = row.owner_id === user.id ? 'owner' : row.share_role;
  if (!role) return null;
  return {
    diagramId: row.id,
    title: row.title,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    updatedAt: row.updated_at,
    role,
  };
}

export async function requireAccess(diagramId: string, user: SessionUser): Promise<DiagramAccess> {
  const access = await diagramAccess(diagramId, user);
  if (!access) throw errors.notFound();
  return access;
}

const RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };

export function requireRole(access: DiagramAccess, minimum: Role): void {
  if (RANK[access.role] < RANK[minimum]) throw errors.forbidden();
}
