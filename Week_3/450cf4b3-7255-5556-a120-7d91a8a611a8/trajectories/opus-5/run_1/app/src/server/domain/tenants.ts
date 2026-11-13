import { queryOne, type Db } from '../db';
import { coversDate, type CurrentDocuments } from './documents';
import type { ClearanceReason, SuspendedReason, TenantStatus } from '../../shared/types';

export interface TenantRow {
  id: string;
  business_name: string;
  contact_name: string;
  email: string;
  base_status: 'applied' | 'documents_pending' | 'approved';
  killbill_account_id: string | null;
  created_at: Date;
}

export const TENANT_COLUMNS = `id, business_name, contact_name, email, base_status, killbill_account_id, created_at`;

export interface TenantStanding {
  status: TenantStatus;
  suspendedReason: SuspendedReason | null;
}

/** Tenant status derived from the base status and the current documents. */
export function tenantStanding(
  tenant: TenantRow,
  current: CurrentDocuments,
  today: string,
): TenantStanding {
  if (tenant.base_status === 'applied') {
    const hasBoth = current.insurance !== null && current.foodHandler !== null;
    return { status: hasBoth ? 'documents_pending' : 'applied', suspendedReason: null };
  }
  if (tenant.base_status === 'documents_pending') {
    return { status: 'documents_pending', suspendedReason: null };
  }
  if (!coversDate(current.insurance, today)) {
    return { status: 'suspended', suspendedReason: 'insurance_lapsed' };
  }
  if (!coversDate(current.foodHandler, today)) {
    return { status: 'suspended', suspendedReason: 'food_handler_lapsed' };
  }
  return { status: 'approved', suspendedReason: null };
}

export interface Clearance {
  cleared: boolean;
  reason: ClearanceReason | null;
}

/** Whether a tenant is cleared for the floor on one kitchen date. */
export function clearanceFor(
  standing: TenantStanding,
  current: CurrentDocuments,
  date: string,
): Clearance {
  if (standing.status !== 'approved' && standing.status !== 'suspended') {
    return { cleared: false, reason: 'not_approved' };
  }
  if (!coversDate(current.insurance, date)) {
    return { cleared: false, reason: 'insurance_lapsed' };
  }
  if (!coversDate(current.foodHandler, date)) {
    return { cleared: false, reason: 'food_handler_lapsed' };
  }
  return { cleared: true, reason: null };
}

export async function tenantById(client: Db, tenantId: string): Promise<TenantRow | null> {
  return queryOne<TenantRow>(client, `select ${TENANT_COLUMNS} from tenants where id = $1`, [tenantId]);
}
