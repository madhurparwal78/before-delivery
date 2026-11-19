// Domain rules for orders, matching, holds and positions. Integer cents only.

export type MarketKind = 'pair' | 'event';
export type MarketStatus = 'listed' | 'trading' | 'halted' | 'closed' | 'resolved' | 'settled';
export type OrderMode = 'spot' | 'margin' | null;
export type OrderSide = 'buy' | 'sell';
export type Outcome = 'yes' | 'no';
export type OrderStatus = 'resting' | 'partially_filled' | 'filled' | 'cancelled' | 'liquidated';
export type PositionSide = 'long' | 'short';
export type PositionStatus = 'open' | 'closed' | 'liquidated';

export const RANGES = {
  eventPrice: { min: 1, max: 99 },
  pairPrice: { min: 1, max: 1000000 },
  quantity: { min: 1, max: 100000 },
  deposit: { min: 500, max: 500000 },
  feeBps: { min: 0, max: 1000 },
} as const;

export const EVENT_ESCROW_PER_CONTRACT = 100;

export function feeForFill(notionalCents: number, bps: number): number {
  return Math.floor((notionalCents * bps + 5000) / 10000);
}

export function holdForOrder(input: {
  price: number;
  quantity: number;
  takerFeeBps: number;
  kind: MarketKind;
  mode: OrderMode;
  side: OrderSide;
  reducesPosition: boolean;
}): number {
  const notional = input.price * input.quantity;
  const fee = feeForFill(notional, input.takerFeeBps);
  if (input.kind === 'pair' && input.mode === 'margin') {
    return input.reducesPosition ? fee : Math.ceil(notional / 2) + fee;
  }
  if (input.side === 'sell') return fee;
  return notional + fee;
}

export function toYesPrice(outcome: Outcome, price: number): number {
  return outcome === 'no' ? EVENT_ESCROW_PER_CONTRACT - price : price;
}

export function fromYesPrice(outcome: Outcome, yesPrice: number): number {
  return outcome === 'no' ? EVENT_ESCROW_PER_CONTRACT - yesPrice : yesPrice;
}

const MARKET_TRANSITIONS: Record<MarketKind, Partial<Record<MarketStatus, MarketStatus[]>>> = {
  pair: {
    listed: ['trading'],
    trading: ['halted'],
    halted: ['trading'],
  },
  event: {
    listed: ['trading'],
    trading: ['halted', 'closed'],
    halted: ['trading', 'closed'],
    closed: ['resolved'],
    resolved: ['settled'],
  },
};

export function marketCanTransition(kind: MarketKind, from: MarketStatus, to: MarketStatus): boolean {
  const allowed = MARKET_TRANSITIONS[kind][from] ?? [];
  return allowed.includes(to);
}

export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return status === 'filled' || status === 'cancelled' || status === 'liquidated';
}

export function canCancelOrder(status: OrderStatus): boolean {
  return status === 'resting' || status === 'partially_filled';
}

export function orderStatusAfterFill(filled: number, quantity: number): OrderStatus {
  return filled >= quantity ? 'filled' : 'partially_filled';
}

export interface PositionRecord {
  id: string;
  market_id: string;
  member_id: string;
  side: PositionSide;
  quantity: number;
  cost_cents: number;
  collateral_cents: number;
  status: 'open' | 'closed' | 'liquidated';
}

export interface PositionMath {
  quantity: number;
  costCents: number;
  collateralCents: number;
}

export function positionEquity(position: PositionRecord | PositionMath & { side: PositionSide }, mark: number): number {
  const collateral = 'collateral_cents' in position ? position.collateral_cents : position.collateralCents;
  const cost = 'cost_cents' in position ? position.cost_cents : position.costCents;
  if (position.side === 'long') {
    return collateral + (position.quantity * mark - cost);
  }
  return collateral + (cost - position.quantity * mark);
}

export function maintenanceRequirement(quantity: number, mark: number): number {
  return Math.ceil((quantity * mark) / 4);
}

export function positionReduction(position: { quantity: number; costCents: number; collateralCents: number } | PositionRecord, reduceQty: number): {
  basis: number;
  releasedCollateral: number;
} {
  const cost = 'cost_cents' in position ? position.cost_cents : position.costCents;
  const collateral = 'collateral_cents' in position ? position.collateral_cents : position.collateralCents;
  const isFull = reduceQty === position.quantity;
  const basis = isFull ? cost : Math.floor((cost * reduceQty) / position.quantity);
  const releasedCollateral = isFull ? collateral : Math.floor((collateral * reduceQty) / position.quantity);
  return { basis, releasedCollateral };
}

export function pnlForReduction(side: PositionSide, reduceQty: number, execPrice: number, basis: number): number {
  return side === 'long' ? reduceQty * execPrice - basis : basis - reduceQty * execPrice;
}

export function crosses(taker: { side: OrderSide; price: number }, maker: { side: OrderSide; price: number }): boolean {
  if (taker.side === 'buy') return taker.price >= maker.price;
  return taker.price <= maker.price;
}

export function eventCrosses(yesBid: number, noBid: number): boolean {
  return yesBid + (EVENT_ESCROW_PER_CONTRACT - noBid) >= EVENT_ESCROW_PER_CONTRACT;
}

export function luhnValid(cardNumber: string): boolean {
  const digits = cardNumber.replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = Number(digits[i]);
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

export function planRatePerSecond(plan: 'sandbox' | 'builder' | 'desk'): number {
  switch (plan) {
    case 'sandbox': return 2;
    case 'builder': return 20;
    case 'desk': return 100;
  }
}

export function overdueToPlanState(overdue: string | null): 'active' | 'payment_failed' | 'downgraded' {
  if (overdue === 'WARNING') return 'payment_failed';
  if (overdue === 'DOWNGRADED') return 'downgraded';
  return 'active';
}
