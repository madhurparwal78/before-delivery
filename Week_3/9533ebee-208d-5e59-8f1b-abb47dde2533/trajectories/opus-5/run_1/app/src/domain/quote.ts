/**
 * Swap quote arithmetic: the pool fee, the output at the posted prices and
 * the split of the fee between liquidity providers and the reserve.
 */

import { splitWithReserve, type ReserveSplit } from './money.ts';

export interface QuoteInput {
  readonly amountIn: bigint;
  readonly swapFeeBps: bigint;
  /** Price of the asset the trader pays with, in price units. */
  readonly priceFrom: bigint;
  /** Price of the asset the trader receives, in price units. */
  readonly priceTo: bigint;
  /** 10^decimals of the asset the trader pays with. */
  readonly scaleFrom: bigint;
  /** 10^decimals of the asset the trader receives. */
  readonly scaleTo: bigint;
  /** Reserve factor of the pool the fee lands in, which is the `from` pool. */
  readonly reserveFactorBps: bigint;
}

export interface QuoteFigures {
  readonly fee: bigint;
  readonly amountOut: bigint;
  readonly split: ReserveSplit;
}

/**
 * fee = ceil(amount_in × swap_fee_bps / 10,000) and
 * amount_out = floor((amount_in − fee) × P_from × 10^d_to / (P_to × 10^d_from)),
 * both rounded in the pool's favour.
 */
export function quoteFigures(input: QuoteInput): QuoteFigures {
  const feeProduct = input.amountIn * input.swapFeeBps;
  const fee = feeProduct % 10000n === 0n ? feeProduct / 10000n : feeProduct / 10000n + 1n;
  const net = input.amountIn - fee;
  const amountOut = (net * input.priceFrom * input.scaleTo) / (input.priceTo * input.scaleFrom);
  return { fee, amountOut, split: splitWithReserve(fee, input.reserveFactorBps) };
}
