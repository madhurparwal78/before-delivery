import type { Role, Tag } from './domain';

/** Where a column's PII / Confidential sample shows raw or masked, by the caller's role. */
export const MASK_TABLE: Readonly<Record<Role, { none: 'raw' | 'masked'; confidentialOnly: 'raw' | 'masked'; pii: 'raw' | 'masked' }>> = {
  Admin: { none: 'raw', confidentialOnly: 'raw', pii: 'raw' },
  Steward: { none: 'raw', confidentialOnly: 'raw', pii: 'raw' },
  Analyst: { none: 'raw', confidentialOnly: 'raw', pii: 'masked' },
  Viewer: { none: 'raw', confidentialOnly: 'masked', pii: 'masked' },
};

export function maskDecision(role: Role, effectiveTags: readonly Tag[]): 'raw' | 'masked' {
  const row = MASK_TABLE[role];
  if (effectiveTags.includes('PII')) return row.pii;
  if (effectiveTags.includes('Confidential')) return row.confidentialOnly;
  return row.none;
}

export const WRITE_ROLES: readonly Role[] = ['Steward', 'Admin'];
export const CERT_ROLES: readonly Role[] = ['Steward', 'Admin'];
export const DOWNLOAD_ROLES: readonly Role[] = ['Admin', 'Steward', 'Analyst'];
export const TRACE_ROLES: readonly Role[] = ['Steward', 'Admin'];

export function canWrite(role: Role): boolean {
  return (WRITE_ROLES as readonly string[]).includes(role);
}
export function canCertify(role: Role): boolean {
  return (CERT_ROLES as readonly string[]).includes(role);
}
export function canDownloadEvidence(role: Role): boolean {
  return (DOWNLOAD_ROLES as readonly string[]).includes(role);
}
export function canTrace(role: Role): boolean {
  return (TRACE_ROLES as readonly string[]).includes(role);
}
export function isAdmin(role: Role): boolean {
  return role === 'Admin';
}
