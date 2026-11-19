import { refuse } from './errors.js';
import type { Role } from './model.js';

/** What a route needs: reading, changing the workspace, or owner-only work. */
export type Access = 'read' | 'write' | 'owner';

/** The one place a role is weighed against an access level. */
export function authorize(role: Role, access: Access): void {
  if (access === 'read' || role === 'owner') return;
  if (role === 'viewer') throw refuse.viewer();
  if (access === 'owner') throw refuse.ownerOnly();
}
