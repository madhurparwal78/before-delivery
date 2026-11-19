export type Role = 'owner' | 'front_desk' | 'housekeeper';

const ROLES: Role[] = ['owner', 'front_desk', 'housekeeper'];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as string[]).includes(value);
}

export const DESK_ROLES: Role[] = ['owner', 'front_desk'];
export const BOARD_ROLES: Role[] = ['owner', 'front_desk', 'housekeeper'];
export const OWNER_ONLY: Role[] = ['owner'];

export type AppRoute = '/desk' | '/board' | '/guests' | '/rates' | '/reports';

export const routeRoles: Record<AppRoute, Role[]> = {
  '/desk': DESK_ROLES,
  '/board': BOARD_ROLES,
  '/guests': DESK_ROLES,
  '/rates': OWNER_ONLY,
  '/reports': OWNER_ONLY,
};

export function homeRouteFor(role: Role): AppRoute {
  return role === 'housekeeper' ? '/board' : '/desk';
}

export function mayOpen(role: Role, route: AppRoute): boolean {
  return routeRoles[route].includes(role);
}
