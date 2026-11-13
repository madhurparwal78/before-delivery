/**
 * The position rules: health factor, liquidation price, the loan-to-value
 * check, the state machine and the liquidation fill arithmetic. Each of these
 * is decided here and nowhere else.
 */

import { BPS } from './assets.ts';

export const POSITION_STATES = [
  'healthy',
  'warned',
  'liquidatable_grace',
  'liquidatable',
  'partially_liquidated',
  'closed',
] as const;

export type PositionState = (typeof POSITION_STATES)[number];

/** Health factors are carried scaled by 10,000, as the formulas state. */
export const HEALTH_FACTOR_ONE = 10000n;

/** The warning level is health factor 1.1000. */
export const WARNING_HEALTH_FACTOR = 11000n;

/** The close factor, shared by all three assets. */
export const CLOSE_FACTOR_BPS = 5000n;

/** A position's two sides, in minor units, with the prices that value them. */
export interface PositionValuation {
  readonly collateral: bigint;
  readonly debt: bigint;
  /** Price of the collateral asset, in price units. */
  readonly collateralPrice: bigint;
  /** Price of the debt asset, in price units. */
  readonly debtPrice: bigint;
  /** 10^decimals of the collateral asset. */
  readonly collateralScale: bigint;
  /** 10^decimals of the debt asset. */
  readonly debtScale: bigint;
}

/**
 * Health factor × 10,000 = floor(C × Pc × LT × 10^dd / (D × Pd × 10^dc)),
 * or null when there is no debt.
 */
export function healthFactorScaled(
  valuation: PositionValuation,
  liquidationThresholdBps: bigint,
): bigint | null {
  if (valuation.debt === 0n) return null;
  const numerator =
    valuation.collateral *
    valuation.collateralPrice *
    liquidationThresholdBps *
    valuation.debtScale;
  const denominator = valuation.debt * valuation.debtPrice * valuation.collateralScale;
  return numerator / denominator;
}

/**
 * The collateral price below which the health factor falls under 1:
 * ceil(D × Pd × 10^dc × 10,000 / (C × LT × 10^dd)). Null with no debt.
 */
export function liquidationPrice(
  valuation: PositionValuation,
  liquidationThresholdBps: bigint,
): bigint | null {
  if (valuation.debt === 0n) return null;
  if (valuation.collateral === 0n) return null;
  const numerator = valuation.debt * valuation.debtPrice * valuation.collateralScale * BPS;
  const denominator = valuation.collateral * liquidationThresholdBps * valuation.debtScale;
  return numerator % denominator === 0n
    ? numerator / denominator
    : numerator / denominator + 1n;
}

/**
 * The loan-to-value check, using the collateral asset's loan-to-value:
 * D × Pd × 10^dc × 10,000 ≤ C × Pc × LTV × 10^dd after the change.
 */
export function passesLoanToValue(valuation: PositionValuation, ltvBps: bigint): boolean {
  const left = valuation.debt * valuation.debtPrice * valuation.collateralScale * BPS;
  const right = valuation.collateral * valuation.collateralPrice * ltvBps * valuation.debtScale;
  return left <= right;
}

/**
 * The most debt a liquidator may repay on one fill: the close factor of the
 * debt, capped by what the remaining collateral can cover with its bonus.
 */
export function maxRepay(valuation: PositionValuation, liquidationBonusBps: bigint): bigint {
  const closeFactorCap = (valuation.debt * CLOSE_FACTOR_BPS) / BPS;
  const cover = coverFromCollateral(valuation, liquidationBonusBps);
  return closeFactorCap < cover ? closeFactorCap : cover;
}

/** How much debt the whole remaining collateral can pay for, bonus included. */
export function coverFromCollateral(
  valuation: PositionValuation,
  liquidationBonusBps: bigint,
): bigint {
  const numerator =
    valuation.collateral * valuation.collateralPrice * valuation.debtScale * BPS;
  const denominator =
    valuation.debtPrice * valuation.collateralScale * (BPS + liquidationBonusBps);
  return numerator / denominator;
}

