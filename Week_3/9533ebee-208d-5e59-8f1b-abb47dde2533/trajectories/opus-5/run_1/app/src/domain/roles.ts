/** The five member roles. Each member has exactly one. */

export const ROLES = [
  'risk_steward',
  'liquidity_provider',
  'borrower',
  'trader',
  'liquidator',
] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
