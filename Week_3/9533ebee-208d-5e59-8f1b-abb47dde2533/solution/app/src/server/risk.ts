import type { Asset } from "./pools.js";
import { BPS, ceilDiv, pow10 } from "./money.js";

// The published risk formulas, each decided here and nowhere else. C and D are minor units of the collateral
// and debt assets, prices are price units, and every parameter comes from the collateral asset.

export interface Exposure {
  collateral: bigint;
  debt: bigint;
  collateralAsset: Asset;
  debtAsset: Asset;
}

/** Health factor ×10,000, floored; null with no debt. */
export function healthFactor({ collateral, debt, collateralAsset: c, debtAsset: d }: Exposure): bigint | null {
  if (debt === 0n) return null;
  return (collateral * c.price * BigInt(c.liquidationThresholdBps) * pow10(d.decimals)) / (debt * d.price * pow10(c.decimals));
}

/** The collateral price, in price units and rounded up, below which the health factor falls under 1. */
export function liquidationPrice({ collateral, debt, collateralAsset: c, debtAsset: d }: Exposure): bigint | null {
  if (debt === 0n) return null;
  return ceilDiv(debt * d.price * pow10(c.decimals) * BPS, collateral * BigInt(c.liquidationThresholdBps) * pow10(d.decimals));
}

/** The loan-to-value check for a draw or a collateral withdrawal, on the figures after the change. */
export function withinLoanToValue({ collateral, debt, collateralAsset: c, debtAsset: d }: Exposure): boolean {
  return debt * d.price * pow10(c.decimals) * BPS <= collateral * c.price * BigInt(c.ltvBps) * pow10(d.decimals);
}

/** The largest repayment whose seized collateral plus bonus the remaining collateral still covers. */
function cover({ collateral, collateralAsset: c, debtAsset: d }: Exposure): bigint {
  return (collateral * c.price * pow10(d.decimals) * BPS) / (d.price * pow10(c.decimals) * (BPS + BigInt(c.liquidationBonusBps)));
}

interface FillLimit {
  maxRepay: bigint;
  /** True when the remaining collateral, not the close factor, sets the limit. */
  collateralBound: boolean;
}

export function fillLimit(exposure: Exposure): FillLimit {
  if (exposure.debt === 0n) return { maxRepay: 0n, collateralBound: false };
  const cap = (exposure.debt * BigInt(exposure.collateralAsset.closeFactorBps)) / BPS;
  const covered = cover(exposure);
  return covered < cap ? { maxRepay: covered, collateralBound: true } : { maxRepay: cap, collateralBound: false };
}

interface Fill {
  repaid: bigint;
  seized: bigint;
  bonusAmount: bigint;
  writtenOff: bigint;
}

/** Seized collateral and bonus for repaying `repaid`, rounded in the pool's favour. */
export function fill(exposure: Exposure, repaid: bigint): Fill {
  const { collateralAsset: c, debtAsset: d } = exposure;
  const limit = fillLimit(exposure);
  const exhausts = limit.collateralBound && repaid === limit.maxRepay;
  const seized = exhausts
    ? exposure.collateral
    : (repaid * d.price * pow10(c.decimals) * (BPS + BigInt(c.liquidationBonusBps))) / (c.price * pow10(d.decimals) * BPS);
  const fair = (repaid * d.price * pow10(c.decimals)) / (c.price * pow10(d.decimals));
  return { repaid, seized, bonusAmount: seized - fair, writtenOff: exhausts ? exposure.debt - repaid : 0n };
}
