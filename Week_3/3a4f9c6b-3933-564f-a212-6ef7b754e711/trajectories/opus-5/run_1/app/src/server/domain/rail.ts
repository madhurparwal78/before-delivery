import type { PromotionCounter, PromotionState, RailPhase } from '../../shared/types.js';

export interface RailPosition {
  phase: RailPhase;
  progress: number;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function fraction(counter: PromotionCounter | null): number {
  if (!counter || counter.total === 0) return 0;
  return counter.in_sync / counter.total;
}

/**
 * The one mapping from promotion state to the rail's phase and progress. The client renders
 * these values and never derives them.
 */
export function railPosition(
  state: PromotionState,
  counter: PromotionCounter | null,
  degradedProgress: number | null,
): RailPosition {
  switch (state) {
    case 'requested':
    case 'awaiting_approval':
    case 'approved':
    case 'queued':
      return { phase: 'queued', progress: 0.1 };
    case 'window_blocked':
      return { phase: 'window_check', progress: 0.2 };
    case 'applying':
      return { phase: 'applying', progress: round(0.2 + 0.4 * fraction(counter)) };
    case 'health_wait':
      return { phase: 'health_wait', progress: round(0.6 + 0.35 * fraction(counter)) };
    case 'healthy':
      return { phase: 'healthy', progress: 1 };
    case 'degraded':
      return { phase: 'degraded', progress: round(degradedProgress ?? 0.2) };
    case 'rejected':
    case 'expired':
      return { phase: 'stopped', progress: 0 };
    case 'rolled_back':
      return { phase: 'idle', progress: 0 };
  }
}

export const IDLE_RAIL: RailPosition = { phase: 'idle', progress: 0 };
