import { createEl, announce, showProblem, clearProblem } from './ui.js';
import { deskAmountOf, deskPercent, deskPriceOf, deskDuration, setDeskTimeZone, deskWallTime } from './desk.js';
import type { Actor, AssetCode, OracleStatus, PoolsResponse, Pool, WalletResponse } from './types.js';
import { ASSET_NAMES } from './types.js';
import { getPools, getWallet } from './api.js';

export interface WorldState {
  pools: Pool[];
  stalenessSeconds: number;
  graceSeconds: number;
  quoteSeconds: number;
  deskTimeZone: string;
  wallet: WalletResponse | null;
}

const ORACLE_LINES: Record<OracleStatus, string | null> = {
  ok: null,
  unreachable: 'Couldn\u2019t reach the price oracle \u2013 showing the last good price',
  malformed: 'The price oracle sent an unreadable reading \u2013 showing the last good price',
  old_round: 'The price oracle sent an older round \u2013 ignored',
  not_newer: 'Manual post holds \u2013 the oracle has nothing newer',
  large_move: 'The oracle moved more than 60% \u2013 not applied, post it by hand to accept it',
  evidence_unavailable: 'Couldn\u2019t store the oracle evidence \u2013 showing the last good price',
};

export function renderPoolColumn(container: HTMLElement, world: WorldState): void {
  container.replaceChildren();
  for (const pool of world.pools) {
    const article = createEl('article', `${pool.asset} pool`, pool.asset);
    const title = createEl('h3', '', 'pool-title');
    title.append(
      createEl('span', '', 'code', pool.asset),
      createEl('span', '', 'name', ASSET_NAMES[pool.asset]),
    );
    article.append(title);
    article.append(poolRow('Available liquidity', deskAmountOf(pool.available_liquidity, pool.asset)));
    article.append(poolRow('Total borrowed', deskAmountOf(pool.total_borrowed, pool.asset)));
    article.append(poolRow('Utilization', deskPercent(pool.utilization_bps)));
    const sharePriceRow = poolRow('Share price', pool.share_price.replace('.', ','));
    sharePriceRow.querySelector<HTMLElement>('.v')?.classList.add('rise');
    article.append(sharePriceRow);
    article.append(poolRow('Borrow rate', deskPercent(pool.borrow_rate_bps)));
    article.append(poolRow('Supply rate', deskPercent(pool.supply_rate_bps)));
    container.append(article);
  }
}

function poolRow(label: string, value: string): HTMLElement {
  const row = createEl('div', '', 'kv');
  const key = createEl('span', '', 'k');
  key.textContent = label;
  const val = createEl('span', '', 'v num');
  val.textContent = value;
  row.append(key, val);
  return row;
}

export function renderPriceRail(container: HTMLElement, world: WorldState): void {
  container.replaceChildren();
  const groups = createEl('div', '', 'pricegroups');
  for (const pool of world.pools) {
    const group = createEl('div', `${pool.asset} price`, 'pricegroup');
    const priceLine = createEl('div', '', 'price num');
    priceLine.textContent = deskPriceOf(pool.price);
    group.append(priceLine);
    const sourceLine = createEl('div', '', 'source mono');
    sourceLine.textContent = pool.price_source === 'oracle' ? `Oracle round ${pool.oracle_round ?? ''}` : 'Manual post';
    group.append(sourceLine);
    const ageLine = createEl('div', '', 'age mono');
    ageLine.textContent = `Posted ${pool.price_age_seconds} seconds ago`;
    group.append(ageLine);
    const line = ORACLE_LINES[pool.oracle_status];
    if (line !== null) {
      const statusLine = createEl('div', '', 'oracleline');
      statusLine.textContent = line;
      group.append(statusLine);
    }
    groups.append(group);
  }
  container.append(groups);
  const staleAssets = world.pools.filter((pool): boolean => pool.market_state === 'stale_feed');
  if (staleAssets.length > 0) {
    const banner = createEl('div', '', 'banner');
    banner.setAttribute('role', 'alert');
    const text = createEl('p', 'Price feed', '');
    text.textContent = 'Price feed stale. Borrowing, withdrawals of collateral and liquidations are paused.';
    banner.append(text);
    for (const pool of staleAssets) {
      const line = createEl('p', '', 'mono');
      line.textContent = `${pool.asset} price is ${pool.price_age_seconds} seconds old.`;
      banner.append(line);
    }
    container.append(banner);
  }
  const durations = createEl('div', '', 'durations');
  durations.append(kv('Grace period', deskDuration(world.graceSeconds)));
  durations.append(kv('Quote lifetime', deskDuration(world.quoteSeconds)));
  durations.append(kv('Staleness limit', deskDuration(world.stalenessSeconds)));
  container.append(durations);
}

function kv(label: string, value: string): HTMLElement {
  const row = createEl('div', '', 'kv');
  const key = createEl('span', '', 'k');
  key.textContent = label;
  const val = createEl('span', '', 'v num');
  val.textContent = value;
  row.append(key, val);
  return row;
}

export function renderWallet(container: HTMLElement, world: WorldState): void {
  const values = world.wallet === null
    ? (['QUSD', 'MBTC', 'METH'] as AssetCode[]).map((asset): { asset: AssetCode; amount: string } => ({ asset, amount: '0' }))
    : world.wallet.balances;
  container.replaceChildren();
  const heading = createEl('h3', '', '');
  heading.textContent = 'Wallet';
  container.append(heading);
  for (const balance of values) {
    container.append(poolRow(balance.asset, deskAmountOf(balance.amount, balance.asset)));
  }
}

export interface WorldRefreshOptions {
  needWallet: boolean;
}

/** Refresh the shared zones: pools, prices, wallet, banner. */
export async function refreshWorld(onStaleView: (world: WorldState) => void, options: WorldRefreshOptions): Promise<WorldState> {
  const poolsResponse: PoolsResponse = await getPools();
  setDeskTimeZone(poolsResponse.desk_time_zone);
  const world: WorldState = {
    pools: poolsResponse.pools,
    stalenessSeconds: parseDuration(poolsResponse.staleness_limit),
    graceSeconds: parseDuration(poolsResponse.grace_period),
    quoteSeconds: parseDuration(poolsResponse.quote_lifetime),
    deskTimeZone: poolsResponse.desk_time_zone,
    wallet: options.needWallet ? await getWallet().catch((): null => null) : null,
  };
  onStaleView(world);
  return world;
}

export function parseDuration(iso: string): number {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (match === null) return 0;
  const hours = match[1] === undefined ? 0 : Number.parseInt(match[1], 10);
  const minutes = match[2] === undefined ? 0 : Number.parseInt(match[2], 10);
  const seconds = match[3] === undefined ? 0 : Number.parseInt(match[3], 10);
  return hours * 3600 + minutes * 60 + seconds;
}

export { announce, showProblem, clearProblem, deskWallTime };
