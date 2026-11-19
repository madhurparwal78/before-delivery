import type { Role } from './types.js';

export type Capability = 'view' | 'comment' | 'edit' | 'lock' | 'manage' | 'see_restricted';

/** The one published permission table. */
const TABLE: Record<Capability, readonly Role[]> = {
  view: ['owner', 'editor', 'commenter', 'viewer'],
  comment: ['owner', 'editor', 'commenter'],
  edit: ['owner', 'editor'],
  lock: ['owner', 'editor'],
  manage: ['owner'],
  see_restricted: ['owner', 'editor'],
};

export function can(role: Role, capability: Capability): boolean {
  return TABLE[capability].includes(role);
}

export const ROLE_NAMES: readonly Role[] = ['owner', 'editor', 'commenter', 'viewer'];

/** The three roles a share link or an invitation may grant. */
export const GRANTABLE_ROLES: readonly Role[] = ['editor', 'commenter', 'viewer'];

export function isGrantableRole(value: unknown): value is Exclude<Role, 'owner'> {
  return typeof value === 'string' && (GRANTABLE_ROLES as readonly string[]).includes(value);
}

/** The three checklist lines shown for each role in the share dialog. */
export const ROLE_CHECKLIST: Record<Role, readonly [string, string, string]> = {
  owner: [
    'Share the map, manage roles and links',
    'Restore versions and present the map',
    'Lock and restrict any branch',
  ],
  editor: [
    'Add, rename, move and delete topics',
    'Import, export, paste and attach images',
    'Lock a branch and see restricted branches',
  ],
  commenter: [
    'Read the map, outline and history',
    'Comment, reply, resolve and vote',
    'Cannot change the map or see restricted branches',
  ],
  viewer: [
    'Read the map, outline and history',
    'Collapse branches and find topics',
    'Cannot comment, vote or change the map',
  ],
};

/** Who may unlock a branch locked by someone else. */
export function canUnlock(role: Role, username: string, locker: string | null): boolean {
  if (role === 'owner') return true;
  return can(role, 'lock') && locker !== null && locker === username;
}
