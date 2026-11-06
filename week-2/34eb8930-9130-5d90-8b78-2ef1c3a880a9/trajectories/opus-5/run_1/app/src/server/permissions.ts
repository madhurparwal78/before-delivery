import type { Mode, Role } from '../shared/types.js';

export type Capability =
  | 'read'
  | 'comment'
  | 'suggest'
  | 'edit'
  | 'decide'
  | 'own';

const TABLE: Record<Role, ReadonlySet<Capability>> = {
  viewer: new Set<Capability>(['read']),
  commenter: new Set<Capability>(['read', 'comment', 'suggest']),
  editor: new Set<Capability>(['read', 'comment', 'suggest', 'edit', 'decide']),
  owner: new Set<Capability>(['read', 'comment', 'suggest', 'edit', 'decide', 'own']),
};

/** The one place the role permission table is decided. */
export function can(role: Role, capability: Capability): boolean {
  return TABLE[role].has(capability);
}

export function modeAllowed(role: Role, mode: Mode): boolean {
  if (mode === 'viewing') return true;
  if (mode === 'suggesting') return can(role, 'suggest');
  return can(role, 'edit');
}

export function defaultMode(role: Role): Mode {
  if (can(role, 'edit')) return 'editing';
  if (can(role, 'suggest')) return 'suggesting';
  return 'viewing';
}

/** The mode a person keeps after a role change. */
export function modeForRole(role: Role, mode: Mode): Mode {
  return modeAllowed(role, mode) ? mode : defaultMode(role);
}
