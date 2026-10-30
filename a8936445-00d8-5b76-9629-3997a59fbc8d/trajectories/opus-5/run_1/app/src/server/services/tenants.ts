import { errors } from '../http/errors.js';
import { listDocuments } from '../db/repo/documents.js';
import { listShelves } from '../db/repo/catalog.js';
import { balanceMinutes } from '../db/repo/ledger.js';
import {
  findTenant,
  listTenants,
  setTenantKillbillAccount,
  setTenantStatus,
} from '../db/repo/tenants.js';
import { tenantHasOpenBookings } from '../db/repo/bookings.js';
import { recordStateChange } from '../db/repo/audit.js';
import { pool } from '../db/pool.js';
import { ensureAccount } from '../providers/killbill.js';
import { missingRequiredKinds, requiredDocumentStates } from '../domain/documents.js';
import { effectiveTenantStatus } from '../domain/tenantStatus.js';
import { kitchenToday } from '../domain/time.js';
import type { TenantStatus } from '../domain/constants.js';
import type { TenantRecord } from '../domain/types.js';

export interface TenantView {
  id: string;
  business_name: string;
  status: TenantStatus;
  owner_name: string;
  owner_email: string;
  required_documents: Record<string, { valid: boolean; expires_on: string | null }>;
  shelves: string[];
  hour_balance_minutes: number;
}

export async function tenantView(tenant: TenantRecord, today: string): Promise<TenantView> {
  const documents = await listDocuments(tenant.id);
  const shelves = await listShelves();
  return {
    id: tenant.id,
    business_name: tenant.businessName,
    status: effectiveTenantStatus(tenant, documents, today),
    owner_name: tenant.ownerName,
    owner_email: tenant.ownerEmail,
    required_documents: requiredDocumentStates(documents, today),
    shelves: shelves.filter((shelf) => shelf.tenantId === tenant.id).map((shelf) => shelf.id),
    hour_balance_minutes: await balanceMinutes(tenant.id),
  };
}

export async function tenantStatusOf(tenant: TenantRecord, today = kitchenToday()): Promise<TenantStatus> {
  const documents = await listDocuments(tenant.id);
  return effectiveTenantStatus(tenant, documents, today);
}

export async function requireTenant(id: string): Promise<TenantRecord> {
  const tenant = await findTenant(id);
  if (!tenant) throw errors.notFound();
  return tenant;
}

export async function visibleTenants(scopeTenantId: string | null): Promise<TenantRecord[]> {
  if (scopeTenantId === null) return listTenants();
  const tenant = await findTenant(scopeTenantId);
  return tenant ? [tenant] : [];
}

export async function activateTenant(
  tenantId: string,
  actorUserId: string,
): Promise<TenantRecord> {
  const tenant = await requireTenant(tenantId);
  if (tenant.storedStatus !== 'documents_review') {
    throw errors.conflict('invalid_transition', 'This tenant cannot be activated from its current state.');
  }
  const today = kitchenToday();
  const documents = await listDocuments(tenantId);
  const missing = missingRequiredKinds(documents, today);
  if (missing.length > 0) {
    throw errors.conflict('documents_incomplete', 'Required documents are missing or invalid.', {
      missing,
    });
  }
  await setTenantStatus(tenantId, 'active');
  await recordStateChange(pool, {
    actorUserId,
    entity: 'tenant',
    entityId: tenantId,
    fromState: tenant.storedStatus,
    toState: 'active',
  });
  return requireTenant(tenantId);
}

export async function offboardTenant(tenantId: string, actorUserId: string): Promise<TenantRecord> {
  const tenant = await requireTenant(tenantId);
  const status = await tenantStatusOf(tenant);
  if (status !== 'active' && status !== 'suspended') {
    throw errors.conflict('invalid_transition', 'This tenant cannot be offboarded from its current state.');
  }
  if (await tenantHasOpenBookings(tenantId, new Date())) {
    throw errors.conflict('open_bookings', 'This tenant still has open bookings.');
  }
  await setTenantStatus(tenantId, 'offboarded');
  await recordStateChange(pool, {
    actorUserId,
    entity: 'tenant',
    entityId: tenantId,
    fromState: status,
    toState: 'offboarded',
  });
  return requireTenant(tenantId);
}

/** The tenant's Kill Bill account, created on first use. */
export async function billingAccountFor(tenant: TenantRecord): Promise<string> {
  if (tenant.killbillAccountId) return tenant.killbillAccountId;
  const accountId = await ensureAccount(tenant.id, tenant.businessName);
  await setTenantKillbillAccount(tenant.id, accountId);
  return accountId;
}
