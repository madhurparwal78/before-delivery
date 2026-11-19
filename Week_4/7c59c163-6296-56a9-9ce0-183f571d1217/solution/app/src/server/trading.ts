import { randomUUID } from "node:crypto";
import type pg from "pg";
import {
  CONTRACT_CENTS,
  collateralFor,
  fee,
  holdFor,
  holdKindOf,
  type Mode,
  type Outcome,
  type Side,
} from "../shared/rules.js";
import { one, rows } from "./db.js";
import { conflict, invalid } from "./errors.js";
import { account, balanceOf, lockMember, post, type Leg } from "./ledger.js";
import { enqueueWebhook } from "./outbox.js";
import type { Changes } from "./stream.js";
import { iso, type MarketRow, type OrderRow } from "./views.js";

export interface OrderInput {
  mode: Mode | null;
  side: Side;
  outcome: Outcome | null;
  price: number;
  quantity: number;
}

interface MarginPositionRow {
  id: string;
  venue_id: string;
  member_id: string;
  market_id: string;
  side: "long" | "short";
  quantity: number;
  cost_cents: number;
  collateral_cents: number;
  status: "open" | "closed" | "liquidated";
}

interface BuilderContext {
  venueSlug: string;
  venueName: string;
  builders: Set<string>;
}

/** Where an order sits on the one book: events use the YES scale, a NO buy at q is an ask at 100 − q. */
function bookPlacement(market: MarketRow, input: OrderInput): { bookSide: "bid" | "ask"; bookPrice: number } {
  if (market.kind === "event") {
    return input.outcome === "yes" ? { bookSide: "bid", bookPrice: input.price } : { bookSide: "ask", bookPrice: CONTRACT_CENTS - input.price };
  }
  return { bookSide: input.side === "buy" ? "bid" : "ask", bookPrice: input.price };
}

async function openPosition(client: pg.PoolClient, memberId: string, marketId: string): Promise<MarginPositionRow | undefined> {
  return one<MarginPositionRow>(client, "SELECT * FROM margin_positions WHERE member_id = $1 AND market_id = $2 AND status = 'open' FOR UPDATE", [memberId, marketId]);
}

async function builderContext(client: pg.PoolClient, venueId: string): Promise<BuilderContext> {
  const venue = await one<{ slug: string; name: string }>(client, "SELECT slug, name FROM venues WHERE id = $1", [venueId]);
  const builders = await rows<{ id: string }>(client, "SELECT id FROM members WHERE venue_id = $1 AND 'builder' = ANY(roles)", [venueId]);
  return { venueSlug: venue?.slug ?? "", venueName: venue?.name ?? "", builders: new Set(builders.map((b) => b.id)) };
}

/**
 * Validates funds, holdings and position size, holds the maximum spend and matches the order on the
 * market's one book. The caller holds the market lock, so matching is one order at a time.
 */
