import type { PromotionState } from '../../shared/types.js';

/** Every state in which a promotion holds its stage. */
export const ACTIVE_STATES: readonly PromotionState[] = [
  'requested',
  'awaiting_approval',
  'approved',
  'queued',
  'window_blocked',
  'applying',
  'health_wait',
];

/**
 * The one table of legal promotion transitions. Guards live with the callers that can
 * evaluate them; this table decides only which pairs exist at all.
 */
const LEGAL: readonly { from: PromotionState; to: PromotionState }[] = [
  { from: 'requested', to: 'awaiting_approval' },
  { from: 'requested', to: 'queued' },
  { from: 'awaiting_approval', to: 'approved' },
  { from: 'awaiting_approval', to: 'rejected' },
  { from: 'awaiting_approval', to: 'expired' },
  { from: 'approved', to: 'queued' },
  { from: 'approved', to: 'expired' },
  { from: 'window_blocked', to: 'expired' },
  { from: 'queued', to: 'applying' },
  { from: 'queued', to: 'window_blocked' },
  { from: 'window_blocked', to: 'queued' },
  { from: 'applying', to: 'health_wait' },
  { from: 'applying', to: 'healthy' },
  { from: 'applying', to: 'degraded' },
  { from: 'health_wait', to: 'healthy' },
  { from: 'health_wait', to: 'degraded' },
  { from: 'healthy', to: 'rolled_back' },
  { from: 'degraded', to: 'rolled_back' },
];

export function isLegalTransition(from: PromotionState, to: PromotionState): boolean {
  return LEGAL.some((pair) => pair.from === from && pair.to === to);
}
