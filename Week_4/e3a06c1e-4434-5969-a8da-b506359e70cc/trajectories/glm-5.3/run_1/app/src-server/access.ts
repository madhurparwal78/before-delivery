// The permission table and project visibility, in exactly one place.

import type { Role } from '../src-shared/protocol';
import type { Db } from './db';
import { errors } from './errors';
import type { SessionMember } from './auth';

export type Action =
  | 'readProfile'
  | 'listProjects'
  | 'createProjects'
  | 'manageMembers'
  | 'managePlan'
  | 'listKeys'
  | 'manageKeys'
  | 'runSessions'
  | 'viewSessions'
  | 'searchSessions'
  | 'listCorrections'
  | 'editCorrections'
  | 'decideCorrections'
  | 'readUsage';

const PERMISSIONS: Record<Action, Role[]> = {
  readProfile: ['admin', 'developer', 'reviewer', 'approver', 'billing'],
  listProjects: ['admin', 'developer', 'reviewer', 'approver', 'billing'],
  createProjects: ['admin'],
  manageMembers: ['admin'],
  managePlan: ['admin'],
  listKeys: ['admin', 'developer'],
  manageKeys: ['admin', 'developer'],
  runSessions: ['admin', 'developer'],
  viewSessions: ['admin', 'developer', 'reviewer', 'approver'],
  searchSessions: ['admin', 'developer', 'reviewer', 'approver'],
  listCorrections: ['admin', 'developer', 'reviewer', 'approver'],
  editCorrections: ['reviewer', 'approver'],
  decideCorrections: ['approver'],
  readUsage: ['admin', 'billing'],
};

export function allowed(role: Role, action: Action): boolean {
  return PERMISSIONS[action].includes(role);
}

export function requireAction(member: SessionMember, action: Action): void {
  if (!allowed(member.role, action)) throw errors.forbidden();
}

/** Landing route per role after sign-in (DP-05). */
export function landingRoute(role: Role): string {
  return role === 'billing' ? '/console/usage' : '/console/projects';
}

/** Billing viewers never receive transcript text or audio. */
export function canSeeTranscripts(role: Role): boolean {
  return role !== 'billing';
}

/** Visible project ids for a member. Admins and billing viewers see all their organisation's. */
export async function visibleProjectIds(db: Db, member: SessionMember): Promise<string[]> {
  if (member.project_ids === 'all') {
    const { rows } = await db.query('SELECT id FROM projects WHERE org_id = $1', [member.org_id]);
    return rows.map((r: { id: string }) => String(r.id));
  }
  return member.project_ids;
}

/** Throws 404 not_found for anything outside the caller's visible projects (DP-09). */
export async function requireProjectVisible(db: Db, member: SessionMember, projectId: string): Promise<{ id: string; org_id: string; name: string; monthly_quota_minutes: number }> {
  const { rows } = await db.query('SELECT id, org_id, name, monthly_quota_minutes FROM projects WHERE id = $1', [projectId]);
  if (rows.length === 0 || String(rows[0].org_id) !== member.org_id) throw errors.notFound();
  if (member.project_ids !== 'all' && !member.project_ids.includes(projectId)) throw errors.notFound();
  return { id: String(rows[0].id), org_id: String(rows[0].org_id), name: rows[0].name, monthly_quota_minutes: rows[0].monthly_quota_minutes };
}

/** Checks that every id in a list belongs to the caller's organisation (404 otherwise). */
export async function requireProjectsInOrg(db: Db, member: SessionMember, projectIds: string[]): Promise<string[]> {
  if (projectIds.length === 0) return [];
  const { rows } = await db.query('SELECT id FROM projects WHERE org_id = $1 AND id = ANY($2::uuid[])', [member.org_id, projectIds]);
  if (rows.length !== projectIds.length) throw errors.notFound();
  return rows.map((r: { id: string }) => String(r.id));
}