export async function placeOrder(client: pg.PoolClient, market: MarketRow, memberId: string, input: OrderInput, changes: Changes): Promise<string> {
  await lockMember(client, memberId);
  const takerBps = market.taker_fee_bps;
  const position = market.kind === "pair" && input.mode === "margin" ? await openPosition(client, memberId, market.id) : undefined;
  const holdKind = holdKindOf(market.kind, input.mode, input.side, position?.side ?? null);
  if (holdKind === "spot_sell") {
    const holding = await one<{ quantity: number; reserved: number }>(client, "SELECT quantity, reserved FROM spot_holdings WHERE member_id = $1 AND market_id = $2", [memberId, market.id]);
    if (!holding || holding.quantity - holding.reserved < input.quantity) throw invalid({ quantity: "insufficient_holdings" });
  } else if (holdKind === "margin_reduce" && position) {
    const pending = await one<{ q: number }>(
      client,
      `SELECT coalesce(sum(quantity - filled_quantity), 0) AS q FROM orders
        WHERE member_id = $1 AND market_id = $2 AND hold_kind = 'margin_reduce' AND status IN ('resting', 'partially_filled')`,
      [memberId, market.id],
    );
    if (input.quantity > position.quantity - (pending?.q ?? 0)) throw invalid({ quantity: "exceeds_position" });
  }
  const hold = holdFor(holdKind, input.price, input.quantity, takerBps);
  const { available_cents } = await balanceOf(client, memberId);
  if (hold > available_cents) throw invalid({ quantity: "insufficient_funds" });

  const { bookSide, bookPrice } = bookPlacement(market, input);
  const orderId = randomUUID();
  await client.query(
    `INSERT INTO orders (id, venue_id, market_id, member_id, mode, side, outcome, price, book_side, book_price, hold_kind, quantity, status, hold_cents, taker_fee_bps, maker_fee_bps)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'resting', $13, $14, $15)`,
    [orderId, market.venue_id, market.id, memberId, input.mode, input.side, input.outcome, input.price, bookSide, bookPrice, holdKind, input.quantity, hold, takerBps, market.maker_fee_bps],
  );
  await post(client, market.venue_id, "hold", orderId, [[account.available(memberId), -hold], [account.held(memberId), hold]]);
  if (holdKind === "spot_sell") {
    await client.query("UPDATE spot_holdings SET reserved = reserved + $3 WHERE member_id = $1 AND market_id = $2", [memberId, market.id, input.quantity]);
  }
  changes.markets.add(market.id);
  changes.members.add(memberId);
  changes.orders.add(orderId);

  const makers = await rows<OrderRow>(
    client,
    `SELECT * FROM orders
      WHERE market_id = $1 AND book_side = $2 AND status IN ('resting', 'partially_filled') AND member_id <> $3
        AND ${bookSide === "bid" ? "book_price <= $4" : "book_price >= $4"}
      ORDER BY book_price ${bookSide === "bid" ? "ASC" : "DESC"}, seq ASC`,
    [market.id, bookSide === "bid" ? "ask" : "bid", memberId, bookPrice],
  );
  if (makers.length === 0) return orderId;
  const builders = await builderContext(client, market.venue_id);
  let taker = (await one<OrderRow>(client, "SELECT * FROM orders WHERE id = $1", [orderId])) as OrderRow;
  for (const maker of makers) {
    const remaining = taker.quantity - taker.filled_quantity;
    if (remaining === 0) break;
    const quantity = Math.min(remaining, maker.quantity - maker.filled_quantity);
    taker = await executeFill(client, market, taker, maker, quantity, maker.book_price, changes, builders);
  }
  return orderId;
}

interface SideResult {
  legs: Leg[];
  fillId: string;
}

/** One trade between the incoming (taker) order and a resting (maker) order at the maker's price. */
async function executeFill(
  client: pg.PoolClient,
  market: MarketRow,
  taker: OrderRow,
  maker: OrderRow,
  quantity: number,
  executionPrice: number,
  changes: Changes,
  builders: BuilderContext,
): Promise<OrderRow> {
  const tradeId = randomUUID();
  const trade = await one<{ at: Date }>(
    client,
    "INSERT INTO trades (id, venue_id, market_id, price, quantity, at) VALUES ($1, $2, $3, $4, $5, clock_timestamp()) RETURNING at",
    [tradeId, market.venue_id, market.id, executionPrice, quantity],
  );
  const filledAt = trade?.at ?? new Date();
  const takerSide = await settleSide(client, market, taker, "taker", quantity, executionPrice, tradeId, filledAt, builders);
  const makerSide = await settleSide(client, market, maker, "maker", quantity, executionPrice, tradeId, filledAt, builders);
  await post(client, market.venue_id, "fill", tradeId, [...takerSide.legs, ...makerSide.legs]);
  await client.query("UPDATE markets SET last_price = $2 WHERE id = $1", [market.id, executionPrice]);
  if (market.kind === "event") {
    await netEventPositions(client, market, taker.member_id, changes);
    await netEventPositions(client, market, maker.member_id, changes);
  }
  changes.fills.push(takerSide.fillId, makerSide.fillId);
  changes.orders.add(taker.id).add(maker.id);
  changes.members.add(taker.member_id).add(maker.member_id);
  changes.trades.push({ marketId: market.id, price: executionPrice, quantity, at: iso(filledAt) ?? "" });
  return (await one<OrderRow>(client, "SELECT * FROM orders WHERE id = $1", [taker.id])) as OrderRow;
}

/**
 * Applies one side of a trade: the fill row, the order's progress and recomputed hold, the position
 * change, and the ledger legs. The legs of a buyer sum to −notional and of a seller to +notional on
 * pairs (the cash passes between them); on events each side pays its share into escrow and sums to 0.
 */
