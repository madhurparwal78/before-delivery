/** Roles, their precedence and the role-to-screen table. */

export const roleKeys = ['operator', 'technician', 'requester', 'approver', 'manager'] as const;

export type RoleKey = (typeof roleKeys)[number];

export function isRoleKey(value: string): value is RoleKey {
  return (roleKeys as readonly string[]).includes(value);
}

/** A person's home screen is the home of their first role in this precedence. */
export const rolePrecedence: readonly RoleKey[] = ['operator', 'technician', 'approver', 'manager', 'requester'];

const homeScreens: Readonly<Record<RoleKey, string>> = {
  operator: '/desk',
  technician: '/desk',
  approver: '/approve',
  manager: '/portal',
  requester: '/portal',
};

export function homeScreen(roles: readonly RoleKey[]): string {
  for (const role of rolePrecedence) {
    if (roles.includes(role)) return homeScreens[role];
  }
  return '/portal';
}

/** Operator and technician together. */
export const deskRoles: readonly RoleKey[] = ['operator', 'technician'];

export function isDeskRole(roles: readonly RoleKey[]): boolean {
  return roles.some((r) => deskRoles.includes(r));
}

export function hasAnyRole(roles: readonly RoleKey[], allowed: readonly RoleKey[]): boolean {
  return roles.some((r) => allowed.includes(r));
}

/**
 * Screens and the roles that may open them. A person may open every screen any
 * one of their roles may open. Paths are matched by the patterns below.
 */
export interface ScreenRule {
  readonly pattern: RegExp;
  readonly roles: readonly RoleKey[] | 'anyone';
}

export const screenRules: readonly ScreenRule[] = [
  { pattern: /^\/$/, roles: 'anyone' },
  { pattern: /^\/login$/, roles: 'anyone' },
  { pattern: /^\/portal(\/.*)?$/, roles: roleKeys },
  { pattern: /^\/inbox$/, roles: roleKeys },
  { pattern: /^\/desk$/, roles: ['operator', 'technician', 'approver', 'manager'] },
  { pattern: /^\/desk\/lists\/[^/]+$/, roles: ['operator', 'technician', 'approver', 'manager'] },
  { pattern: /^\/desk\/records\/new\/(incident|problem|task)$/, roles: ['operator', 'technician'] },
  { pattern: /^\/desk\/records\/new\/change$/, roles: ['operator'] },
  { pattern: /^\/desk\/records\/[^/]+$/, roles: ['operator', 'technician', 'approver', 'manager'] },
  { pattern: /^\/desk\/map$/, roles: ['operator', 'technician', 'manager'] },
  { pattern: /^\/desk\/major\/[^/]+$/, roles: ['operator', 'technician', 'manager'] },
  { pattern: /^\/desk\/changes\/calendar$/, roles: ['operator', 'technician', 'approver'] },
  { pattern: /^\/desk\/boards\/[^/]+$/, roles: ['operator', 'technician', 'approver'] },
  { pattern: /^\/approve$/, roles: ['operator', 'approver'] },
  { pattern: /^\/desk\/oncall$/, roles: ['operator', 'technician'] },
  { pattern: /^\/pages$/, roles: ['operator', 'technician'] },
  { pattern: /^\/desk\/runs\/[^/]+$/, roles: ['operator', 'technician'] },
  { pattern: /^\/desk\/dashboards\/[^/]+$/, roles: ['operator', 'technician'] },
  { pattern: /^\/desk\/exports$/, roles: ['operator', 'technician', 'manager'] },
  { pattern: /^\/dashboards\/[^/]+$/, roles: ['operator', 'manager'] },
  { pattern: /^\/desk\/workflows\/[^/]+$/, roles: ['operator'] },
  { pattern: /^\/desk\/admin\/[^/]+$/, roles: ['operator'] },
  { pattern: /^\/desk\/config-sets$/, roles: ['operator'] },
  { pattern: /^\/desk\/imports$/, roles: ['operator'] },
];

export type ScreenOutcome =
  | { readonly kind: 'public' }
  | { readonly kind: 'allowed' }
  | { readonly kind: 'redirect' }
  | { readonly kind: 'not_found' };

/** Decides what a visitor gets for a path. */
export function screenOutcome(path: string, roles: readonly RoleKey[] | null): ScreenOutcome {
  const rule = screenRules.find((r) => r.pattern.test(path));
  if (!rule) return { kind: 'not_found' };
  if (rule.roles === 'anyone') return { kind: 'public' };
  if (roles === null) return { kind: 'redirect' };
  return hasAnyRole(roles, rule.roles) ? { kind: 'allowed' } : { kind: 'not_found' };
}
