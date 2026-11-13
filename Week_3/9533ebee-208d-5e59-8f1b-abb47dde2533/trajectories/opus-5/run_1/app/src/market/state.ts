/**
 * Reading an asset's stored settings and its price in force, and the one
 * place that decides whether a market is stale.
 */

import { config } from '../config.ts';
import { readBig, readInstant, type Queryable } from '../db/pool.ts';
import { ASSET_CODES, type Asset } from '../domain/assets.ts';
import type { RateCurve } from '../domain/interest.ts';

export interface AssetSettings {
  readonly asset: Asset;
  readonly ltvBps: bigint;
  readonly liquidationThresholdBps: bigint;
  readonly liquidationBonusBps: bigint;
  readonly reserveFactorBps: bigint;
  readonly closeFactorBps: bigint;
  readonly swapFeeBps: bigint;
  readonly curve: RateCurve;
  readonly borrowIndex: bigint;
  readonly indexUpdatedAtMs: number;
  readonly totalShares: bigint;
  readonly currentPricePostId: string | null;
  readonly riskVersion: bigint;
}

export interface PriceInForce {
  readonly pricePostId: string;
  readonly price: bigint;
  readonly postedAtMs: number;
  readonly source: 'manual' | 'oracle';
  readonly oracleRound: number | null;
}

interface AssetJoinRow {
  asset: string;
  ltv_bps: number;
  liquidation_threshold_bps: number;
  liquidation_bonus_bps: number;
  reserve_factor_bps: number;
  close_factor_bps: number;
  swap_fee_bps: number;
  base_bps: number;
  slope1_bps: number;
  kink_bps: number;
  slope2_bps: number;
  borrow_index: string;
  index_updated_at: Date;
  total_shares: string;
  current_price_post_id: string | null;
  risk_version: string;
  price_post_id: string | null;
  price: string | null;
  posted_at: Date | null;
  source: string | null;
  oracle_round: number | null;
}

const ASSET_SELECT = `
  SELECT a.asset, a.ltv_bps, a.liquidation_threshold_bps, a.liquidation_bonus_bps,
         a.reserve_factor_bps, a.close_factor_bps, a.swap_fee_bps,
         a.base_bps, a.slope1_bps, a.kink_bps, a.slope2_bps,
         a.borrow_index, a.index_updated_at, a.total_shares,
         a.current_price_post_id, a.risk_version,
         p.price_post_id, p.price, p.posted_at, p.source, p.oracle_round
  FROM assets a
  LEFT JOIN price_posts p ON p.price_post_id = a.current_price_post_id`;

function readSettings(row: AssetJoinRow): AssetSettings {
  return {
    asset: row.asset as Asset,
    ltvBps: BigInt(row.ltv_bps),
    liquidationThresholdBps: BigInt(row.liquidation_threshold_bps),
    liquidationBonusBps: BigInt(row.liquidation_bonus_bps),
    reserveFactorBps: BigInt(row.reserve_factor_bps),
    closeFactorBps: BigInt(row.close_factor_bps),
    swapFeeBps: BigInt(row.swap_fee_bps),
    curve: {
      baseBps: BigInt(row.base_bps),
      slope1Bps: BigInt(row.slope1_bps),
      kinkBps: BigInt(row.kink_bps),
      slope2Bps: BigInt(row.slope2_bps),
    },
    borrowIndex: readBig(row.borrow_index),
    indexUpdatedAtMs: readInstant(row.index_updated_at),
    totalShares: readBig(row.total_shares),
    currentPricePostId: row.current_price_post_id,
    riskVersion: BigInt(row.risk_version),
  };
}

function readPrice(row: AssetJoinRow): PriceInForce {
  if (row.price_post_id === null || row.price === null || row.posted_at === null) {
    throw new Error(`Asset ${row.asset} has no price in force`);
  }
  return {
    pricePostId: row.price_post_id,
    price: readBig(row.price),
    postedAtMs: readInstant(row.posted_at),
    source: row.source === 'oracle' ? 'oracle' : 'manual',
    oracleRound: row.oracle_round,
  };
}

export interface AssetState {
  readonly settings: AssetSettings;
  readonly price: PriceInForce;
}

export async function loadAsset(client: Queryable, asset: Asset): Promise<AssetState> {
  const result = await client.query<AssetJoinRow>(`${ASSET_SELECT} WHERE a.asset = $1`, [
    asset,
  ]);
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Unknown asset ${asset}`);
  return { settings: readSettings(row), price: readPrice(row) };
}

export type AssetStates = Readonly<Record<Asset, AssetState>>;

export async function loadAssets(client: Queryable): Promise<AssetStates> {
  const result = await client.query<AssetJoinRow>(ASSET_SELECT);
  const byAsset = new Map(result.rows.map((row) => [row.asset, row]));
  const states: Partial<Record<Asset, AssetState>> = {};
  for (const asset of ASSET_CODES) {
    const row = byAsset.get(asset);
    if (row === undefined) throw new Error(`Unknown asset ${asset}`);
    states[asset] = { settings: readSettings(row), price: readPrice(row) };
  }
  return states as AssetStates;
}

/** The age of a price in whole seconds at the given instant. */
export function priceAgeSeconds(price: PriceInForce, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - price.postedAtMs) / 1000));
}

export type MarketState = 'open' | 'stale_feed';

/**
 * A market is stale while server now minus the publication of its current
 * price is more than the staleness limit. Because an oracle post's
 * `posted_at` is its publication time, staleness runs from publication.
 */
export function marketState(price: PriceInForce, nowMs: number): MarketState {
  return priceAgeSeconds(price, nowMs) > config.stalenessSeconds ? 'stale_feed' : 'open';
}

export function isStale(price: PriceInForce, nowMs: number): boolean {
  return marketState(price, nowMs) === 'stale_feed';
}
