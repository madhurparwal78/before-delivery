import { Request } from 'express';
import { notFound, readOnly, unauthenticated } from '../shared/errors';
import { UserRow, currentUser } from './auth';
import { CollectionRow } from './collectionStore';
import { queryOne } from './db';

export type Role = 'owner' | 'editor' | 'reader';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export interface ProjectRow {
  id: string;
  name: string;
  owner_id: string;
}

export async function requireUser(req: Request): Promise<UserRow> {
  const user = await currentUser(req);
  if (!user) throw unauthenticated();
  return user;
}

/** The caller's role is read on every request; anything unreachable is `not_found`. */
export async function projectAccess(userId: string, projectId: string): Promise<{ project: ProjectRow; role: Role }> {
  if (!UUID.test(projectId)) throw notFound();
  const row = await queryOne<{ id: string; name: string; owner_id: string; role: string }>(
    `select projects.id, projects.name, projects.owner_id, memberships.role
     from projects join memberships on memberships.project_id = projects.id
     where projects.id = $1 and memberships.user_id = $2`,
    [projectId, userId],
  );
  if (!row) throw notFound();
  return { project: { id: row.id, name: row.name, owner_id: row.owner_id }, role: row.role as Role };
}

export async function collectionAccess(
  userId: string,
  projectId: string,
  collectionId: string,
): Promise<{ project: ProjectRow; role: Role; collection: CollectionRow }> {
  const access = await projectAccess(userId, projectId);
  if (!UUID.test(collectionId)) throw notFound();
  const collection = await queryOne<CollectionRow>(
    'select id, project_id, name, sequence, validator from collections where id = $1 and project_id = $2',
    [collectionId, projectId],
  );
  if (!collection) throw notFound();
  return { ...access, collection };
}

export function requireWriter(role: Role): void {
  if (role === 'reader') throw readOnly();
}

export function requireOwner(role: Role): void {
  if (role !== 'owner') throw readOnly();
}
