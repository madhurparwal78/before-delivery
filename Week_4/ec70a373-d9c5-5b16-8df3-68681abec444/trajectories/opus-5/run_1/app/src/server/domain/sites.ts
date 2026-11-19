import { query } from '../db';
import type { SiteJson } from '../../shared/types';
import { localDateOf, localNowOf } from '../../shared/tz';

export interface SiteRecord {
  id: string;
  tenant_id: string;
  name: string;
  time_zone: string;
  address: string;
  display_order: number;
}

export async function siteById(siteId: string): Promise<SiteRecord | null> {
  const found = await query<SiteRecord>(
    'select id, tenant_id, name, time_zone, address, display_order from sites where id = $1',
    [siteId],
  );
  return found.length === 0 ? null : (found[0] as SiteRecord);
}

export async function sitesOfTenant(tenantId: string): Promise<SiteRecord[]> {
  return query<SiteRecord>(
    `select id, tenant_id, name, time_zone, address, display_order
       from sites where tenant_id = $1 order by display_order asc`,
    [tenantId],
  );
}

export function siteJson(site: SiteRecord, atMs: number): SiteJson {
  return {
    id: site.id,
    name: site.name,
    time_zone: site.time_zone,
    address: site.address,
    local_now: localNowOf(site.time_zone, atMs),
    local_date: localDateOf(site.time_zone, atMs),
  };
}
