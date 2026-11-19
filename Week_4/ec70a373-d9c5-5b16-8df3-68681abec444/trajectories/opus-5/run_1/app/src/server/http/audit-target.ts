import { isUuid } from './errors';
import type { AuditTargetType } from '../domain/audit';

const PATTERN_TARGETS: { prefix: string; param: string; type: AuditTargetType }[] = [
  { prefix: '/api/bookings/{id}', param: 'id', type: 'booking' },
  { prefix: '/api/documents/{id}', param: 'id', type: 'document' },
  { prefix: '/api/visits/{id}', param: 'id', type: 'visit' },
  { prefix: '/api/inspector-links/{id}', param: 'id', type: 'inspector_link' },
  { prefix: '/api/trucks/{truck_id}', param: 'truck_id', type: 'truck' },
  { prefix: '/api/sites/{site_id}', param: 'site_id', type: 'site' },
  { prefix: '/api/inspect/{token}', param: 'token', type: 'inspector_link' },
];

/** The record of the path's last id parameter, before a handler names what it created. */
export function defaultAuditTarget(
  pattern: string,
  params: Record<string, string>,
): { targetType: AuditTargetType | null; targetId: string | null } {
  if (pattern === '/api/session') return { targetType: 'session', targetId: null };
  for (const candidate of PATTERN_TARGETS) {
    if (!pattern.startsWith(candidate.prefix)) continue;
    const value = params[candidate.param];
    if (candidate.type === 'inspector_link' && candidate.param === 'token') {
      return { targetType: 'inspector_link', targetId: null };
    }
    return {
      targetType: candidate.type,
      targetId: value !== undefined && isUuid(value) ? value : null,
    };
  }
  return { targetType: null, targetId: null };
}
