// The single source of every domain rule: pool figures from ledger balances,
// the health factor and liquidation price, the interest curve and index,
// quotes and the fee split, liquidation fill math and the shock ruler.
import { ASSETS, isAssetCode } from '../shared/assets.js';

export const INDEX_SCALE = 10n ** 27n;
export const SECONDS_PER_YEAR = 31_536_000n;
export const HF_SCALE = 10_000n;

export interface PoolBalances {
  supply: bigint;
  swap: bigint;
  loan: bigint;
}

export interface PoolFigures {
  available_liquidity: bigint;
  total_borrowed: bigint;
  utilization_bps: number;
}

export function poolFigures(b: PoolBalances): PoolFigures {
  const total_borrowed = -b.loan;
  const available_liquidity = b.supply + b.swap + b.loan;
  const total = total_borrowed + available_liquidity;
  const utilization_bps = total === 0n ? 0 : Number(total_borrowed * 10_000n / total);
  return { available_liquidity, total_borrowed, utilization_bps };
}

export function sharePrice(supply: bigint, total_shares: bigint): bigint {
  if (total_shares === 0n) return 10n ** 12n;
  return supply * 10n ** 12n / total_shares;
}

export function shareValue(shares: bigint, supply: bigint, total_shares: bigint): bigint {
  if (total_shares === 0n) return 0n;
  return shares * supply / total_shares;
}

export function mintShares(amount: bigint, total_shares: bigint, supply: bigint): bigint {
  if (total_shares === 0n) return amount;
  return amount * total_shares / supply;
}

export function burnShares(amount: bigint, total_shares: bigint, supply: bigint): bigint {
  if (total_shares === 0n) return amount;
  const numerator = amount * total_shares;
  return supply === 0n ? amount : (numerator + supply - 1n) / supply;
}

/** Largest-remainder split of a total between supply and reserve. */
export function splitFee(total: bigint, reserve_factor_bps: number): { to_supply: bigint; to_reserve: bigint } {
  const rf = BigInt(reserve_factor_bps);
  const exact_supply = total * (10_000n - BigInt(reserve_factor_bps));
  const floor_supply = exact_supply / 10_000n;
  const floor_reserve = total * rf / 10_000n;
  const remainder_supply = exact_supply % 10_000n;
  const remainder_reserve = total * rf % 10_000n;
  let to_supply = floor_supply;
  let to_reserve = floor_reserve;
  const leftover = total - floor_supply - floor_reserve;
  if (leftover > 0n) {
    if (remainder_supply > remainder_reserve) to_supply += leftover;
    else if (remainder_reserve > remainder_supply) to_reserve += leftover;
    else to_supply += leftover;
  }
  return { to_supply, to_reserve };
}

export interface Curve {
  base_bps: number;
  slope1_bps: number;
  kink_bps: number;
  slope2_bps: number;
}

export function borrowRateBps(curve: Curve, utilization_bps: number): number {
  const kink = curve.kink_bps;
  if (utilization_bps <= kink) {
    return curve.base_bps + Math.floor(curve.slope1_bps * utilization_bps / kink);
  }
  return curve.base_bps + curve.slope1_bps + Math.floor(curve.slope2_bps * (utilization_bps - kink) / (10_000 - kink));
}

export function supplyRateBps(borrow_rate_bps: number, utilization_bps: number, reserve_factor_bps: number): number {
  return Math.floor(borrow_rate_bps * utilization_bps * (10_000 - reserve_factor_bps) / 100_000_000);
}

/** Bring a borrow index forward by dt seconds at the rate in force at the start. */
export function advanceIndex(index: bigint, rate_bps: number, dt: bigint): bigint {
  if (dt <= 0n) return index;
  return index + index * BigInt(rate_bps) * dt / (10_000n * SECONDS_PER_YEAR);
}

/** Position debt at the current index: ceil(principal * index / reference). */
export function debtAt(principal: bigint, index_now: bigint, reference_index: bigint): bigint {
  if (principal === 0n) return 0n;
  const numerator = principal * index_now;
  return (numerator + reference_index - 1n) / reference_index;
}

export interface HfInput {
  collateralAsset: 'QUSD' | 'MBTC' | 'METH';
  debtAsset: 'QUSD' | 'MBTC' | 'METH';
  collateral_amount: bigint;
  collateral_price: bigint;
  debt: bigint;
  debt_price: bigint;
  liquidation_threshold_bps: number;
}

/** Health factor scaled by 10,000, or null with no debt. */
export function healthFactorScaled(input: HfInput): bigint | null {
  if (input.debt === 0n) return null;
  const dc = BigInt(ASSETS[input.collateralAsset].decimals);
  const dd = BigInt(ASSETS[input.debtAsset].decimals);
  const numerator = input.collateral_amount * input.collateral_price * BigInt(input.liquidation_threshold_bps) * 10n ** dd;
  const denominator = input.debt * input.debt_price * 10n ** dc;
  return numerator / denominator;
}

