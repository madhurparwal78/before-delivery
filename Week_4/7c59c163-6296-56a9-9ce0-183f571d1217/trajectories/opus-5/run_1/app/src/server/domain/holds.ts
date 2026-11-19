import { feeForNotional } from './money.js';

export type HoldShape = 'buy' | 'spot_sell' | 'margin_open' | 'margin_reduce';

/**
 * The order's maximum spend at its limit price. The one place the hold formulas live;
 * also used to recompute an order's hold for its remaining quantity after each fill.
 */
export function holdFor(shape: HoldShape, price: number, quantity: number, takerFeeBps: number): number {
  const notional = price * quantity;
  const fee = feeForNotional(notional, takerFeeBps);
  switch (shape) {
    case 'buy':
      return notional + fee;
    case 'spot_sell':
      return fee;
    case 'margin_open':
      return collateralFor(notional) + fee;
    case 'margin_reduce':
      return fee;
  }
}

/** Collateral posted for margin exposure. */
export function collateralFor(notionalCents: number): number {
  return Math.ceil(notionalCents / 2);
}

/** Maintenance requirement for a position of `quantity` at mark `mark`. */
export function maintenanceFor(quantity: number, mark: number): number {
  return Math.ceil((quantity * mark) / 4);
}

/** Position equity at mark. */
export function equityFor(
  side: 'long' | 'short',
  quantity: number,
  costCents: number,
  collateralCents: number,
  mark: number,
): number {
  const value = quantity * mark;
  return side === 'long' ? collateralCents + (value - costCents) : collateralCents + (costCents - value);
}

export interface Reduction {
  basisCents: number;
  releasedCollateralCents: number;
  profitCents: number;
  payoutCents: number;
}

/** Reduction of `reduceBy` units at price `price` out of a position of `quantity`. */
export function reduceBy(
  side: 'long' | 'short',
  quantity: number,
  costCents: number,
  collateralCents: number,
  reduceBy_: number,
  price: number,
): Reduction {
  const whole = reduceBy_ === quantity;
  const basisCents = whole ? costCents : Math.floor((costCents * reduceBy_) / quantity);
  const releasedCollateralCents = whole ? collateralCents : Math.floor((collateralCents * reduceBy_) / quantity);
  const proceeds = reduceBy_ * price;
  const profitCents = side === 'long' ? proceeds - basisCents : basisCents - proceeds;
  return {
    basisCents,
    releasedCollateralCents,
    profitCents,
    payoutCents: Math.max(releasedCollateralCents + profitCents, 0),
  };
}
