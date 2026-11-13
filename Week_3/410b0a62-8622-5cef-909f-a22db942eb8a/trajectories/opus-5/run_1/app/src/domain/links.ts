import type { LinkStatus } from './types.js';

export const LINK_CONFLICTS = {
  already_linked: 'You are already linked with this coach.',
  already_requested: 'You already have a pending request with this coach.',
  expired: 'This request has expired. Ask the athlete to send a new one.',
  not_pending: 'This request is no longer pending.',
} as const;

export type LinkConflict = keyof typeof LINK_CONFLICTS;

/** A requested link past its expiry reports as expired. */
export function effectiveStatus(
  status: Exclude<LinkStatus, 'expired'>,
  expiresAt: Date,
  now: Date,
): LinkStatus {
  return status === 'requested' && now.getTime() >= expiresAt.getTime() ? 'expired' : status;
}

export function pendingDecisionConflict(status: LinkStatus): LinkConflict | null {
  if (status === 'requested') return null;
  return status === 'expired' ? 'expired' : 'not_pending';
}

export function requestConflict(statuses: readonly LinkStatus[]): LinkConflict | null {
  if (statuses.includes('accepted')) return 'already_linked';
  if (statuses.includes('requested')) return 'already_requested';
  return null;
}

export function expiryFrom(created: Date, ttlHours: number): Date {
  return new Date(created.getTime() + ttlHours * 3_600_000);
}
