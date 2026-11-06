import type { Role } from './types';

export const ROLE_HOME: Record<Role, string> = {
  concierge: '/bays',
  care_technician: '/round',
  workshop_lead: '/jobs',
  house_manager: '/board',
  owner: '/portal',
};

export function isStaffRole(role: Role): boolean {
  return role !== 'owner';
}

/** The house, as owners see any staff actor. */
export const HOUSE_ACTOR = { id: 'house', name: 'Marrow & Lark Motor House' } as const;

export const HOUSE_NAME = 'Marrow & Lark Motor House';