async function settleSide(
  client: pg.PoolClient,
  market: MarketRow,
  order: OrderRow,
  liquidity: "maker" | "taker",
  quantity: number,
  executionPrice: number,
  tradeId: string,
  filledAt: Date,
  builders: BuilderContext,
): Promise<SideResult> {
  const member = order.member_id;
  const unitPrice = market.kind === "event" && order.outcome === "no" ? CONTRACT_CENTS - executionPrice : executionPrice;
  const notional = unitPrice * quantity;
  const charge = fee(notional, liquidity === "taker" ? order.taker_fee_bps : order.maker_fee_bps);
  const filled = order.filled_quantity + quantity;
  const remaining = order.quantity - filled;
  const newHold = remaining > 0 ? holdFor(order.hold_kind, order.price, remaining, order.taker_fee_bps) : 0;
  const legs: Leg[] = [[account.fees, charge]];
  let spent = charge;

  if (market.kind === "event") {
    spent += notional;
    legs.push([account.escrow(market.id), notional]);
    await client.query(
      `INSERT INTO event_positions (id, venue_id, member_id, market_id, outcome, quantity) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (member_id, market_id, outcome) DO UPDATE SET quantity = event_positions.quantity + EXCLUDED.quantity`,
      [randomUUID(), market.venue_id, member, market.id, order.outcome, quantity],
    );
  } else if (order.mode === "spot") {
    if (order.side === "buy") {
      spent += notional;
      await client.query(
        `INSERT INTO spot_holdings (member_id, market_id, quantity) VALUES ($1, $2, $3)
         ON CONFLICT (member_id, market_id) DO UPDATE SET quantity = spot_holdings.quantity + EXCLUDED.quantity`,
        [member, market.id, quantity],
      );
    } else {
      legs.push([account.available(member), notional]);
      await client.query("UPDATE spot_holdings SET quantity = quantity - $3, reserved = reserved - $3 WHERE member_id = $1 AND market_id = $2", [member, market.id, quantity]);
    }
  } else {
    const margin = await applyMargin(client, market, member, order.side, quantity, executionPrice);
    spent += margin.spentFromHeld;
    legs.push(...margin.legs);
  }

  legs.push([account.held(member), -(order.hold_cents - newHold)], [account.available(member), order.hold_cents - newHold - spent]);
  const status = remaining === 0 ? "filled" : "partially_filled";
  await client.query("UPDATE orders SET filled_quantity = $2, status = $3, hold_cents = $4 WHERE id = $1", [order.id, filled, status, newHold]);
  const fillId = randomUUID();
  await client.query(
    `INSERT INTO fills (id, venue_id, market_id, order_id, member_id, trade_id, mode, side, outcome, price, quantity, notional_cents, fee_cents, liquidity, filled_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [fillId, market.venue_id, market.id, order.id, member, tradeId, order.mode, order.side, order.outcome, unitPrice, quantity, notional, charge, liquidity, filledAt],
  );
  if (builders.builders.has(member)) {
    await enqueueWebhook(client, market.venue_id, {
      venueSlug: builders.venueSlug,
      venueName: builders.venueName,
      memberId: member,
      eventType: "order.filled",
      payload: {
        event_id: `fill_${fillId}`,
        type: "order.filled",
        venue: builders.venueSlug,
        market_id: market.id,
        market_symbol: market.symbol,
        order_id: order.id,
        fill_id: fillId,
        mode: order.mode,
        side: order.side,
        outcome: order.outcome,
        price: unitPrice,
        quantity,
        fee_cents: charge,
        liquidity,
        order_status: status,
        remaining_quantity: remaining,
        filled_at: iso(filledAt),
      },
    });
  }
  return { legs, fillId };
}

/**
 * Opens, grows or reduces the member's one position on the pair. Returns what leaves held (collateral
 * for growth) and the legs for collateral, margin lending, profit or loss and insurance.
 */
async function applyMargin(
  client: pg.PoolClient,
  market: MarketRow,
  member: string,
  side: Side,
  quantity: number,
  price: number,
): Promise<{ spentFromHeld: number; legs: Leg[] }> {
  const legs: Leg[] = [];
  let spentFromHeld = 0;
  let open = quantity;
  const position = await openPosition(client, member, market.id);
  const direction = side === "buy" ? "long" : "short";
  if (position && position.side !== direction) {
    const reduce = Math.min(quantity, position.quantity);
    open = quantity - reduce;
    legs.push(...(await reducePosition(client, position, reduce, price)));
  }
  if (open > 0) {
    const notional = open * price;
    const collateral = collateralFor(notional);
    spentFromHeld += collateral;
    legs.push([account.collateral(member), collateral], [account.lending(market.id), direction === "long" ? -notional : notional]);
    const current = await openPosition(client, member, market.id);
    if (current) {
      await client.query("UPDATE margin_positions SET quantity = quantity + $2, cost_cents = cost_cents + $3, collateral_cents = collateral_cents + $4 WHERE id = $1", [current.id, open, notional, collateral]);
    } else {
      await client.query(
        "INSERT INTO margin_positions (id, venue_id, member_id, market_id, side, quantity, cost_cents, collateral_cents, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open')",
        [randomUUID(), market.venue_id, member, market.id, direction, open, notional, collateral],
      );
    }
  }
  return { spentFromHeld, legs };
}

/**
 * Reduces a position by r at price x: basis b = floor(C·r/q), released collateral k = floor(K·r/q)
 * (all of C and K at r = q). Available gets max(k + pnl, 0); insurance covers any shortfall.
 */
async function reducePosition(client: pg.PoolClient, position: MarginPositionRow, r: number, x: number): Promise<Leg[]> {
  const all = r === position.quantity;
  const basis = all ? position.cost_cents : Math.floor((position.cost_cents * r) / position.quantity);
  const released = all ? position.collateral_cents : Math.floor((position.collateral_cents * r) / position.quantity);
  const proceeds = r * x;
  const pnl = position.side === "long" ? proceeds - basis : basis - proceeds;
  const returned = Math.max(released + pnl, 0);
  const shortfall = Math.min(released + pnl, 0);
  await client.query(
    "UPDATE margin_positions SET quantity = quantity - $2, cost_cents = cost_cents - $3, collateral_cents = collateral_cents - $4, status = CASE WHEN quantity - $2 = 0 THEN 'closed' ELSE status END WHERE id = $1",
    [position.id, r, basis, released],
  );
  return [
    [account.collateral(position.member_id), -released],
    [account.lending(position.market_id), position.side === "long" ? basis : -basis],
    [account.available(position.member_id), returned],
    [account.insurance, shortfall],
  ];
}

/** Closes the smaller count of YES/NO pairs a member holds; each pair returns 100 cents from escrow. */
async function netEventPositions(client: pg.PoolClient, market: MarketRow, member: string, changes: Changes): Promise<void> {
  const held = await rows<{ outcome: Outcome; quantity: number }>(client, "SELECT outcome, quantity FROM event_positions WHERE member_id = $1 AND market_id = $2", [member, market.id]);
  const pairs = Math.min(held.find((p) => p.outcome === "yes")?.quantity ?? 0, held.find((p) => p.outcome === "no")?.quantity ?? 0);
  if (pairs === 0) return;
  await client.query("UPDATE event_positions SET quantity = quantity - $3 WHERE member_id = $1 AND market_id = $2", [member, market.id, pairs]);
  await post(client, market.venue_id, "netting", market.id, [[account.escrow(market.id), -pairs * CONTRACT_CENTS], [account.available(member), pairs * CONTRACT_CENTS]]);
  changes.members.add(member);
}

/** Ends a resting order (cancel, close or liquidation), returning its hold and reserved units. */
export async function endOrder(client: pg.PoolClient, order: OrderRow, status: "cancelled" | "liquidated", changes: Changes): Promise<void> {
  if (order.status !== "resting" && order.status !== "partially_filled") {
    throw conflict("invalid_transition", { from: order.status, to: status });
  }
  await client.query("UPDATE orders SET status = $2, hold_cents = 0 WHERE id = $1", [order.id, status]);
  await post(client, order.venue_id, "release", order.id, [[account.held(order.member_id), -order.hold_cents], [account.available(order.member_id), order.hold_cents]]);
  if (order.hold_kind === "spot_sell") {
    await client.query("UPDATE spot_holdings SET reserved = reserved - $3 WHERE member_id = $1 AND market_id = $2", [order.member_id, order.market_id, order.quantity - order.filled_quantity]);
  }
  changes.orders.add(order.id);
  changes.members.add(order.member_id);
  changes.markets.add(order.market_id);
}