/** Liquidation price: the collateral price below which the health factor falls under 1. */
export function liquidationPrice(input: HfInput): bigint {
  if (input.debt === 0n) return 0n;
  const dc = BigInt(ASSETS[input.collateralAsset].decimals);
  const dd = BigInt(ASSETS[input.debtAsset].decimals);
  const numerator = input.debt * input.debt_price * 10n ** dc * 10_000n;
  const denominator = input.collateral_amount * BigInt(input.liquidation_threshold_bps) * 10n ** dd;
  return (numerator + denominator - 1n) / denominator;
}

/** The loan-to-value check after a change: passes when the scaled left side is at most the right side. */
export function withinLtv(input: {
  collateralAsset: 'QUSD' | 'MBTC' | 'METH';
  debtAsset: 'QUSD' | 'MBTC' | 'METH';
  collateral_amount: bigint;
  debt: bigint;
  collateral_price: bigint;
  debt_price: bigint;
  ltv_bps: number;
}): boolean {
  const dc = BigInt(ASSETS[input.collateralAsset].decimals);
  const dd = BigInt(ASSETS[input.debtAsset].decimals);
  const left = input.debt * input.debt_price * 10n ** dc * 10_000n;
  const right = input.collateral_amount * input.collateral_price * BigInt(input.ltv_bps) * 10n ** dd;
  return left <= right;
}

export interface QuoteMathInput {
  amount_in: bigint;
  swap_fee_bps: number;
  price_from: bigint;
  price_to: bigint;
  from_decimals: number;
  to_decimals: number;
}

export function quoteMath(input: QuoteMathInput): { fee: bigint; amount_out: bigint } {
  const fee = (input.amount_in * BigInt(input.swap_fee_bps) + 9_999n) / 10_000n;
  const net = input.amount_in - fee;
  const numerator = net * input.price_from * 10n ** BigInt(input.to_decimals);
  const denominator = input.price_to * 10n ** BigInt(input.from_decimals);
  const amount_out = denominator === 0n ? 0n : numerator / denominator;
  return { fee, amount_out };
}

export interface LiquidationMathInput {
  collateralAsset: 'QUSD' | 'MBTC' | 'METH';
  debtAsset: 'QUSD' | 'MBTC' | 'METH';
  debt: bigint;
  collateral_amount: bigint;
  collateral_price: bigint;
  debt_price: bigint;
  close_factor_bps: number;
  liquidation_bonus_bps: number;
}

export interface LiquidationMathResult {
  max_repay: bigint;
  cover: bigint;
}

export function liquidationLimits(input: LiquidationMathInput): LiquidationMathResult {
  const dc = BigInt(ASSETS[input.collateralAsset].decimals);
  const dd = BigInt(ASSETS[input.debtAsset].decimals);
  const cap = input.debt * BigInt(input.close_factor_bps) / 10_000n;
  const numerator = input.collateral_amount * input.collateral_price * 10n ** dd * 10_000n;
  const denominator = input.debt_price * 10n ** dc * (10_000n + BigInt(input.liquidation_bonus_bps));
  const cover = denominator === 0n ? 0n : numerator / denominator;
  return { max_repay: cap < cover ? cap : cover, cover };
}

export function seizedForRepay(repaid: bigint, collateralAsset: 'QUSD' | 'MBTC' | 'METH', debtAsset: 'QUSD' | 'MBTC' | 'METH', collateral_price: bigint, debt_price: bigint, liquidation_bonus_bps: number): { seized: bigint; bonus_amount: bigint } {
  const dc = BigInt(ASSETS[collateralAsset].decimals);
  const dd = BigInt(ASSETS[debtAsset].decimals);
  const bonus = BigInt(liquidation_bonus_bps);
  const numerator = repaid * debt_price * 10n ** dc * (10_000n + bonus);
  const denominator = collateral_price * 10n ** dd * 10_000n;
  const seized = denominator === 0n ? 0n : numerator / denominator;
  const bonus_numerator = repaid * debt_price * 10n ** dc;
  const bonus_denominator = collateral_price * 10n ** dd;
  const bonus_amount = seized - (bonus_denominator === 0n ? 0n : bonus_numerator / bonus_denominator);
  return { seized, bonus_amount };
}

export function shockedPrice(price: bigint, shockBps: number): bigint {
  return price * (1_000n + BigInt(Math.round(shockBps * 10))) / 1_000n;
}

export function assetDecimals(code: string): number {
  return isAssetCode(code) ? ASSETS[code].decimals : 0;
}
