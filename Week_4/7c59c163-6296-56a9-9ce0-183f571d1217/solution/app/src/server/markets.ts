import type pg from "pg";
import { CONTRACT_CENTS, targetOf, transitionAllowed, type MarketAction } from "../shared/rules.js";
import { pool, rows, tx } from "./db.js";
import { conflict } from "./errors.js";
import { account, post } from "./ledger.js";
import { enqueueWebhook } from "./outbox.js";
import { Changes, publishLater } from "./stream.js";
import { endOrder } from "./trading.js";
import { marketRow, venueById, type MarketRow, type OrderRow } from "./views.js";

/** Applies one step of the market state machine, or answers the invalid_transition 409. */
export async function transition(client: pg.PoolClient, market: MarketRow, action: MarketAction, changes: Changes): Promise<void> {
  const closePassed = market.closes_at !== null && market.closes_at.getTime() <= Date.now();
  if (!transitionAllowed(market.kind, market.status, action, closePassed)) {
    throw conflict("invalid_transition", { from: market.status, to: targetOf(action) });
  }
  await client.query("UPDATE markets SET status = $2 WHERE id = $1", [market.id, targetOf(action)]);
  changes.markets.add(market.id);
}

/**
 * Brings a stored status in line with the close instant: an event past `closes_at` becomes closed and
 * its resting orders are cancelled. The caller holds the market lock.
 */
export async function closeIfDue(client: pg.PoolClient, market: MarketRow, changes: Changes): Promise<MarketRow> {
  if (market.status !== "closed" || market.stored_status === "closed") return market;
  await client.query("UPDATE markets SET status = 'closed' WHERE id = $1", [market.id]);
  const resting = await rows<OrderRow>(client, "SELECT * FROM orders WHERE market_id = $1 AND status IN ('resting', 'partially_filled') FOR UPDATE", [market.id]);
  for (const order of resting) await endOrder(client, order, "cancelled", changes);
  changes.markets.add(market.id);
  return { ...market, stored_status: "closed" };
}

/** Pays each winning contract 100 cents from escrow, exactly once, and moves the market to settled. */
export async function settle(marketId: string): Promise<void> {
  const changes = new Changes();
  await tx(async (client) => {
    await client.query("SELECT 1 FROM markets WHERE id = $1 FOR NO KEY UPDATE", [marketId]);
    const market = await marketRow(client, marketId);
    if (market.status !== "resolved") return;
    const venue = await venueById(client, market.venue_id);
    const holders = await rows<{ id: string; member_id: string; outcome: string; quantity: number; is_builder: boolean }>(
      client,
      `SELECT e.id, e.member_id, e.outcome, e.quantity, 'builder' = ANY(m.roles) AS is_builder
         FROM event_positions e JOIN members m ON m.id = e.member_id
        WHERE e.market_id = $1 AND e.quantity > 0 ORDER BY e.member_id`,
      [market.id],
    );
    const settledAt = new Date().toISOString();
    for (const holder of holders) {
      const payout = holder.outcome === market.outcome ? holder.quantity * CONTRACT_CENTS : 0;
      if (payout > 0) {
        await post(client, market.venue_id, "payout", market.id, [[account.escrow(market.id), -payout], [account.available(holder.member_id), payout]]);
        changes.members.add(holder.member_id);
      }
      if (holder.is_builder) {
        await enqueueWebhook(client, market.venue_id, {
          venueSlug: venue.slug,
          venueName: venue.name,
          memberId: holder.member_id,
          eventType: "event.settled",
          payload: {
            event_id: `settle_${market.id}_${holder.id}`,
            type: "event.settled",
            venue: venue.slug,
            market_id: market.id,
            outcome: market.outcome,
            contracts: holder.quantity,
            payout_cents: payout,
            settled_at: settledAt,
          },
        });
      }
    }
    await client.query("UPDATE event_positions SET quantity = 0 WHERE market_id = $1", [market.id]);
    await transition(client, market, "settle", changes);
  });
  publishLater(changes);
}

/** Close timer and settlement sweep: server clock only. */
export async function sweepMarkets(): Promise<void> {
  const due = await rows<{ id: string }>(pool, "SELECT id FROM markets WHERE kind = 'event' AND status IN ('trading', 'halted') AND closes_at <= now()");
  for (const { id } of due) {
    const changes = new Changes();
    await tx(async (client) => {
      await client.query("SELECT 1 FROM markets WHERE id = $1 FOR NO KEY UPDATE", [id]);
      await closeIfDue(client, await marketRow(client, id), changes);
    });
    publishLater(changes);
  }
  const resolved = await rows<{ id: string }>(pool, "SELECT id FROM markets WHERE status = 'resolved'");
  for (const { id } of resolved) await settle(id);
}
