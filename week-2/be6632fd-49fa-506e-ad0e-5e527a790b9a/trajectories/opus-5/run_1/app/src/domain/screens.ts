export const ROLES = [
  'launch_producer',
  'merchandiser',
  'finance_lead',
  'press_lead',
  'stockist_buyer',
] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export const ROLE_LABELS: Record<Role, string> = {
  launch_producer: 'Launch producer',
  merchandiser: 'Merchandiser',
  finance_lead: 'Finance lead',
  press_lead: 'Press lead',
  stockist_buyer: 'Stockist buyer',
};

export const ROLE_HOME: Record<Role, string> = {
  launch_producer: '/studio/drops',
  merchandiser: '/studio/drops',
  finance_lead: '/studio/invoicing',
  press_lead: '/studio/press',
  stockist_buyer: '/studio/my-store',
};

const STAFF_ROLES: readonly Role[] = ['launch_producer', 'merchandiser', 'finance_lead', 'press_lead'];

/** The roles each staff screen is for; the first matching rule decides. */
const SCREEN_ROLES: ReadonlyArray<{ pattern: RegExp; roles: readonly Role[] }> = [
  { pattern: /^\/studio\/my-store$/, roles: ['stockist_buyer'] },
  { pattern: /^\/studio\/allocations\/[^/]+$/, roles: [...STAFF_ROLES, 'stockist_buyer'] },
  { pattern: /^\/studio\/drops\/new$/, roles: ['launch_producer'] },
  { pattern: /^\/studio\/members$/, roles: STAFF_ROLES },
  { pattern: /^\/studio\/price-lists$/, roles: ['finance_lead', 'merchandiser'] },
];

/** Whether a role may open a staff screen, used for navigation and for the sign-in `next` value. */
export function canUseScreen(role: Role, path: string): boolean {
  if (!path.startsWith('/studio/')) return false;
  const rule = SCREEN_ROLES.find((candidate) => candidate.pattern.test(path));
  return rule === undefined ? STAFF_ROLES.includes(role) : rule.roles.includes(role);
}

/**
 * The screen sign-in lands on: the `next` value when it is a staff screen path on this site that
 * the member's role may use, and the role's home screen for anything else.
 */
export function landingFor(role: Role, next: string | null): string {
  if (next === null || next === '') return ROLE_HOME[role];
  const [path] = next.split('?');
  if (path === undefined || !path.startsWith('/studio/') || path.startsWith('//')) {
    return ROLE_HOME[role];
  }
  if (/[\s:\\]/.test(path)) return ROLE_HOME[role];
  return canUseScreen(role, path) ? next : ROLE_HOME[role];
}
