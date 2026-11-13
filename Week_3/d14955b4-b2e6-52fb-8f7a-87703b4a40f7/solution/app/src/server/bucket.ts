import { BUCKET_CAPACITY } from '../shared/types.js';

const REFILL_MS = 15_000;
export const CAPACITY_MS = BUCKET_CAPACITY * REFILL_MS;

export interface BucketState {
  creditMs: number;
  refilledAt: number;
}

export function refill(state: BucketState, now: number): BucketState {
  const creditMs = Math.min(CAPACITY_MS, state.creditMs + Math.max(0, now - state.refilledAt));
  return { creditMs, refilledAt: now };
}

export const wholeTokens = (state: BucketState): number => Math.floor(state.creditMs / REFILL_MS);

export function retryAfterSeconds(state: BucketState): number | null {
  if (state.creditMs >= REFILL_MS) return null;
  return Math.max(1, Math.ceil((REFILL_MS - state.creditMs) / 1000));
}

type Take =
  | { allowed: true; previous: number; level: number; state: BucketState }
  | { allowed: false; retryAfter: number };

export function take(state: BucketState, now: number): Take {
  const current = refill(state, now);
  const retryAfter = retryAfterSeconds(current);
  if (retryAfter !== null) return { allowed: false, retryAfter };
  const after = { creditMs: current.creditMs - REFILL_MS, refilledAt: now };
  return { allowed: true, previous: wholeTokens(current), level: wholeTokens(after), state: after };
}
