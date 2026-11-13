/**
 * The shock ruler's reading. Shared with the browser so the ruler and the
 * server agree on every shocked price and at-risk count.
 */

/** The slider spans −60% to +60% in steps of 0.5%, held in tenths of a percent. */
export const SHOCK_MIN_TENTHS = -600;
export const SHOCK_MAX_TENTHS = 600;
export const SHOCK_STEP_TENTHS = 5;

/**
 * Shocked price = floor(P × (1,000 + 10 × s) / 1,000) price units, where s is
 * the shock in percent. The shock arrives here in tenths of a percent.
 */
export function shockedPrice(price: bigint, shockTenths: number): bigint {
  return (price * (1000n + BigInt(shockTenths))) / 1000n;
}

/**
 * A position is at risk when the shocked price is below its liquidation
 * price. A liquidation price equal to the shocked price is clear.
 */
export function isAtRisk(shocked: bigint, positionLiquidationPrice: bigint): boolean {
  return shocked < positionLiquidationPrice;
}
