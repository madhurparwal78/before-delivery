import { sessionPerson, SESSION_COOKIE } from '../auth';
import type { Queryable } from '../db/queryable';
import type { ProjectRole } from '../db/seed-data';
import {
  atLeast,
  effectiveRole,
  loadGrants,
  loadProject,
  type Person,
  type Project,
} from '../projects';
import type { RequestContext } from './context';
import { forbidden, notFound, unauthenticated } from './errors';

export async function requirePerson(
  executor: Queryable,
  context: RequestContext,
): Promise<Person> {
  const person = await sessionPerson(executor, context.cookies[SESSION_COOKIE]);
  if (person === null) throw unauthenticated();
  return person;
}

export interface ProjectAccess {
  readonly project: Project;
  readonly role: ProjectRole;
}

/** A project the caller cannot see is a 404; an insufficient role on a visible one is a 403. */
export async function requireProject(
  executor: Queryable,
  person: Person,
  slug: string,
  needed: ProjectRole = 'viewer',
): Promise<ProjectAccess> {
  const project = await loadProject(executor, slug);
  if (project === null) throw notFound();
  const grants = await loadGrants(executor, person.id);
  const role = effectiveRole(person, grants.get(slug));
  if (role === null) throw notFound();
  if (!atLeast(role, needed)) throw forbidden();
  return { project, role };
}

/** Stewards may ingest into every project of the organisation. */
export async function requireIngestableProject(
  executor: Queryable,
  person: Person,
  slug: string,
): Promise<Project> {
  const project = await loadProject(executor, slug);
  if (project === null) throw notFound();
  if (person.orgRole === 'steward') return project;
  const grants = await loadGrants(executor, person.id);
  if (effectiveRole(person, grants.get(slug)) === null) throw notFound();
  throw forbidden();
}

export function requireAdmin(person: Person): void {
  if (person.orgRole !== 'admin') throw forbidden();
}
