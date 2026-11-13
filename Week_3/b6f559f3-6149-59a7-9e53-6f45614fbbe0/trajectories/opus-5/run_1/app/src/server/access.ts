import { errors } from './http';
import { MSG } from '../shared/messages';
import { queryOne } from './db';
import { projectRow, purgeExpired, roleOf } from './repo';
import type { ProjectRow, Role } from './repo';

export interface Person {
  id: string;
  name: string;
  email: string;
}

export interface SessionInfo {
  person: Person;
  sessionId: string;
}

export async function personForSession(sessionId: string | null): Promise<Person | null> {
  if (!sessionId) return null;
  return queryOne<Person>(
    `SELECT p.id, p.name, p.email FROM sessions s JOIN people p ON p.id = s.person_id
     WHERE s.id = $1`,
    [sessionId],
  );
}

export type Need = 'view' | 'edit' | 'publish' | 'manage';

export interface ProjectAccess {
  row: ProjectRow;
  role: Role;
}

/** Checks sign-in, then visibility, then role, then project state, in the published order. */
export async function openProject(
  person: Person | null,
  projectId: string,
  need: Need,
): Promise<ProjectAccess> {
  if (!person) throw errors.unauthenticated();
  await purgeExpired();
  const row = await projectRow(projectId);
  if (!row) throw errors.notFound();
  const role = await roleOf(projectId, person.id);
  if (!role) throw errors.notFound();
  if (need === 'edit' && role === 'Viewer') throw errors.forbidden(MSG.viewerCantEdit);
  if (need === 'publish' && role !== 'Owner') throw errors.forbidden(MSG.ownerOnlyPublish);
  if (need === 'manage' && role !== 'Owner') throw errors.forbidden(MSG.ownerOnlyMembers);
  return { row, role };
}

/** State check, run after any idempotency replay. */
export function requireActive(row: ProjectRow): void {
  if (row.status === 'trashed') throw errors.conflict('trashed', MSG.trashed);
}

export async function requirePerson(person: Person | null): Promise<Person> {
  if (!person) throw errors.unauthenticated();
  return person;
}
