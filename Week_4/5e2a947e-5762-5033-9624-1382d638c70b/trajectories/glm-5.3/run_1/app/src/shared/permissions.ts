import type { Role } from './types.js';

/**
 * The permission table: the one definition of what each role may do.
 * Refusals for a role return 403 forbidden.
 */

export type Capability =
  | 'view' | 'comment' | 'vote' | 'edit' | 'lock' | 'unlock_own' | 'unlock_any'
  | 'restore' | 'restrict' | 'manage' | 'present' | 'delete_map' | 'see_restricted' | 'save_version' | 'import' | 'attach' | 'paste';

const TABLE: Record<Role, Capability[]> = {
  owner: ['view', 'comment', 'vote', 'edit', 'lock', 'unlock_own', 'unlock_any', 'restore', 'restrict', 'manage', 'present', 'delete_map', 'see_restricted', 'save_version', 'import', 'attach', 'paste'],
  editor: ['view', 'comment', 'vote', 'edit', 'lock', 'unlock_own', 'see_restricted', 'save_version', 'import', 'attach', 'paste'],
  commenter: ['view', 'comment', 'vote'],
  viewer: ['view'],
};

/** Does the role hold the capability? The single decision point. */
export function may(role: Role, cap: Capability): boolean {
  return TABLE[role].includes(cap);
}

export const EDITING_CAPS: Capability[] = ['edit', 'import', 'paste', 'attach', 'save_version', 'lock'];
