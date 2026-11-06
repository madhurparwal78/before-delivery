import type { LinkState } from '../../shared/api.js';
import { config } from '../config.js';

/**
 * The one place a dated thing is judged open or past. Something is past from its
 * instant onward, and the instant is always the server's.
 */
export function hasPassed(instant: Date, now: Date): boolean {
  return now.getTime() >= instant.getTime();
}

export function signInTokenExpiry(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + config.magicLinkTtlSeconds * 1000);
}

export function reviewerLinkExpiry(createdAt: Date, hours: number): Date {
  return new Date(createdAt.getTime() + hours * config.reviewerLinkHourSeconds * 1000);
}

export function importPlanExpiry(plannedAt: Date): Date {
  return new Date(plannedAt.getTime() + config.importPlanTtlSeconds * 1000);
}

export function checkpointUploadDeadline(savedAt: Date): Date {
  return new Date(savedAt.getTime() + config.checkpointUploadDeadlineSeconds * 1000);
}

export function reviewerLinkState(
  link: { expires_at: Date; revoked_at: Date | null },
  now: Date,
): LinkState {
  if (link.revoked_at !== null) return 'revoked';
  if (hasPassed(link.expires_at, now)) return 'expired';
  return 'active';
}
