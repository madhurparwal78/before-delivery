import type { Role, User, UserStatus } from '../../shared/api';

export interface UserRow {
  id: string;
  workspace_id: string;
  name: string;
  handle: string;
  email: string;
  role: Role;
  status: UserStatus;
}

export interface Viewer {
  id: string;
  workspaceId: string;
  role: Role;
}

/**
 * The one email projection: a person's email reaches operations managers and
 * the person themself, and nobody else, in every response and every event.
 */
export function projectUser(row: UserRow, viewer: Viewer): User {
  const base: User = {
    id: row.id,
    name: row.name,
    handle: row.handle,
    role: row.role,
    status: row.status,
  };
  if (viewer.role === 'ops_manager' || viewer.id === row.id) {
    return { ...base, email: row.email };
  }
  return base;
}

export const MANAGEMENT_ROLES: readonly Role[] = ['crew_lead', 'dispatcher', 'ops_manager'];

export function canModerate(role: Role): boolean {
  return MANAGEMENT_ROLES.includes(role);
}

export function canSchedule(role: Role): boolean {
  return role === 'dispatcher' || role === 'ops_manager';
}

export function isOpsManager(role: Role): boolean {
  return role === 'ops_manager';
}
