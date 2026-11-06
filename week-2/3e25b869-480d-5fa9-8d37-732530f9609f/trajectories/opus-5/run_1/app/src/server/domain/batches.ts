import type { BatchAction } from '../../shared/copy.js';
import type { BatchState } from '../../shared/types.js';

const TRANSITIONS: Record<BatchAction, { from: readonly BatchState[]; to: BatchState }> = {
  cut: { from: ['poured'], to: 'curing' },
  schedule: { from: ['curing', 'scheduled'], to: 'scheduled' },
  open: { from: ['curing', 'scheduled'], to: 'live' },
  withdraw: { from: ['poured', 'curing', 'scheduled', 'live'], to: 'withdrawn' },
};

export function canApply(state: BatchState, action: BatchAction): boolean {
  return TRANSITIONS[action].from.includes(state);
}

export function stateAfter(action: BatchAction): BatchState {
  return TRANSITIONS[action].to;
}

export const PUBLIC_STATES: readonly BatchState[] = ['scheduled', 'live', 'sold_out'];

/** A scheduled batch becomes live the instant its drop time is reached. */
export function effectiveState(
  stored: BatchState,
  dropAt: Date | null,
  soldOut: boolean,
  now: Date,
): BatchState {
  if (stored === 'scheduled' && dropAt !== null && now.getTime() >= dropAt.getTime()) {
    return soldOut ? 'sold_out' : 'live';
  }
  if (stored === 'live') return soldOut ? 'sold_out' : 'live';
  if (stored === 'sold_out') return soldOut ? 'sold_out' : 'live';
  return stored;
}

export const MIN_CURE_DAYS = 28;
export const MAX_CURE_DAYS = 60;
export const MIN_BARS_CUT = 1;
export const MAX_BARS_CUT = 24;
