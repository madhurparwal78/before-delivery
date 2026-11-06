import { pool, type Queryable } from '../pool.js';
import type { TenantStatus } from '../../domain/constants.js';
import type { TenantRecord } from '../../domain/types.js';

interface TenantRow {
  id: string;
  business_name: string;
  owner_name: string;
  owner_email: string;
  status: TenantStatus;
  killbill_account_id: string | null;
}

function toTenant(row: TenantRow): TenantRecord {
  return {
    id: row.id,
    businessName: row.business_name,
    ownerName: row.owner_name,
    ownerEmail: row.owner_email,
    storedStatus: row.status,
    killbillAccountId: row.killbill_account_id,
  };
}

export async function listTenants(db: Queryable = pool): Promise<TenantRecord[]> {
  const result = await db.query<TenantRow>('SELECT * FROM tenants ORDER BY business_name');
  return result.rows.map(toTenant);
}

export async function findTenant(id: string, db: Queryable = pool): Promise<TenantRecord | null> {
  const result = await db.query<TenantRow>('SELECT * FROM tenants WHERE id = $1', [id]);
  const row = result.rows[0];
  return row ? toTenant(row) : null;
}

export async function setTenantStatus(
  id: string,
  status: TenantStatus,
  db: Queryable = pool,
): Promise<void> {
  await db.query('UPDATE tenants SET status = $2 WHERE id = $1', [id, status]);
}

export async function setTenantKillbillAccount(id: string, accountId: string): Promise<void> {
  await pool.query('UPDATE tenants SET killbill_account_id = $2 WHERE id = $1', [id, accountId]);
}
