import type pg from "pg";
import { equityFor, maintenanceFor } from "../shared/rules.js";
import { one, rows, tx } from "./db.js";
import { account, post } from "./ledger.js";
import { enqueueWebhook } from "./outbox.js";
import { Changes, publishLater } from "./stream.js";
import { endOrder } from "./trading.js";
import { marketRow, venueById, type MarketRow, type OrderRow } from "./views.js";

interface PositionRow {
  id: string;
  member_id: string;
  side: "long" | "short";
  quantity: number;
  cost_cents: number;
  collateral_cents: number;
  is_builder: boolean;
}

interface Liquidated {
  position_id: string;
  quantity: number;
  mark_price: number;
  returned_cents: number;
}

/**
 * Checks every open margin position on the pair at the mark (the last trade price) and liquidates
 * each one whose equity is below maintenance. The caller holds the market lock.
 */
export async function maintenanceCheck(client: pg.PoolClient, market: MarketRow, changes: Changes): Promise<{ checked: number; liquidated: Liquidated[] }> {
  const mark = market.last_price;
  const positions = await rows<PositionRow>(
    client,
    `SELECT p.id, p.member_id, p.side, p.quantity, p.cost_cents, p.collateral_cents, 'builder' = ANY(m.roles) AS is_builder
       FROM margin_positions p JOIN members m ON m.id = p.member_id
      WHERE p.market_id = $1 AND p.status = 'open' ORDER BY p.opened_at FOR UPDATE OF p`,
    [market.id],
  );
  const liquidated: Liquidated[] = [];
  if (mark === null) return { checked: positions.length, liquidated };
  for (const p of positions) {
    const equity = equityFor(p.side, p.collateral_cents, p.cost_cents, p.quantity, mark);
    if (equity >= maintenanceFor(p.quantity, mark)) continue;
    const returned = Math.max(equity, 0);
    const value = p.quantity * mark;
    await post(client, market.venue_id, "liquidation", p.id, [
      [account.collateral(p.member_id), -p.collateral_cents],
      [account.lending(market.id), p.side === "long" ? p.cost_cents - value : value - p.cost_cents],
      [account.available(p.member_id), returned],
      [account.insurance, Math.min(equity, 0)],
    ]);
    await client.query("UPDATE margin_positions SET status = 'liquidated' WHERE id = $1", [p.id]);
    const resting = await rows<OrderRow>(
      client,
      "SELECT * FROM orders WHERE member_id = $1 AND market_id = $2 AND mode = 'margin' AND status IN ('resting', 'partially_filled') FOR UPDATE",
      [p.member_id, market.id],
    );
    for (const order of resting) await endOrder(client, order, "liquidated", changes);
    const result = { position_id: p.id, quantity: p.quantity, mark_price: mark, returned_cents: returned };
    liquidated.push(result);
    changes.members.add(p.member_id);
    changes.markets.add(market.id);
    changes.liquidations.push({ memberId: p.member_id, position_id: p.id, market_id: market.id, mark_price: mark });
    if (p.is_builder) {
      const venue = await venueById(client, market.venue_id);
      const at = await one<{ now: Date }>(client, "SELECT clock_timestamp() AS now");
      await enqueueWebhook(client, market.venue_id, {
        venueSlug: venue.slug,
        venueName: venue.name,
        memberId: p.member_id,
        eventType: "position.liquidated",
        payload: {
          event_id: `liq_${p.id}`,
          type: "position.liquidated",
          venue: venue.slug,
          market_id: market.id,
          position_id: p.id,
          side: p.side,
          quantity: p.quantity,
          mark_price: mark,
          returned_cents: returned,
          liquidated_at: (at?.now ?? new Date()).toISOString(),
        },
      });
    }
  }
  return { checked: positions.length, liquidated };
}

/** The post-fill check, run right after the fill commits (well inside the 2-second rule). */
export function scheduleMaintenance(marketId: string): void {
  setImmediate(() => {
    const changes = new Changes();
    tx(async (client) => {
      await client.query("SELECT 1 FROM markets WHERE id = $1 FOR NO KEY UPDATE", [marketId]);
      await maintenanceCheck(client, await marketRow(client, marketId), changes);
    })
      .then(() => publishLater(changes))
      .catch((error: unknown) => console.error("maintenance check failed:", error instanceof Error ? error.message : error));
  });
}
