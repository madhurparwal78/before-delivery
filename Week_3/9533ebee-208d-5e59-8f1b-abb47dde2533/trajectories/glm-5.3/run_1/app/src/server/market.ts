import type { Tx, Pool } from './db.js';
import type { AssetCode, OracleStatus, PositionState } from '../shared/types.js';
import { ASSETS } from '../shared/assets.js';
import { getConfig } from './config.js';
import { poolFigures, sharePrice, healthFactorScaled, liquidationPrice, liquidationLimits } from './domain.js';
import { poolBalances, poolRates, type PoolRow } from './ledger.js';
import { evaluatePosition, applyEvaluation, hfApi, type PositionRow } from './evaluation.js';
import { listNotices } from './positions.js';
import { accrueAsset } from './ledger.js';
import { processOracleStatus } from './oracleStatus.js';
import { deskPercent } from '../shared/deskFormat.js';

export interface CurrentPrice {
  asset: AssetCode;
  price: bigint;
  posted_at: Date;
  posted_by: string;
  source: 'manual' | 'oracle';
  oracle_round: string | null;
}

export async function currentPrices(client: Tx['client']): Promise<Map<AssetCode, CurrentPrice>> {
  const result = await client.query<{ asset: AssetCode; price: string; posted_at: Date; posted_by: string; source: 'manual' | 'oracle'; oracle_round: string | null }>(
    `SELECT pp.asset, pp.price, pp.posted_at, pp.posted_by, pp.source, pp.oracle_round::text AS oracle_round
     FROM current_prices cp JOIN price_posts pp ON pp.price_post_id = cp.price_post_id`,
  );
  const map = new Map<AssetCode, CurrentPrice>();
  for (const row of result.rows) {
    map.set(row.asset, {
      asset: row.asset,
      price: BigInt(row.price),
      posted_at: row.posted_at,
      posted_by: row.posted_by,
      source: row.source,
      oracle_round: row.oracle_round,
    });
  }
  return map;
}

export function isStale(price: CurrentPrice, now: Date): boolean {
  const age = Math.floor(now.getTime() / 1000) - Math.floor(price.posted_at.getTime() / 1000);
  return age > getConfig().stalenessSeconds;
}

export async function oracleStatus(asset: AssetCode): Promise<OracleStatus> {
  return processOracleStatus(asset);
}

export interface PoolView {
  asset: string;
  name: string;
  decimals: number;
  price: string;
  price_posted_at: string;
  price_age_seconds: number;
  price_source: 'manual' | 'oracle';
  oracle_round: string | null;
  oracle_status: OracleStatus;
  market_state: 'open' | 'stale_feed';
  available_liquidity: string;
  total_borrowed: string;
  utilization_bps: number;
  borrow_rate_bps: number;
  supply_rate_bps: number;
  borrow_index: string;
  supply_balance: string;
  reserve_balance: string;
  swap_balance: string;
  total_shares: string;
  share_price: string;
  params: {
    ltv_bps: number;
    liquidation_threshold_bps: number;
    liquidation_bonus_bps: number;
    reserve_factor_bps: number;
    close_factor_bps: number;
    swap_fee_bps: number;
    warning_health_factor: string;
  };
  curve: { base_bps: number; slope1_bps: number; kink_bps: number; slope2_bps: number };
}

export function priceApi(price: bigint): string {
  const base = price.toString().padStart(9, '0');
  return `${base.slice(0, base.length - 8)}.${base.slice(base.length - 8)}`;
}

export function sharePriceApi(scaled: bigint): string {
  const base = scaled.toString().padStart(13, '0');
  return `${base.slice(0, base.length - 12)}.${base.slice(base.length - 12)}`;
}