/** The collateral a repayment seizes, bonus included, rounded to the pool. */
export function seizedForRepay(
  repaid: bigint,
  valuation: PositionValuation,
  liquidationBonusBps: bigint,
): bigint {
  const numerator =
    repaid * valuation.debtPrice * valuation.collateralScale * (BPS + liquidationBonusBps);
  const denominator = valuation.collateralPrice * valuation.debtScale * BPS;
  return numerator / denominator;
}

/** The part of the seized collateral that is the liquidation bonus. */
export function bonusPortion(
  repaid: bigint,
  seized: bigint,
  valuation: PositionValuation,
): bigint {
  const atPar =
    (repaid * valuation.debtPrice * valuation.collateralScale) /
    (valuation.collateralPrice * valuation.debtScale);
  return seized - atPar;
}

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

export interface EvaluationInput {
  readonly collateral: bigint;
  readonly debt: bigint;
  readonly healthFactorScaled: bigint | null;
  /** The position's stored grace end, in epoch milliseconds. */
  readonly storedGraceEndsAtMs: number | null;
  /** The after-fill mark, set by a fill that left the health factor below 1. */
  readonly afterFillMark: boolean;
  readonly nowMs: number;
  readonly graceSeconds: number;
}

export interface EvaluationOutput {
  readonly state: PositionState;
  readonly graceEndsAtMs: number | null;
  readonly afterFillMark: boolean;
  /** True when this evaluation re-arms the margin notice. */
  readonly rearmsMarginNotice: boolean;
}

/**
 * Applies the position rules in order and returns the state together with the
 * stored grace end and after-fill mark that follow from it. The server alone
 * decides each move; nothing here reads a request.
 */
export function evaluatePosition(input: EvaluationInput): EvaluationOutput {
  if (input.collateral === 0n && input.debt === 0n) {
    return {
      state: 'closed',
      graceEndsAtMs: null,
      afterFillMark: false,
      rearmsMarginNotice: false,
    };
  }

  const health = input.healthFactorScaled;
  if (input.debt === 0n || (health !== null && health >= WARNING_HEALTH_FACTOR)) {
    return {
      state: 'healthy',
      graceEndsAtMs: null,
      afterFillMark: false,
      rearmsMarginNotice: true,
    };
  }

  if (health !== null && health >= HEALTH_FACTOR_ONE) {
    return {
      state: 'warned',
      graceEndsAtMs: null,
      afterFillMark: false,
      rearmsMarginNotice: false,
    };
  }

  if (input.storedGraceEndsAtMs === null && !input.afterFillMark) {
    return {
      state: 'liquidatable_grace',
      graceEndsAtMs: input.nowMs + input.graceSeconds * 1000,
      afterFillMark: false,
      rearmsMarginNotice: false,
    };
  }

  if (input.storedGraceEndsAtMs !== null && input.nowMs < input.storedGraceEndsAtMs) {
    return {
      state: 'liquidatable_grace',
      graceEndsAtMs: input.storedGraceEndsAtMs,
      afterFillMark: input.afterFillMark,
      rearmsMarginNotice: false,
    };
  }

  return {
    state: input.afterFillMark ? 'partially_liquidated' : 'liquidatable',
    graceEndsAtMs: input.storedGraceEndsAtMs,
    afterFillMark: input.afterFillMark,
    rearmsMarginNotice: false,
  };
}

/** Liquidation is allowed only in these two states. */
export function isLiquidatable(state: PositionState): boolean {
  return state === 'liquidatable' || state === 'partially_liquidated';
}

/** States at or below the warning level queue a margin notice when armed. */
export function queuesMarginNotice(state: PositionState): boolean {
  return (
    state === 'warned' ||
    state === 'liquidatable_grace' ||
    state === 'liquidatable' ||
    state === 'partially_liquidated'
  );
}
