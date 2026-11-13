import { config } from '../config.js';
import type { PromotionKind, PromotionState } from '../../shared/types.js';

export function requestExpiresAt(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + config.approvalTtlSeconds * 1000);
}

export function approvalExpiresAt(decidedAt: Date): Date {
  return new Date(decidedAt.getTime() + config.approvalTtlSeconds * 1000);
}

/**
 * The one rule for approval expiry. The expiry instant is excluded, so a call at or after it
 * has lapsed. Rollbacks carry no approval, so the guard never applies to them.
 */
export function hasLapsed(expiresAt: Date | null, now: Date): boolean {
  if (!expiresAt) return false;
  return now.getTime() >= expiresAt.getTime();
}

export interface ExpiryCandidate {
  kind: PromotionKind;
  state: PromotionState;
  requestExpiresAt: Date | null;
  approvalExpiresAt: Date | null;
}

/** Whether a promotion has run out of approval lifetime and must become `expired`. */
export function isLapsed(candidate: ExpiryCandidate, now: Date): boolean {
  if (candidate.kind === 'rollback') return false;
  if (candidate.state === 'awaiting_approval') return hasLapsed(candidate.requestExpiresAt, now);
  if (candidate.state === 'approved' || candidate.state === 'window_blocked') {
    return hasLapsed(candidate.approvalExpiresAt, now);
  }
  return false;
}
