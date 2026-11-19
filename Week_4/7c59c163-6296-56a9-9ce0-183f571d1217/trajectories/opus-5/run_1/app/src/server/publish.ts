import type { PoolClient } from 'pg';
import { pool } from './db/pool.js';
import { venueById } from './auth.js';
import { enqueue } from './domain/queue.js';
import { balanceOf, bookOf, fillsOfOrder, iso, marketView, orderView } from './domain/views.js';
import { publishMarket, publishMember } from './providers/valkey.js';
import type { Effects } from './domain/engine.js';
import type { MarketRow, OrderRow } from './domain/types.js';

async function builderSlugs(
  client: PoolClient,
  memberIds: readonly string[],
): Promise<Map<string, string>> {
  if (memberIds.length === 0) return new Map();
  const result = await client.query<{ member_id: string; slug: string }>(
    `select w.member_id, v.slug from webhook_endpoints w
       join venues v on v.id = w.venue_id
      where w.member_id = any($1::uuid[])`,
    [memberIds],
  );
  return new Map(result.rows.map((row) => [row.member_id, row.slug]));
}

/** Writes the builder webhook messages caused by this change, in the same transaction. */
export async function recordOutgoing(client: PoolClient, effects: Effects): Promise<void> {
  const members = [
    ...new Set([
      ...effects.fills.map((fill) => fill.member_id),
      ...effects.liquidations.map((event) => event.member_id),
    ]),
  ];
  const endpoints = await builderSlugs(client, members);
  if (endpoints.size === 0) return;

  for (const entry of effects.fills) {
    const slug = endpoints.get(entry.member_id);
    if (slug === undefined) continue;
    const result = await client.query<{
      id: string;
      market_id: string;
      symbol: string;
      order_id: string;
      mode: string | null;
      side: string;
      outcome: string | null;
      price: number;
      quantity: number;
      fee_cents: number;
      liquidity: string;
      filled_at: Date;
      order_status: string;
      remaining_quantity: number;
    }>(
      `select f.id, f.market_id, m.symbol, f.order_id, f.mode, f.side, f.outcome, f.price, f.quantity,
              f.fee_cents, f.liquidity, f.filled_at, o.status as order_status,
              o.quantity - o.filled_quantity as remaining_quantity
         from fills f join markets m on m.id = f.market_id join orders o on o.id = f.order_id
        where f.id = $1`,
      [entry.fill_id],
    );
    const fill = result.rows[0];
    if (fill === undefined) continue;
    await enqueue(client, 'webhook', `fill_${fill.id}`, {
      venue_slug: slug,
      member_id: entry.member_id,
      event_type: 'order.filled',
      event_id: `fill_${fill.id}`,
      payload: {
        event_id: `fill_${fill.id}`,
        type: 'order.filled',
        venue: slug,
        market_id: fill.market_id,
        market_symbol: fill.symbol,
        order_id: fill.order_id,
        fill_id: fill.id,
        mode: fill.mode,
        side: fill.side,
        outcome: fill.outcome,
        price: fill.price,
        quantity: fill.quantity,
        fee_cents: fill.fee_cents,
        liquidity: fill.liquidity,
        order_status: fill.order_status,
        remaining_quantity: fill.remaining_quantity,
        filled_at: iso(fill.filled_at),
      },
    });
  }

  for (const event of effects.liquidations) {
    const slug = endpoints.get(event.member_id);
    if (slug === undefined) continue;
    await enqueue(client, 'webhook', `liq_${event.position_id}`, {
      venue_slug: slug,
      member_id: event.member_id,
      event_type: 'position.liquidated',
      event_id: `liq_${event.position_id}`,
      payload: {
        event_id: `liq_${event.position_id}`,
        type: 'position.liquidated',
        venue: slug,
        market_id: event.market_id,
        position_id: event.position_id,
        side: event.side,
        quantity: event.quantity,
        mark_price: event.mark_price,
        returned_cents: event.returned_cents,
        liquidated_at: iso(new Date()),
      },
    });
  }
}

/** One event.settled message per builder holding contracts in the settled market. */
export async function recordSettlementOutgoing(
  client: PoolClient,
  market: MarketRow,
  venueSlug: string,
): Promise<void> {
  const holders = await client.query<{ id: string; member_id: string; quantity: number }>(
    `select p.id, p.member_id, p.quantity from event_positions p
       join webhook_endpoints w on w.member_id = p.member_id
      where p.market_id = $1 and p.outcome = $2 and p.quantity > 0`,
    [market.id, market.outcome],
  );
  for (const holder of holders.rows) {
    const eventId = `settle_${market.id}_${holder.id}`;
    await enqueue(client, 'webhook', eventId, {
      venue_slug: venueSlug,
      member_id: holder.member_id,
      event_type: 'event.settled',
      event_id: eventId,
      payload: {
        event_id: eventId,
        type: 'event.settled',
        venue: venueSlug,
        market_id: market.id,
        outcome: market.outcome,
        contracts: holder.quantity,
        payout_cents: holder.quantity * 100,
        settled_at: iso(new Date()),
      },
    });
  }
}

const marketById = async (marketId: string): Promise<MarketRow | null> => {
  const result = await pool.query<MarketRow>(
    `select id, venue_id, kind, symbol, title, status, closes_at, outcome, last_price,
            book_sequence, resolved_at, settled_at from markets where id = $1`,
    [marketId],
  );
  return result.rows[0] ?? null;
};

/** Relays the committed change to every open stream through Valkey. */
export async function publishEffects(effects: Effects): Promise<void> {
  for (const marketId of effects.books) {
    const market = await marketById(marketId);
    if (market !== null) await publishMarket(marketId, { event: 'book', data: await bookOf(pool, market) });
  }
  for (const trade of effects.trades) {
    await publishMarket(trade.market_id, { event: 'trade', data: trade });
  }
  for (const marketId of effects.markets) {
    const market = await marketById(marketId);
    if (market === null) continue;
    const venue = await venueById(pool, market.venue_id);
    if (venue === null) continue;
    await publishMarket(marketId, { event: 'market', data: await marketView(pool, market, venue) });
  }
  for (const memberId of effects.balances) {
    await publishMember(memberId, { event: 'balance', data: await balanceOf(pool, memberId) });
  }
  for (const entry of effects.orders) {
    const result = await pool.query<OrderRow>(
      `select id, venue_id, market_id, member_id, mode, side, outcome, price, quantity, filled_quantity,
              status, hold_cents, reserved_units, taker_fee_bps, maker_fee_bps, book_side, book_price,
              sequence, created_at from orders where id = $1`,
      [entry.order_id],
    );
    const order = result.rows[0];
    if (order !== undefined) {
      await publishMember(entry.member_id, { event: 'order', data: await orderView(pool, order) });
    }
  }
  for (const entry of effects.fills) {
    const result = await pool.query<{ order_id: string }>('select order_id from fills where id = $1', [
      entry.fill_id,
    ]);
    const orderId = result.rows[0]?.order_id;
    if (orderId === undefined) continue;
    const fill = (await fillsOfOrder(pool, orderId)).find((item) => item.id === entry.fill_id);
    if (fill !== undefined) await publishMember(entry.member_id, { event: 'fill', data: fill });
  }
  for (const event of effects.liquidations) {
    await publishMember(event.member_id, {
      event: 'liquidation',
      data: { position_id: event.position_id, market_id: event.market_id, mark_price: event.mark_price },
    });
  }
}
