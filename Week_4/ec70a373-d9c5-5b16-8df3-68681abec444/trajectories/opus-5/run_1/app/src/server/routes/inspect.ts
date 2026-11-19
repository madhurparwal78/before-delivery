import { iso, isoOrNull, nowMs } from '../clock';
import { query } from '../db';
import { ApiError } from '../http/errors';
import type { HandlerResult, RequestContext } from '../http/context';
import { linkState } from '../domain/rules';
import { visitLog } from '../domain/visits';
import { getObject } from '../services/s3';
import type { InspectJson } from '../../shared/types';

interface TokenRow {
  id: string;
  truck_id: string;
  tenant_id: string;
  site_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  storage_key: string;
  truck_name: string;
  permit_number: string;
  business_name: string;
  site_name: string;
  site_address: string;
  time_zone: string;
}

async function linkByToken(token: string): Promise<TokenRow> {
  const rows = await query<TokenRow>(
    `select il.id, il.truck_id, il.tenant_id, il.site_id, il.expires_at, il.revoked_at,
            il.storage_key, t.name as truck_name, t.permit_number, m.business_name,
            s.name as site_name, s.address as site_address, s.time_zone
       from inspector_links il
       join trucks t on t.id = il.truck_id
       join members m on m.id = t.member_id
       join sites s on s.id = il.site_id
      where il.token = $1`,
    [token],
  );
  const row = rows[0];
  if (row === undefined) throw new ApiError('not_found');
  const state = linkState(
    row.expires_at.getTime(),
    row.revoked_at === null ? null : row.revoked_at.getTime(),
    nowMs(),
  );
  if (state === 'revoked') throw new ApiError('link_revoked');
  if (state === 'expired') throw new ApiError('link_expired');
  return row;
}

export async function getInspect(ctx: RequestContext): Promise<HandlerResult> {
  const link = await linkByToken(ctx.params.token as string);
  ctx.audit.tokenTenantId = link.tenant_id;
  ctx.audit.tokenSiteId = link.site_id;
  const log = await visitLog(link.truck_id, nowMs());
  const body: InspectJson = {
    truck: { name: link.truck_name, permit_number: link.permit_number },
    operator: { business_name: link.business_name },
    commissary: {
      site_name: link.site_name,
      address: link.site_address,
      time_zone: link.time_zone,
    },
    expires_at: iso(link.expires_at),
    overdue: log.overdue,
    last_departed_at: isoOrNull(log.lastDepartedAtMs),
    visits: log.visits.map((visit) => ({
      arrived_at: visit.arrived_at,
      departed_at: visit.departed_at,
      services: visit.services,
      operator_signature: visit.operator_signature,
      manager_name: visit.manager_name,
      gap_hours: visit.gap_hours,
      gap_flagged: visit.gap_flagged,
    })),
  };
  return { status: 200, body };
}

export async function getInspectPdf(ctx: RequestContext): Promise<HandlerResult> {
  const link = await linkByToken(ctx.params.token as string);
  ctx.audit.tokenTenantId = link.tenant_id;
  ctx.audit.tokenSiteId = link.site_id;
  let bytes: Buffer;
  try {
    bytes = await getObject(link.storage_key);
  } catch {
    throw new ApiError('storage_unavailable');
  }
  return {
    status: 200,
    raw: bytes,
    contentType: 'application/pdf',
    headers: {
      'Content-Length': String(bytes.length),
      'Content-Disposition': `attachment; filename="commissary-visits.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  };
}

export async function inspectReadOnly(): Promise<HandlerResult> {
  throw new ApiError('read_only', { headers: { Allow: 'GET' } });
}