export async function poolView(client: Tx['client'], asset: AssetCode, now: Date, row?: PoolRow): Promise<PoolView> {
  const poolRow = row ?? await (async (): Promise<PoolRow> => {
    const result = await client.query<PoolRow>('SELECT * FROM pools WHERE asset = $1', [asset]);
    return result.rows[0];
  })();
  const balances = await poolBalances(client, asset);
  const figures = poolFigures(balances);
  const rates = poolRates(poolRow, figures.utilization_bps);
  const prices = await currentPrices(client);
  const price = prices.get(asset);
  if (price === undefined) throw new Error('missing price');
  const ageSeconds = Math.max(0, Math.floor(now.getTime() / 1000) - Math.floor(price.posted_at.getTime() / 1000));
  const status = await oracleStatus(asset);
  const totalShares = BigInt(poolRow.total_shares);
  return {
    asset,
    name: ASSETS[asset].name,
    decimals: ASSETS[asset].decimals,
    price: priceApi(price.price),
    price_posted_at: canonical(price.posted_at),
    price_age_seconds: ageSeconds,
    price_source: price.source,
    oracle_round: price.oracle_round,
    oracle_status: status,
    market_state: isStale(price, now) ? 'stale_feed' : 'open',
    available_liquidity: figures.available_liquidity.toString(),
    total_borrowed: figures.total_borrowed.toString(),
    utilization_bps: figures.utilization_bps,
    borrow_rate_bps: rates.borrow_rate_bps,
    supply_rate_bps: rates.supply_rate_bps,
    borrow_index: poolRow.borrow_index,
    supply_balance: balances.supply.toString(),
    reserve_balance: await reserveBalance(client, asset),
    swap_balance: balances.swap.toString(),
    total_shares: totalShares.toString(),
    share_price: sharePriceApi(sharePrice(balances.supply, totalShares)),
    params: {
      ltv_bps: poolRow.ltv_bps,
      liquidation_threshold_bps: poolRow.liquidation_threshold_bps,
      liquidation_bonus_bps: poolRow.liquidation_bonus_bps,
      reserve_factor_bps: poolRow.reserve_factor_bps,
      close_factor_bps: poolRow.close_factor_bps,
      swap_fee_bps: poolRow.swap_fee_bps,
      warning_health_factor: '1.1000',
    },
    curve: {
      base_bps: poolRow.curve_base_bps,
      slope1_bps: poolRow.curve_slope1_bps,
      kink_bps: poolRow.curve_kink_bps,
      slope2_bps: poolRow.curve_slope2_bps,
    },
  };
}

async function reserveBalance(client: Tx['client'], asset: AssetCode): Promise<string> {
  const result = await client.query<{ balance: string }>('SELECT balance FROM balances WHERE account = $1 AND asset = $2', ['reserve', asset]);
  return result.rows.length > 0 ? result.rows[0].balance : '0';
}

