import type { LineState } from './orders.js';

/**
 * A time-limited item is live while server time is strictly before its expiry instant, and expired
 * from that instant on. Every read and write judges liveness through these fragments, so reads at
 * or after the instant treat it as expired even before the background pass runs.
 */
export const liveHold = (alias: string): string =>
  `${alias}.status = 'active' AND ${alias}.expires_at > now()`;

export const expiredHold = (alias: string): string =>
  `${alias}.status = 'active' AND ${alias}.expires_at <= now()`;

export const liveOffer = (alias: string): string =>
  `${alias}.status = 'offered' AND ${alias}.offer_expires_at > now()`;

export const lapsedOffer = (alias: string): string =>
  `${alias}.status = 'offered' AND ${alias}.offer_expires_at <= now()`;

/** The line states that still hold a seat away from the pool. */
export const SEAT_HOLDING_LINE_STATES: readonly LineState[] = [
  'proof_pending',
  'captured',
  'transferred',
];

export const seatHoldingStatesSql = (): string =>
  SEAT_HOLDING_LINE_STATES.map((state) => `'${state}'`).join(', ');
