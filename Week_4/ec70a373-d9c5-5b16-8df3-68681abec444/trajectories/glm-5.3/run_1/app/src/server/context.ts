import type { Database, DbClient, Row } from './db.js';
import { clientQuery } from './db.js';
import type { KillBillClient } from './killbill.js';
import type { StorageClient } from './storage.js';
import type { Mailer } from './mailer.js';
import type { Env } from '../env.js';
import type { Role } from '../types.js';

export interface SessionUser {
  userId: string;
  tenantId: string;
  name: string;
  email: string;
  role: Role;
  siteId: string | null;
  sessionId: string;
  csrf: string;
}

export class AppContext {
  private ready = false;

  markReady(): void {
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  constructor(
    readonly db: Database,
    readonly env: Env,
    readonly killbill: KillBillClient,
    readonly storage: StorageClient,
    readonly mailer: Mailer,
  ) {}

  async withDb<T>(work: (client: DbClient) => Promise<T>): Promise<T> {
    return this.db.withTransaction(work);
  }
}

export interface SiteRecord extends Row {
  id: string;
  tenant_id: string;
  name: string;
  time_zone: string;
  address: string;
}

export async function sitesForRole(
  client: DbClient,
  user: SessionUser,
): Promise<SiteRecord[]> {
  if (user.role === 'kitchen_manager' && user.siteId) {
    return clientQuery<SiteRecord>(client, `SELECT * FROM sites WHERE id = $1 ORDER BY display_order`, [user.siteId]);
  }
  return clientQuery<SiteRecord>(client, `SELECT * FROM sites WHERE tenant_id = $1 ORDER BY display_order`, [user.tenantId]);
}

export async function visibleSite(
  client: DbClient,
  user: SessionUser,
  siteId: string,
): Promise<SiteRecord | null> {
  const rows = await clientQuery<SiteRecord>(client, `SELECT * FROM sites WHERE id = $1`, [siteId]);
  const site = rows[0];
  if (!site) return null;
  if (site.tenant_id !== user.tenantId) return null;
  if (user.role === 'kitchen_manager' && site.id !== user.siteId) return null;
  return site;
}

export interface MemberRecord extends Row {
  id: string;
  tenant_id: string;
  name: string;
  business_name: string | null;
  contact_name: string | null;
  site_id: string | null;
  coi_valid_through: string | null;
  fhc_valid_through: string | null;
  bl_valid_through: string | null;
  email: string;
}

export async function memberById(client: DbClient, memberId: string): Promise<MemberRecord | null> {
  const rows = await clientQuery<MemberRecord>(
    client,
    `SELECT id, tenant_id, name, business_name, contact_name, site_id, coi_valid_through, fhc_valid_through, bl_valid_through, email
       FROM users WHERE id = $1 AND role = 'member'`,
    [memberId],
  );
  return rows[0] ?? null;
}
