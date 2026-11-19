/** Integer division rounded half up; both arguments are whole numbers of pence. */
function divideHalfUp(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

export interface Fees {
  readonly platform_fee: number;
  readonly processing_fee: number;
  readonly to_creator: number;
}

/**
 * The one place the fee rule lives: for a captured pledge of `amount` pence the
 * platform fee is 5%, processing is 3% + 20p, each rounded half up in whole pence.
 */
export function feesFor(amount: number): Fees {
  const platform_fee = divideHalfUp(amount * 5, 100);
  const processing_fee = divideHalfUp(amount * 3, 100) + 20;
  return { platform_fee, processing_fee, to_creator: amount - platform_fee - processing_fee };
}
