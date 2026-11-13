/**
 * The published pool object. Every figure in it is computed from ledger
 * balances at the moment of reading; total shares is the only non-ledger one.
 */

import type { Queryable } from '../db/pool.ts';
import { apiAmount, apiPrice, apiSharePrice } from '../domain/apiformat.ts';
import { assetDecimals, assetName, type Asset } from '../domain/assets.ts';
import { formatCanonicalUtc } from '../domain/desktime.ts';
import { borrowRateBps, supplyRateBps } from '../domain/interest.ts';
import { poolFigures, sharePriceScaled } from '../domain/pool.ts';
import { WARNING_HEALTH_FACTOR } from '../domain/position.ts';
import { poolBalances } from '../ledger/postings.ts';
import { currentOracleStatus } from '../services/oracle-status.ts';
import { marketState, priceAgeSeconds, type AssetState } from './state.ts';

export async function poolDto(
  client: Queryable,
  state: AssetState,
  nowMs: number,
): Promise<Record<string, unknown>> {
  const { settings, price } = state;
  const asset: Asset = settings.asset;
  const balances = await poolBalances(client, asset);
  const figures = poolFigures(balances);
  const borrowRate = borrowRateBps(figures.utilizationBps, settings.curve);

  return {
    asset,
    name: assetName(asset),
    decimals: assetDecimals(asset),
    price: apiPrice(price.price),
    price_posted_at: formatCanonicalUtc(price.postedAtMs),
    price_age_seconds: priceAgeSeconds(price, nowMs),
    price_source: price.source,
    oracle_round: price.source === 'oracle' ? price.oracleRound : null,
    oracle_status: currentOracleStatus(asset),
    market_state: marketState(price, nowMs),
    available_liquidity: apiAmount(figures.availableLiquidity),
    total_borrowed: apiAmount(figures.totalBorrowed),
    utilization_bps: Number(figures.utilizationBps),
    borrow_rate_bps: Number(borrowRate),
    supply_rate_bps: Number(
      supplyRateBps(borrowRate, figures.utilizationBps, settings.reserveFactorBps),
    ),
    borrow_index: apiAmount(settings.borrowIndex),
    supply_balance: apiAmount(balances.supply),
    reserve_balance: apiAmount(balances.reserve),
    swap_balance: apiAmount(balances.swap),
    total_shares: apiAmount(settings.totalShares),
    share_price: apiSharePrice(sharePriceScaled(balances.supply, settings.totalShares)),
    params: {
      ltv_bps: Number(settings.ltvBps),
      liquidation_threshold_bps: Number(settings.liquidationThresholdBps),
      liquidation_bonus_bps: Number(settings.liquidationBonusBps),
      reserve_factor_bps: Number(settings.reserveFactorBps),
      close_factor_bps: Number(settings.closeFactorBps),
      swap_fee_bps: Number(settings.swapFeeBps),
      warning_health_factor: apiHealthFactorLiteral(),
    },
    curve: {
      base_bps: Number(settings.curve.baseBps),
      slope1_bps: Number(settings.curve.slope1Bps),
      kink_bps: Number(settings.curve.kinkBps),
      slope2_bps: Number(settings.curve.slope2Bps),
    },
  };
}

/** The warning level, in the API's health factor form. */
function apiHealthFactorLiteral(): string {
  const whole = WARNING_HEALTH_FACTOR / 10000n;
  const fraction = (WARNING_HEALTH_FACTOR % 10000n).toString().padStart(4, '0');
  return `${whole.toString()}.${fraction}`;
}
