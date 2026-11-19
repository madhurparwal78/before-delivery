import { inTransaction, pool } from '../db/pool.js';
import { applyClose, newEffects, runMaintenance, settleMarket } from '../domain/engine.js';
import { publishEffects, recordOutgoing } from '../publish.js';
import type { MarketRow } from '../domain/types.js';

const MARKET_COLUMNS =
  'id, venue_id, kind, symbol, title, status, closes_at, outcome, last_price, book_sequence, resolved_at, settled_at';

/** Within 2 seconds after every fill on a pair, every open margin position is checked. */
const MAINTENANCE_DELAY_MS = 250;
const SETTLEMENT_DELAY_MS = 250;
const CLOSE_SWEEP_MS = 1000;

const pendingMaintenance = new Set<string>();

export function scheduleMaintenance(marketId: string): void {
  if (pendingMaintenance.has(marketId)) return;
  pendingMaintenance.add(marketId);
  setTimeout(() => {
    pendingMaintenance.delete(marketId);
    void checkMaintenance(marketId).catch(() => undefined);
  }, MAINTENANCE_DELAY_MS).unref();
}

export async function checkMaintenance(marketId: string): Promise<void> {
  const effects = newEffects();
  await inTransaction(async (client) => {
    const result = await client.query<MarketRow>(`select ${MARKET_COLUMNS} from markets where id = $1`, [
      marketId,
    ]);
    const market = result.rows[0];
    if (market === undefined || market.kind !== 'pair') return;
    await runMaintenance(client, market, effects);
    await recordOutgoing(client, effects);
  });
  await publishEffects(effects);
}

export function scheduleMarketClose(market: MarketRow): void {
  if (market.kind !== 'event' || market.closes_at === null) return;
  const delay = market.closes_at.getTime() - Date.now();
  if (delay > 2_147_000_000) return;
  setTimeout(() => void closeDueMarkets().catch(() => undefined), Math.max(delay, 0) + 50).unref();
}

/** An event stops trading at its server-set close instant, whatever the device clock says. */
export async function closeDueMarkets(): Promise<void> {
  const due = await pool.query<{ id: string }>(
    `select id from markets
      where kind = 'event' and status in ('trading','halted') and closes_at <= now()`,
  );
  for (const row of due.rows) {
    const effects = newEffects();
    await inTransaction(async (client) => {
      const result = await client.query<MarketRow>(
        `select ${MARKET_COLUMNS} from markets where id = $1 for update`,
        [row.id],
      );
      const market = result.rows[0];
      if (market !== undefined) await applyClose(client, market, effects);
    });
    await publishEffects(effects);
  }
}

export function scheduleSettlement(marketId: string): void {
  setTimeout(
    () => void settleResolvedMarkets(marketId).catch(() => undefined),
    SETTLEMENT_DELAY_MS,
  ).unref();
}

/** Within 5 seconds of a resolution, payouts post exactly once and the market becomes settled. */
export async function settleResolvedMarkets(marketId?: string): Promise<void> {
  const due = await pool.query<{ id: string }>(
    `select id from markets where status = 'resolved' and ($1::uuid is null or id = $1)`,
    [marketId ?? null],
  );
  for (const row of due.rows) {
    const effects = newEffects();
    await inTransaction(async (client) => {
      const result = await client.query<MarketRow>(
        `select ${MARKET_COLUMNS} from markets where id = $1 for update`,
        [row.id],
      );
      const market = result.rows[0];
      if (market !== undefined) await settleMarket(client, market, effects);
    });
    await publishEffects(effects);
  }
}

export function startTimers(): () => void {
  const closeSweep = setInterval(() => {
    void closeDueMarkets().catch(() => undefined);
    void settleResolvedMarkets().catch(() => undefined);
  }, CLOSE_SWEEP_MS);
  closeSweep.unref();
  return () => clearInterval(closeSweep);
}
