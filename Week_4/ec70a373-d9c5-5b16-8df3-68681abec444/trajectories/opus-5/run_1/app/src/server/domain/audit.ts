import { nowMs } from '../clock';
import { query, queryOne } from '../db';
import type { AuditOutcome, Role } from '../../shared/types';

export type AuditTargetType =
  | 'booking'
  | 'series'
  | 'purchase'
  | 'document'
  | 'visit'
  | 'inspector_link'
  | 'rate'
  | 'truck'
  | 'site'
  | 'session';

export interface AuditEventInput {
  actor: { user_id: string; name: string; role: Role } | null;
  subjectUserId: string | null;
  tokenSiteId: string | null;
  tokenTenantId: string | null;
  action: string;
  targetType: AuditTargetType | null;
  targetId: string | null;
  outcome: AuditOutcome;
  addressPrefix: string | null;
}

interface ScopeRow {
  tenant_id: string;
  role: Role;
  site_id: string | null;
  home_site_id: string | null;
}

async function scopeForUser(userId: string): Promise<{ tenantId: string; siteId: string | null } | null> {
  const row = await queryOne<ScopeRow>(
    `select u.tenant_id, u.role, u.site_id, m.home_site_id
       from users u left join members m on m.user_id = u.id
      where u.id = $1`,
    [userId],
  );
  if (row === null) return null;
  if (row.role === 'member') return { tenantId: row.tenant_id, siteId: row.home_site_id };
  if (row.role === 'kitchen_manager') return { tenantId: row.tenant_id, siteId: row.site_id };
  return { tenantId: row.tenant_id, siteId: null };
}

/** Appends exactly one event for a write request, whatever its answer. */
export async function appendAuditEvent(input: AuditEventInput): Promise<void> {
  let tenantId: string | null = null;
  let siteId: string | null = null;
  if (input.subjectUserId !== null) {
    const scope = await scopeForUser(input.subjectUserId);
    if (scope !== null) {
      tenantId = scope.tenantId;
      siteId = scope.siteId;
    }
  } else if (input.tokenTenantId !== null) {
    tenantId = input.tokenTenantId;
    siteId = input.tokenSiteId;
  }
  await query(
    `insert into audit_events (at, scope_tenant_id, scope_site_id, subject_user_id, actor_user_id,
       actor_name, actor_role, action, target_type, target_id, outcome, address_prefix)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      new Date(nowMs()).toISOString(),
      tenantId,
      siteId,
      input.subjectUserId,
      input.actor === null ? null : input.actor.user_id,
      input.actor === null ? null : input.actor.name,
      input.actor === null ? null : input.actor.role,
      input.action,
      input.targetType,
      input.targetId,
      input.outcome,
      input.addressPrefix,
    ],
  );
}

/** The client address with its last octet replaced by zero, or null for IPv6-only peers. */
export function addressPrefix(remoteAddress: string | undefined): string | null {
  if (remoteAddress === undefined) return null;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(remoteAddress);
  const candidate = mapped === null ? remoteAddress : (mapped[1] as string);
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(candidate)) return null;
  const parts = candidate.split('.');
  return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
}

export function clientAddress(remoteAddress: string | undefined): string | null {
  if (remoteAddress === undefined) return null;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(remoteAddress);
  return mapped === null ? remoteAddress : (mapped[1] as string);
}
