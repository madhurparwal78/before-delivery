import type { Role } from './types';

export const ROLE_HOME: Record<Role, string> = {
  owner: '/register',
  tech: '/register',
  parent: '/family',
  director: '/roster',
};

const SIGNED_IN_ROUTES: Array<{ test: RegExp; roles: Role[] }> = [
  { test: /^\/register$/, roles: ['owner', 'tech'] },
  { test: /^\/contracts\/[^/]+$/, roles: ['owner', 'tech', 'parent'] },
  { test: /^\/family$/, roles: ['parent'] },
  { test: /^\/reserve$/, roles: ['parent'] },
  { test: /^\/price-lists$/, roles: ['owner'] },
  { test: /^\/schools$/, roles: ['owner'] },
  { test: /^\/roster$/, roles: ['director', 'owner'] },
];

export function signedInRoles(path: string): Role[] | null {
  for (const route of SIGNED_IN_ROUTES) {
    if (route.test.test(path)) return route.roles;
  }
  return null;
}

export function isSignedInRoute(path: string): boolean {
  return signedInRoles(path) !== null;
}

export function isRouteOpenTo(path: string, role: Role): boolean {
  const roles = signedInRoles(path);
  return roles !== null && roles.includes(role);
}

/** Where a user lands after signing in: the requested page when it is theirs, else their role's home. */
export function landingFor(role: Role, next: string | null): string {
  if (next === null || next === '') return ROLE_HOME[role];
  if (!/^\/[^/\\]/.test(next)) return ROLE_HOME[role];
  const path = next.split('?')[0] ?? '';
  if (!isRouteOpenTo(path, role)) return ROLE_HOME[role];
  return next;
}
