import type { TenantStatus } from './constants.js';
import { missingRequiredKinds } from './documents.js';
import type { DocumentRecord, TenantRecord } from './types.js';

/**
 * The active/suspended pair is derived at every request from current document validity;
 * the other states are the stored ones.
 */
export function effectiveTenantStatus(
  tenant: TenantRecord,
  documents: readonly DocumentRecord[],
  today: string,
): TenantStatus {
  if (tenant.storedStatus !== 'active' && tenant.storedStatus !== 'suspended') {
    return tenant.storedStatus;
  }
  return missingRequiredKinds(documents, today).length === 0 ? 'active' : 'suspended';
}
