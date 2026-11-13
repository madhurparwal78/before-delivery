import { config } from "./config.js";
import { rows, type Tx } from "./db.js";
import { account } from "./ledger.js";
import { marketStale } from "./errors.js";
import { BANNER, SWAPS_PAUSED, type OracleStatus } from "../shared/copy.js";
import { toInstant } from "./time.js";
import { plainPrice } from "../shared/format.js";
import { ceilDiv, fixedText, BPS } from "./money.js";

// Assets, their posted prices and every pool figure. Pool figures are read from ledger balances each time and
// never kept as counters; total shares and each holder's shares are the only non-ledger pool figures.

export interface Asset {
  asset: string;
  name: string;
  decimals: number;
  ltvBps: number;
  liquidationThresholdBps: number;
  liquidationBonusBps: number;
  reserveFactorBps: number;
  closeFactorBps: number;
  swapFeeBps: number;
  warningHealthFactorBps: number;
  curve: { baseBps: number; slope1Bps: number; kinkBps: number; slope2Bps: number };
  borrowIndex: bigint;
  indexSecond: bigint;
  totalShares: bigint;
  riskVersion: number;
  price: bigint;
  pricePostedAt: Date;
  priceSource: "manual" | "oracle";
  oracleRound: number | null;
}

export type Market = Map<string, Asset>;

interface AssetRow {
  asset: string;
  name: string;
  decimals: number;
  ltv_bps: number;
  liquidation_threshold_bps: number;
  liquidation_bonus_bps: number;
  reserve_factor_bps: number;
  close_factor_bps: number;
  swap_fee_bps: number;
  warning_health_factor_bps: number;
  base_bps: number;
  slope1_bps: number;
  kink_bps: number;
  slope2_bps: number;
  borrow_index: string;
  index_second: string;
  total_shares: string;
  risk_version: number;
  price: string;
  posted_at: Date;
  source: "manual" | "oracle";
  oracle_round: string | null;
}

/** Loads every listed asset with its latest posted price, in listing order. */
export async function loadMarket(tx: Tx): Promise<Market> {
  const found = await rows<AssetRow>(
    tx,
    `SELECT a.asset, a.name, a.decimals, a.ltv_bps, a.liquidation_threshold_bps, a.liquidation_bonus_bps,
            a.reserve_factor_bps, a.close_factor_bps, a.swap_fee_bps, a.warning_health_factor_bps,
            a.base_bps, a.slope1_bps, a.kink_bps, a.slope2_bps,
            a.borrow_index::text, a.index_second::text, a.total_shares::text, a.risk_version,
            p.price::text, p.posted_at, p.source, p.oracle_round::text
     FROM assets a
     CROSS JOIN LATERAL (SELECT price, posted_at, source, oracle_round FROM price_posts WHERE asset = a.asset ORDER BY seq DESC LIMIT 1) p
     ORDER BY a.listing`,
  );
  return new Map(
    found.map((row) => [
      row.asset,
      {
        asset: row.asset,
        name: row.name,
        decimals: row.decimals,
        ltvBps: row.ltv_bps,
        liquidationThresholdBps: row.liquidation_threshold_bps,
        liquidationBonusBps: row.liquidation_bonus_bps,
        reserveFactorBps: row.reserve_factor_bps,
        closeFactorBps: row.close_factor_bps,
        swapFeeBps: row.swap_fee_bps,
        warningHealthFactorBps: row.warning_health_factor_bps,
        curve: { baseBps: row.base_bps, slope1Bps: row.slope1_bps, kinkBps: row.kink_bps, slope2Bps: row.slope2_bps },
        borrowIndex: BigInt(row.borrow_index),
        indexSecond: BigInt(row.index_second),
        totalShares: BigInt(row.total_shares),
        riskVersion: row.risk_version,
        price: BigInt(row.price),
        pricePostedAt: row.posted_at,
        priceSource: row.source,
        oracleRound: row.oracle_round === null ? null : Number(row.oracle_round),
      },
    ]),
  );
}

// ---- staleness ----

/** Whole seconds since the current price was published. */
function priceAge(asset: Asset, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - asset.pricePostedAt.getTime()) / 1000));
}

/** True when a price published at `postedAt` is older than the staleness limit: the one staleness rule. */
export function isStaleAt(postedAt: Date, now: Date): boolean {
  return now.getTime() - postedAt.getTime() > config.stalenessSeconds * 1000;
}

export function isStale(asset: Asset, now: Date): boolean {
  return isStaleAt(asset.pricePostedAt, now);
}

/** Refuses draws, collateral withdrawals and liquidations while either asset of the position is stale. */
export function requireFreshForBorrowing(now: Date, ...assets: Asset[]): void {
  if (assets.some((asset) => isStale(asset, now))) throw marketStale(BANNER);
}

/** Refuses previews, quotes and swaps while either swap asset is stale. */
export function requireFreshForSwaps(now: Date, ...assets: Asset[]): void {
  if (assets.some((asset) => isStale(asset, now))) throw marketStale(SWAPS_PAUSED);
}

// ---- figures from ledger balances ----

interface PoolBalances {
  supply: bigint;
  reserve: bigint;
  swap: bigint;
  loans: bigint;
}

