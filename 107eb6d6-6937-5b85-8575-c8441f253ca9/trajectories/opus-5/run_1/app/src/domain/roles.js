import { forbidden } from './errors.js';

export const canDispatch = (member) => member.role === 'dispatcher' || member.role === 'admin';
export const isAdmin = (member) => member.role === 'admin';
export const isTourManager = (member) => member.role === 'tour_manager';

/** The one role gate: every endpoint, page and fragment passes through it. */
export function requireRole(member, allowed) {
  if (!allowed(member)) throw forbidden();
}
