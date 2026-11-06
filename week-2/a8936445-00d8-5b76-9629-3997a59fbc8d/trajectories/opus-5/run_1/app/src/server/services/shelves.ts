import { errors } from '../http/errors.js';
import { findShelf, listShelves, setShelfTenant } from '../db/repo/catalog.js';
import { listTenants } from '../db/repo/tenants.js';
import { recordStateChange } from '../db/repo/audit.js';
import { pool } from '../db/pool.js';
import type { ShelfRecord } from '../domain/types.js';
import { requireTenant, tenantStatusOf } from './tenants.js';

export interface ShelfView {
  id: string;
  name: string;
  monthly_rate_cents: number;
  tenant_id: string | null;
  tenant_name: string | null;
}

export async function shelfViews(scopeTenantId: string | null): Promise<ShelfView[]> {
  const shelves = await listShelves();
  const tenants = new Map((await listTenants()).map((tenant) => [tenant.id, tenant.businessName]));
  return shelves
    .filter((shelf) => scopeTenantId === null || shelf.tenantId === scopeTenantId)
    .map((shelf) => toView(shelf, tenants));
}

function toView(shelf: ShelfRecord, tenants: ReadonlyMap<string, string>): ShelfView {
  return {
    id: shelf.id,
    name: shelf.name,
    monthly_rate_cents: shelf.monthlyRateCents,
    tenant_id: shelf.tenantId,
    tenant_name: shelf.tenantId ? (tenants.get(shelf.tenantId) ?? null) : null,
  };
}

export async function assignShelf(
  actorUserId: string,
  shelfId: string,
  tenantId: string | null,
): Promise<ShelfView> {
  const shelf = await findShelf(shelfId);
  if (!shelf) throw errors.notFound();
  if (tenantId !== null) {
    const tenant = await requireTenant(tenantId);
    if ((await tenantStatusOf(tenant)) !== 'active') {
      throw errors.conflict('tenant_not_active', 'Only active tenants can rent a shelf.');
    }
  }
  await setShelfTenant(shelfId, tenantId);
  await recordStateChange(pool, {
    actorUserId,
    entity: 'shelf',
    entityId: shelfId,
    fromState: shelf.tenantId,
    toState: tenantId ?? 'unassigned',
  });
  const tenants = new Map((await listTenants()).map((tenant) => [tenant.id, tenant.businessName]));
  return toView((await findShelf(shelfId))!, tenants);
}
