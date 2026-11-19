import { ApiError } from '../http/errors.js';
import type { MarketKind, MarketStatus, OrderStatus } from './types.js';

export type MarketAction = 'open' | 'halt' | 'resume' | 'close' | 'resolve' | 'settle';

const MARKET_STEPS: Record<MarketAction, { from: MarketStatus[]; to: MarketStatus; eventOnly: boolean }> = {
  open: { from: ['listed'], to: 'trading', eventOnly: false },
  halt: { from: ['trading'], to: 'halted', eventOnly: false },
  resume: { from: ['halted'], to: 'trading', eventOnly: false },
  close: { from: ['trading', 'halted'], to: 'closed', eventOnly: true },
  resolve: { from: ['closed'], to: 'resolved', eventOnly: true },
  settle: { from: ['resolved'], to: 'settled', eventOnly: true },
};

export function invalidTransition(from: string, to: string): ApiError {
  return new ApiError(409, 'invalid_transition', { from, to });
}

/** The one place a market transition is decided. */
export function nextMarketStatus(
  kind: MarketKind,
  from: MarketStatus,
  action: MarketAction,
): MarketStatus {
  const step = MARKET_STEPS[action];
  if ((step.eventOnly && kind !== 'event') || !step.from.includes(from)) {
    throw invalidTransition(from, step.to);
  }
  return step.to;
}

const ENDED: readonly OrderStatus[] = ['filled', 'cancelled', 'liquidated'];

export function orderHasEnded(status: OrderStatus): boolean {
  return ENDED.includes(status);
}

/** The one place an order transition is decided. */
export function nextOrderStatus(from: OrderStatus, to: OrderStatus): OrderStatus {
  if (orderHasEnded(from)) throw invalidTransition(from, to);
  return to;
}
