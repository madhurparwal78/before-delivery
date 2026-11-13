import { pool } from '../db.js';
import { notFound, requireRole, requireSigned, type RequestContext, type Signed } from '../http.js';
import { loadMediaInfo } from '../repo/media.js';
import { loadProject, loadRole, type LoadedProject } from '../repo/projects.js';
import type { MediaInfo } from '../../domain/timeline-state.js';
import type { Role } from '../../shared/types.js';

export const ANY_ROLE: readonly Role[] = ['owner', 'editor', 'commenter'];
export const EDITORS: readonly Role[] = ['owner', 'editor'];
export const OWNER_ONLY: readonly Role[] = ['owner'];
export const APPROVERS: readonly Role[] = ['owner', 'commenter'];

export interface ProjectAccess {
  signed: Signed;
  role: Role;
  projectId: string;
}

/** A project the caller is not a member of answers 404, and only then does the role decide. */
export async function projectAccess(
  context: RequestContext,
  allowed: readonly Role[],
  projectIdParam = 'id',
): Promise<ProjectAccess> {
  const signed = requireSigned(context);
  const projectId = context.params[projectIdParam];
  const role = await loadRole(pool, projectId, signed.person.id);
  if (role === null) throw notFound();
  requireRole(role, allowed);
  return { signed, role, projectId };
}

export interface LoadedAccess extends ProjectAccess {
  loaded: LoadedProject;
  media: Map<string, MediaInfo>;
}

export async function loadedProjectAccess(
  context: RequestContext,
  allowed: readonly Role[],
  projectIdParam = 'id',
): Promise<LoadedAccess> {
  const access = await projectAccess(context, allowed, projectIdParam);
  const media = await loadMediaInfo();
  const loaded = await loadProject(pool, access.projectId, media);
  if (loaded === null) throw notFound();
  return { ...access, loaded, media };
}