export function canonical(instant: Date): string {
  return instant.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export interface PositionView {
  position_id: string;
  borrower_id: string;
  collateral_asset: AssetCode;
  debt_asset: AssetCode;
  collateral_amount: string;
  debt: string;
  health_factor: string | null;
  liquidation_price: string | null;
  state: PositionState;
  grace_ends_at: string | null;
  round: string;
  max_repay: string;
  notices: Array<{ notice_id: string; kind: 'margin' | 'liquidation'; status: 'queued' | 'sent'; created_at: string; sent_at: string | null }>;
  created_at: string;
  server_time: string;
}

export async function loadPositionRow(tx: Tx, positionId: string): Promise<PositionRow | null> {
  const result = await tx.query<PositionRow>(
    'SELECT * FROM positions WHERE position_id = $1 FOR UPDATE',
    [positionId],
  );
  return result.rows[0] ?? null;
}

export async function loadPositionRowNoLock(client: Tx['client'], positionId: string): Promise<PositionRow | null> {
  const result = await client.query<PositionRow>('SELECT * FROM positions WHERE position_id = $1', [positionId]);
  return result.rows[0] ?? null;
}

/** Evaluate a position against the given prices without writing. */
export function evaluateWithPrices(
  row: PositionRow,
  collateralPrice: bigint,
  debtPrice: bigint,
  thresholdBps: number,
  nowSec: number,
  graceSeconds: number,
) {
  return evaluatePosition(row, {
    collateralPrice, debtPrice, thresholdBps, graceSeconds, nowSec,
  });
}

export function positionFigures(row: PositionRow, collateralPrice: bigint, debtPrice: bigint, thresholdBps: number): { hfScaled: bigint | null; liqPrice: bigint | null } {
  const debt = BigInt(row.posted_debt);
  const collateral = BigInt(row.collateral_amount);
  if (debt === 0n) return { hfScaled: null, liqPrice: null };
  return {
    hfScaled: healthFactorScaled({
      collateralAsset: row.collateral_asset,
      debtAsset: row.debt_asset,
      collateral_amount: collateral,
      collateral_price: collateralPrice,
      debt,
      debt_price: debtPrice,
      liquidation_threshold_bps: thresholdBps,
    }),
    liqPrice: liquidationPrice({
      collateralAsset: row.collateral_asset,
      debtAsset: row.debt_asset,
      collateral_amount: collateral,
      collateral_price: collateralPrice,
      debt,
      debt_price: debtPrice,
      liquidation_threshold_bps: thresholdBps,
    }),
  };
}

export function maxRepay(row: PositionRow, pool: PoolRow, collateralPrice: bigint, debtPrice: bigint): bigint {
  const state = row.state;
  if (state !== 'liquidatable' && state !== 'partially_liquidated') return 0n;
  const limits = liquidationLimits({
    collateralAsset: row.collateral_asset,
    debtAsset: row.debt_asset,
    debt: BigInt(row.posted_debt),
    collateral_amount: BigInt(row.collateral_amount),
    collateral_price: collateralPrice,
    debt_price: debtPrice,
    close_factor_bps: pool.close_factor_bps,
    liquidation_bonus_bps: pool.liquidation_bonus_bps,
  });
  return limits.max_repay;
}

export async function positionView(client: Tx['client'], row: PositionRow, now: Date, graceSeconds: number): Promise<PositionView> {
  const collateralPool = await client.query<PoolRow>('SELECT * FROM pools WHERE asset = $1', [row.collateral_asset]);
  const prices = await currentPrices(client);
  const collateralPrice = prices.get(row.collateral_asset);
  const debtPrice = prices.get(row.debt_asset);
  if (collateralPrice === undefined || debtPrice === undefined) throw new Error('missing price');
  const figures = positionFigures(row, collateralPrice.price, debtPrice.price, collateralPool.rows[0].liquidation_threshold_bps);
  const notices = await listNotices(client, row.position_id);
  return {
    position_id: row.position_id,
    borrower_id: row.borrower_id,
    collateral_asset: row.collateral_asset,
    debt_asset: row.debt_asset,
    collateral_amount: row.collateral_amount,
    debt: row.posted_debt,
    health_factor: figures.hfScaled === null ? null : hfApi(figures.hfScaled),
    liquidation_price: figures.liqPrice === null ? null : priceApi(figures.liqPrice),
    state: row.state,
    grace_ends_at: row.state === 'liquidatable_grace' && row.grace_ends_at !== null
      ? canonical(new Date(Number(row.grace_ends_at) * 1000))
      : null,
    round: row.round,
    max_repay: row.state === 'liquidatable' || row.state === 'partially_liquidated'
      ? maxRepay(row, collateralPool.rows[0], collateralPrice.price, debtPrice.price).toString()
      : '0',
    notices: notices.map((notice): PositionView['notices'][number] => ({
      notice_id: notice.notice_id,
      kind: notice.kind,
      status: notice.status,
      created_at: canonical(notice.created_at),
      sent_at: notice.sent_at === null ? null : canonical(notice.sent_at),
    })),
    created_at: canonical(row.created_at),
    server_time: canonical(now),
  };
  void graceSeconds;
}

/** Bring every asset's debt forward, then re-evaluate every open position. */
export async function refreshAndEvaluate(tx: Tx, now: Date): Promise<void> {
  const nowSec = Math.floor(now.getTime() / 1000);
  for (const code of Object.keys(ASSETS) as AssetCode[]) {
    await accrueAsset(tx, code, nowSec);
  }
  const prices = await currentPrices(tx.client);
  const rows = await tx.query<PositionRow & { threshold: number }>(
    `SELECT p.*, po.liquidation_threshold_bps AS threshold FROM positions p
     JOIN pools po ON po.asset = p.collateral_asset
     WHERE p.state <> 'closed' ORDER BY p.position_id FOR UPDATE OF p`,
  );
  const cfg = getConfig();
  for (const row of rows.rows) {
    const collateralPrice = prices.get(row.collateral_asset);
    const debtPrice = prices.get(row.debt_asset);
    if (collateralPrice === undefined || debtPrice === undefined) continue;
    const positionRow: PositionRow = { ...row };
    const result = evaluatePosition(positionRow, {
      collateralPrice: collateralPrice.price,
      debtPrice: debtPrice.price,
      thresholdBps: row.threshold,
      graceSeconds: cfg.graceSeconds,
      nowSec,
    });
    await applyEvaluation(tx, positionRow, result, now, false);
  }
}
