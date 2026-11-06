import { ERRORS } from '../errors.ts';
import type { Viewer } from '../context.ts';

/**
 * Role enforcement — always called after visibility (404) checks.
 */
export function requireRole(viewer: Viewer, roles: string[]): void {
  if (!roles.includes(viewer.role)) {
    throw ERRORS.forbidden();
  }
}

export const STAFF = ['concierge', 'care_technician', 'workshop_lead', 'house_manager'];
export const CONCIERGE = ['concierge', 'house_manager'];
export const TECHNICIAN = ['care_technician', 'house_manager'];
export const WORKSHOP = ['workshop_lead', 'house_manager'];
export const MANAGER = ['house_manager'];
