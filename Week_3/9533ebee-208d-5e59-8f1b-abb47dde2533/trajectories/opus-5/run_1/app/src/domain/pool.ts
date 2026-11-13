/**
 * Pool figures, each computed from ledger balances at the moment of reading.
 * They are never kept as counters. Total shares and each holder's shares are
 * the only non-ledger pool figures.
 */

export interface PoolBalances {
  /** The liquidity providers' claim on the pool. */
  readonly supply: bigint;
  /** The reserve's claim, held back from liquidity providers. */
  readonly reserve: bigint;
  /** The swap book's net inventory, not owned by liquidity providers. */
  readonly swap: bigint;
  /** The sum of every loan balance in the asset, which is negative or zero. */
  readonly loanTotal: bigint;
}

export interface PoolFigures {
  readonly availableLiquidity: bigint;
  readonly totalBorrowed: bigint;
  readonly utilizationBps: bigint;
}

export function poolFigures(balances: PoolBalances): PoolFigures {
  const availableLiquidity = balances.supply + balances.swap + balances.loanTotal;
  const totalBorrowed = -balances.loanTotal;
  const denominator = totalBorrowed + availableLiquidity;
  const utilizationBps = denominator === 0n ? 0n : (totalBorrowed * 10000n) / denominator;
  return { availableLiquidity, totalBorrowed, utilizationBps };
}

/** Share prices carry exactly 12 decimals. */
export const SHARE_PRICE_DECIMALS = 12;
const SHARE_PRICE_SCALE = 10n ** BigInt(SHARE_PRICE_DECIMALS);

/**
 * Share price = supply / total shares, floored to 12 decimals, and exactly
 * one when the pool has no shares. Returned scaled by 10^12.
 */
export function sharePriceScaled(supply: bigint, totalShares: bigint): bigint {
  if (totalShares === 0n) return SHARE_PRICE_SCALE;
  return (supply * SHARE_PRICE_SCALE) / totalShares;
}

/** A holder's share value = floor(holder shares × supply / total shares). */
export function shareValue(holderShares: bigint, supply: bigint, totalShares: bigint): bigint {
  if (totalShares === 0n) return 0n;
  return (holderShares * supply) / totalShares;
}

/** Supplying x mints floor(x × total shares / supply), or x with no shares. */
export function sharesToMint(amount: bigint, supply: bigint, totalShares: bigint): bigint {
  if (totalShares === 0n || supply === 0n) return amount;
  return (amount * totalShares) / supply;
}

/** Withdrawing y burns ceil(y × total shares / supply). */
export function sharesToBurn(amount: bigint, supply: bigint, totalShares: bigint): bigint {
  if (totalShares === 0n || supply === 0n) return amount;
  const product = amount * totalShares;
  return product % supply === 0n ? product / supply : product / supply + 1n;
}
