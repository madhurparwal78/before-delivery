import type { Queryable } from '../db/pool.js';

export type StaffRole = 'editor' | 'approver' | 'recruiter' | 'administrator';

export const STAFF_ROLES: readonly StaffRole[] = [
  'editor',
  'approver',
  'recruiter',
  'administrator',
];

export const ROLE_LABELS: Readonly<Record<StaffRole, string>> = {
  editor: 'Editor',
  approver: 'Approver',
  recruiter: 'Recruiter',
  administrator: 'Administrator',
};

export function isStaffRole(value: string): value is StaffRole {
  return STAFF_ROLES.includes(value as StaffRole);
}

export type GrantStatus = 'active' | 'expired' | 'revoked';

export function grantStatus(
  grant: { readonly revoked_at: Date | null; readonly expires_at: Date },
  now: Date = new Date(),
): GrantStatus {
  if (grant.revoked_at !== null) return 'revoked';
  return grant.expires_at.getTime() <= now.getTime() ? 'expired' : 'active';
}

export type ActiveGrant = { readonly role: StaffRole; readonly expires_at: Date };

/** The grants a staff account holds at this moment. */
export async function activeGrants(tx: Queryable, email: string): Promise<ActiveGrant[]> {
  const result = await tx.query<{ role: StaffRole; expires_at: Date }>(
    `SELECT role, expires_at FROM role_grants
      WHERE staff_email = $1 AND revoked_at IS NULL AND expires_at > now()
      ORDER BY role`,
    [email],
  );
  return result.rows;
}