export async function poolBalances(tx: Tx, asset: string): Promise<PoolBalances> {
  const found = await rows<{ supply: string; reserve: string; swap: string; loans: string }>(
    tx,
    `SELECT COALESCE(SUM(balance) FILTER (WHERE account = $2), 0)::text AS supply,
            COALESCE(SUM(balance) FILTER (WHERE account = $3), 0)::text AS reserve,
            COALESCE(SUM(balance) FILTER (WHERE account = $4), 0)::text AS swap,
            COALESCE(SUM(balance) FILTER (WHERE account LIKE 'loan:%'), 0)::text AS loans
     FROM account_balances WHERE asset = $1`,
    [asset, account.supply, account.reserve, account.swap],
  );
  const row = found[0];
  return {
    supply: BigInt(row?.supply ?? "0"),
    reserve: BigInt(row?.reserve ?? "0"),
    swap: BigInt(row?.swap ?? "0"),
    loans: BigInt(row?.loans ?? "0"),
  };
}

interface PoolFigures {
  availableLiquidity: bigint;
  totalBorrowed: bigint;
  utilizationBps: number;
  borrowRateBps: number;
  supplyRateBps: number;
}

export function poolFigures(asset: Asset, balances: PoolBalances): PoolFigures {
  const availableLiquidity = balances.supply + balances.swap + balances.loans;
  const totalBorrowed = -balances.loans;
  const denominator = totalBorrowed + availableLiquidity;
  const utilizationBps = denominator === 0n ? 0 : Number((totalBorrowed * BPS) / denominator);
  const borrowRateBps = borrowRate(asset, utilizationBps);
  const supplyRateBps = Number((BigInt(borrowRateBps) * BigInt(utilizationBps) * BigInt(10_000 - asset.reserveFactorBps)) / 100_000_000n);
  return { availableLiquidity, totalBorrowed, utilizationBps, borrowRateBps, supplyRateBps };
}

/** The kinked borrow-rate curve, in basis points. */
export function borrowRate(asset: Asset, utilizationBps: number): number {
  const { baseBps, slope1Bps, kinkBps, slope2Bps } = asset.curve;
  if (utilizationBps <= kinkBps) return baseBps + Math.floor((slope1Bps * utilizationBps) / kinkBps);
  return baseBps + slope1Bps + Math.floor((slope2Bps * (utilizationBps - kinkBps)) / (10_000 - kinkBps));
}

const SHARE_SCALE = 10n ** 12n;

/** Supply ÷ total shares, floored to 12 decimals. */
export function sharePrice(supply: bigint, totalShares: bigint): string {
  return fixedText(totalShares === 0n ? SHARE_SCALE : (supply * SHARE_SCALE) / totalShares, 12);
}

/** A holder's share value, floored. */
export function shareValue(shares: bigint, supply: bigint, totalShares: bigint): bigint {
  return totalShares === 0n ? 0n : (shares * supply) / totalShares;
}

/** Shares minted for supplying x, rounded in the pool's favour. */
export function sharesForSupply(x: bigint, supply: bigint, totalShares: bigint): bigint {
  return totalShares === 0n ? x : (x * totalShares) / supply;
}

/** Shares burned for withdrawing y, rounded in the pool's favour. */
export function sharesForWithdrawal(y: bigint, supply: bigint, totalShares: bigint): bigint {
  return ceilDiv(y * totalShares, supply);
}

export async function poolJson(tx: Tx, asset: Asset, now: Date, oracleStatus: OracleStatus) {
  const balances = await poolBalances(tx, asset.asset);
  const figures = poolFigures(asset, balances);
  return {
    asset: asset.asset,
    name: asset.name,
    decimals: asset.decimals,
    price: plainPrice(asset.price),
    price_posted_at: toInstant(asset.pricePostedAt),
    price_age_seconds: priceAge(asset, now),
    price_source: asset.priceSource,
    oracle_round: asset.oracleRound,
    oracle_status: oracleStatus,
    market_state: isStale(asset, now) ? "stale_feed" : "open",
    available_liquidity: figures.availableLiquidity.toString(),
    total_borrowed: figures.totalBorrowed.toString(),
    utilization_bps: figures.utilizationBps,
    borrow_rate_bps: figures.borrowRateBps,
    supply_rate_bps: figures.supplyRateBps,
    borrow_index: asset.borrowIndex.toString(),
    supply_balance: balances.supply.toString(),
    reserve_balance: balances.reserve.toString(),
    swap_balance: balances.swap.toString(),
    total_shares: asset.totalShares.toString(),
    share_price: sharePrice(balances.supply, asset.totalShares),
    params: {
      ltv_bps: asset.ltvBps,
      liquidation_threshold_bps: asset.liquidationThresholdBps,
      liquidation_bonus_bps: asset.liquidationBonusBps,
      reserve_factor_bps: asset.reserveFactorBps,
      close_factor_bps: asset.closeFactorBps,
      swap_fee_bps: asset.swapFeeBps,
      warning_health_factor: fixedText(BigInt(asset.warningHealthFactorBps), 4),
    },
    curve: {
      base_bps: asset.curve.baseBps,
      slope1_bps: asset.curve.slope1Bps,
      kink_bps: asset.curve.kinkBps,
      slope2_bps: asset.curve.slope2Bps,
    },
  };
}

export async function availableLiquidity(tx: Tx, asset: Asset): Promise<bigint> {
  return poolFigures(asset, await poolBalances(tx, asset.asset)).availableLiquidity;
}

export function assetOf(market: Market, code: string): Asset {
  const found = market.get(code);
  if (!found) throw new Error(`unlisted asset ${code}`);
  return found;
}
