import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { LOCK_MARKET, lockAdvisory } from '../db/pool.js';
import { ApiError, ValidationError } from '../http/errors.js';
import { EVENT_SCALE, bookPlacement, crosses, memberPrice } from './book.js';
import { collateralFor, equityFor, holdFor, maintenanceFor, reduceBy } from './holds.js';
import {
  FEES,
  INSURANCE,
  escrowAccount,
  marginLendingAccount,
  memberAccount,
  postEntry,
} from './ledger.js';
import { feeForNotional } from './money.js';
import { nextMarketStatus, nextOrderStatus } from './transitions.js';
import { RANGES, requireRange } from './validate.js';
import type { HoldShape } from './holds.js';
import type {
  BookSide,
  MarginPositionRow,
  MarketRow,
  OrderMode,
  OrderRow,
  OrderSide,
  Outcome,
  PositionSide,
  Venue,
} from './types.js';

export interface Effects {
  books: Set<string>;
  markets: Set<string>;
  trades: { market_id: string; price: number; quantity: number; at: string }[];
  balances: Set<string>;
  orders: { member_id: string; order_id: string }[];
  fills: { member_id: string; fill_id: string }[];
  liquidations: {
    member_id: string;
    position_id: string;
    market_id: string;
    mark_price: number;
    side: PositionSide;
    quantity: number;
    returned_cents: number;
  }[];
  pairFills: Set<string>;
}

export const newEffects = (): Effects => ({
  books: new Set(),
  markets: new Set(),
  trades: [],
  balances: new Set(),
  orders: [],
  fills: [],
  liquidations: [],
  pairFills: new Set(),
});

const ORDER_COLUMNS =
  'id, venue_id, market_id, member_id, mode, side, outcome, price, quantity, filled_quantity, status, hold_cents, reserved_units, taker_fee_bps, maker_fee_bps, book_side, book_price, sequence, created_at';

export async function loadOrder(client: PoolClient, orderId: string): Promise<OrderRow | null> {
  const result = await client.query<OrderRow>(
    `select ${ORDER_COLUMNS} from orders where id = $1 for update`,
    [orderId],
  );
  return result.rows[0] ?? null;
}

/** An event is closed from its closes_at instant, by the server clock. */
export async function applyClose(client: PoolClient, market: MarketRow, effects: Effects): Promise<MarketRow> {
  if (market.kind !== 'event' || market.closes_at === null) return market;
  if (market.status !== 'trading' && market.status !== 'halted') return market;
  if (market.closes_at.getTime() > Date.now()) return market;

  const status = nextMarketStatus(market.kind, market.status, 'close');
  await client.query('update markets set status = $2, book_sequence = book_sequence + 1 where id = $1', [
    market.id,
    status,
  ]);
  await cancelRestingOrders(client, market, effects, 'cancelled');
  effects.markets.add(market.id);
  effects.books.add(market.id);
  return { ...market, status, book_sequence: market.book_sequence + 1 };
}

async function releaseOrder(
  client: PoolClient,
  order: OrderRow,
  status: 'cancelled' | 'liquidated',
  effects: Effects,
): Promise<void> {
  await postEntry(client, order.venue_id, 'release', order.id, [
    { account: memberAccount(order.member_id, 'held'), amount_cents: -order.hold_cents },
    { account: memberAccount(order.member_id, 'available'), amount_cents: order.hold_cents },
  ]);
  if (order.reserved_units > 0) {
    await client.query(
      'update spot_holdings set reserved = reserved - $3 where member_id = $1 and market_id = $2',
      [order.member_id, order.market_id, order.reserved_units],
    );
  }
  await client.query(
    'update orders set status = $2, hold_cents = 0, reserved_units = 0, ended_at = now() where id = $1',
    [order.id, status],
  );
  effects.orders.push({ member_id: order.member_id, order_id: order.id });
  effects.balances.add(order.member_id);
}

async function cancelRestingOrders(
  client: PoolClient,
  market: MarketRow,
  effects: Effects,
  status: 'cancelled',
): Promise<void> {
  const result = await client.query<OrderRow>(
    `select ${ORDER_COLUMNS} from orders
      where market_id = $1 and status in ('resting','partially_filled') for update`,
    [market.id],
  );
  for (const order of result.rows) await releaseOrder(client, order, status, effects);
}

export async function cancelOrder(
  client: PoolClient,
  order: OrderRow,
  effects: Effects,
): Promise<void> {
  nextOrderStatus(order.status, 'cancelled');
  await releaseOrder(client, order, 'cancelled', effects);
}

export interface PlaceRequest {
  market: MarketRow;
  venue: Venue;
  memberId: string;
  mode: OrderMode | null;
  side: OrderSide;
  outcome: Outcome | null;
  price: number;
  quantity: number;
}

interface Shape {
  hold: HoldShape;
  reducesPosition: MarginPositionRow | null;
}

async function openPosition(
  client: PoolClient,
  memberId: string,
  marketId: string,
): Promise<MarginPositionRow | null> {
  const result = await client.query<MarginPositionRow>(
    `select id, venue_id, member_id, market_id, side, quantity, cost_cents, collateral_cents, status
       from margin_positions where member_id = $1 and market_id = $2 and status = 'open' for update`,
    [memberId, marketId],
  );
  return result.rows[0] ?? null;
}

async function resolveShape(client: PoolClient, request: PlaceRequest): Promise<Shape> {
  if (request.market.kind === 'event') return { hold: 'buy', reducesPosition: null };
  if (request.mode === 'spot') {
    return { hold: request.side === 'buy' ? 'buy' : 'spot_sell', reducesPosition: null };
  }
  const position = await openPosition(client, request.memberId, request.market.id);
  const reduces =
    position !== null &&
    ((position.side === 'long' && request.side === 'sell') ||
      (position.side === 'short' && request.side === 'buy'));
  return { hold: reduces ? 'margin_reduce' : 'margin_open', reducesPosition: reduces ? position : null };
}

export interface PlaceResult {
  order: OrderRow;
}

/** Matching on one market is strictly one order at a time, in arrival order. */
export async function placeOrder(
  client: PoolClient,
  request: PlaceRequest,
  effects: Effects,
): Promise<PlaceResult> {
  await lockAdvisory(client, LOCK_MARKET, request.market.id);
  const market = await applyClose(client, request.market, effects);
  if (market.status !== 'trading') {
    throw new ApiError(409, 'market_not_trading', { status: market.status });
  }

  requireRange(
    request.price,
    market.kind === 'event' ? RANGES.eventPrice : RANGES.pairPrice,
    'price',
  );
  requireRange(request.quantity, RANGES.quantity, 'quantity');

  const shape = await resolveShape(client, request);
  await checkCapacity(client, request, shape);

  const hold = holdFor(shape.hold, request.price, request.quantity, request.venue.taker_fee_bps);
  const balance = await client.query<{ available_cents: number }>(
    'select available_cents from member_balances where member_id = $1 for update',
    [request.memberId],
  );
  if ((balance.rows[0]?.available_cents ?? 0) < hold) {
    throw new ValidationError({ quantity: 'insufficient_funds' });
  }

  const placement = bookPlacement(market.kind, request.side, request.outcome, request.price);
  const reservedUnits = shape.hold === 'spot_sell' ? request.quantity : 0;
  const orderId = randomUUID();
  await client.query(
    `insert into orders (id, venue_id, market_id, member_id, mode, side, outcome, price, quantity,
                         status, hold_cents, reserved_units, taker_fee_bps, maker_fee_bps, book_side, book_price)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'resting',$10,$11,$12,$13,$14,$15)`,
    [
      orderId,
      market.venue_id,
      market.id,
      request.memberId,
      request.mode,
      request.side,
      request.outcome,
      request.price,
      request.quantity,
      hold,
      reservedUnits,
      request.venue.taker_fee_bps,
      request.venue.maker_fee_bps,
      placement.book_side,
      placement.book_price,
    ],
  );
  await postEntry(client, market.venue_id, 'hold', orderId, [
    { account: memberAccount(request.memberId, 'available'), amount_cents: -hold },
    { account: memberAccount(request.memberId, 'held'), amount_cents: hold },
  ]);
  if (reservedUnits > 0) {
    await client.query(
      'update spot_holdings set reserved = reserved + $3 where member_id = $1 and market_id = $2',
      [request.memberId, market.id, reservedUnits],
    );
  }

  const incoming = (await loadOrder(client, orderId)) as OrderRow;
  await match(client, market, incoming, effects);

  const settled = (await loadOrder(client, orderId)) as OrderRow;
  effects.orders.push({ member_id: request.memberId, order_id: orderId });
  effects.balances.add(request.memberId);
  effects.books.add(market.id);
  await client.query('update markets set book_sequence = book_sequence + 1 where id = $1', [market.id]);
  return { order: settled };
}

/** Spot sells need unreserved units; a margin reduce may not flip the position. */
async function checkCapacity(client: PoolClient, request: PlaceRequest, shape: Shape): Promise<void> {
  if (shape.hold === 'spot_sell') {
    const holding = await client.query<{ quantity: number; reserved: number }>(
      'select quantity, reserved from spot_holdings where member_id = $1 and market_id = $2 for update',
      [request.memberId, request.market.id],
    );
    const row = holding.rows[0];
    if (row === undefined) {
      await client.query(
        'insert into spot_holdings (member_id, market_id, quantity, reserved) values ($1,$2,0,0) on conflict do nothing',
        [request.memberId, request.market.id],
      );
    }
    const free = (row?.quantity ?? 0) - (row?.reserved ?? 0);
    if (free < request.quantity) throw new ValidationError({ quantity: 'insufficient_holdings' });
    return;
  }
  if (shape.reducesPosition === null) return;

  const position = shape.reducesPosition;
  const resting = await client.query<{ total: string | null }>(
    `select sum(quantity - filled_quantity) as total from orders
      where member_id = $1 and market_id = $2 and mode = 'margin' and side = $3
        and status in ('resting','partially_filled')`,
    [request.memberId, request.market.id, request.side],
  );
  const alreadyReducing = Number(resting.rows[0]?.total ?? 0);
  if (request.quantity > position.quantity - alreadyReducing) {
    throw new ValidationError({ quantity: 'exceeds_position' });
  }
}

async function match(
  client: PoolClient,
  market: MarketRow,
  incoming: OrderRow,
  effects: Effects,
): Promise<void> {
  const opposite: BookSide = incoming.book_side === 'bid' ? 'ask' : 'bid';
  const order = incoming.book_side === 'bid' ? 'asc' : 'desc';
  const candidates = await client.query<OrderRow>(
    `select ${ORDER_COLUMNS} from orders
      where market_id = $1 and book_side = $2 and status in ('resting','partially_filled')
        and member_id <> $3
      order by book_price ${order}, sequence asc
      for update`,
    [market.id, opposite, incoming.member_id],
  );

  let remaining = incoming.quantity - incoming.filled_quantity;
  let state = incoming;
  let traded = false;
  for (const resting of candidates.rows) {
    if (remaining === 0) break;
    if (!crosses(incoming.book_side, incoming.book_price, resting.book_price)) break;

    const quantity = Math.min(remaining, resting.quantity - resting.filled_quantity);
    if (quantity === 0) continue;

    const tradeId = randomUUID();
    const at = new Date();
    await client.query(
      'insert into trades (id, venue_id, market_id, price, quantity, at) values ($1,$2,$3,$4,$5,$6)',
      [tradeId, market.venue_id, market.id, resting.book_price, quantity, at],
    );
    await client.query('update markets set last_price = $2 where id = $1', [market.id, resting.book_price]);
    effects.markets.add(market.id);
    effects.trades.push({
      market_id: market.id,
      price: resting.book_price,
      quantity,
      at: at.toISOString(),
    });

    state = await applyFillSide(client, market, state, quantity, resting.book_price, 'taker', tradeId, effects);
    await applyFillSide(client, market, resting, quantity, resting.book_price, 'maker', tradeId, effects);
    remaining -= quantity;
    traded = true;
  }
  if (traded && market.kind === 'pair') effects.pairFills.add(market.id);
}

function holdShapeOf(order: OrderRow, position: MarginPositionRow | null): HoldShape {
  if (order.mode === null) return 'buy';
  if (order.mode === 'spot') return order.side === 'buy' ? 'buy' : 'spot_sell';
  const reduces =
    position !== null &&
    ((position.side === 'long' && order.side === 'sell') ||
      (position.side === 'short' && order.side === 'buy'));
  return reduces ? 'margin_reduce' : 'margin_open';
}

/**
 * Applies one side of a fill: the fill row, the member's economic postings, the recomputed hold and
 * the order's new status.
 */
async function applyFillSide(
  client: PoolClient,
  market: MarketRow,
  order: OrderRow,
  quantity: number,
  bookPrice: number,
  liquidity: 'maker' | 'taker',
  tradeId: string,
  effects: Effects,
): Promise<OrderRow> {
  const price = memberPrice(market.kind, order.outcome, bookPrice);
  const notional = price * quantity;
  const bps = liquidity === 'taker' ? order.taker_fee_bps : order.maker_fee_bps;
  const fee = feeForNotional(notional, bps);

  const position = order.mode === 'margin' ? await openPosition(client, order.member_id, market.id) : null;
  const shape = holdShapeOf(order, position);

  const filled = order.filled_quantity + quantity;
  const remaining = order.quantity - filled;
  const status = remaining === 0 ? 'filled' : 'partially_filled';
  const newHold =
    remaining === 0 ? 0 : holdFor(shape, order.price, remaining, order.taker_fee_bps);
  const heldDelta = order.hold_cents - newHold;

  const legs = [
    { account: memberAccount(order.member_id, 'held'), amount_cents: -heldDelta },
    { account: FEES, amount_cents: fee },
  ];
  let spentFromHeld = fee;

  if (market.kind === 'event') {
    legs.push({ account: escrowAccount(market.id), amount_cents: notional });
    spentFromHeld += notional;
  } else if (shape === 'buy') {
    legs.push({ account: marginLendingAccount(market.id), amount_cents: notional });
    spentFromHeld += notional;
    await client.query(
      `insert into spot_holdings (member_id, market_id, quantity, reserved) values ($1,$2,$3,0)
       on conflict (member_id, market_id) do update set quantity = spot_holdings.quantity + $3`,
      [order.member_id, market.id, quantity],
    );
  } else if (shape === 'spot_sell') {
    legs.push({ account: marginLendingAccount(market.id), amount_cents: -notional });
    legs.push({ account: memberAccount(order.member_id, 'available'), amount_cents: notional });
    await client.query(
      'update spot_holdings set quantity = quantity - $3, reserved = reserved - $3 where member_id = $1 and market_id = $2',
      [order.member_id, market.id, quantity],
    );
  } else if (shape === 'margin_open') {
    const collateral = collateralFor(notional);
    legs.push({ account: memberAccount(order.member_id, 'collateral'), amount_cents: collateral });
    spentFromHeld += collateral;
    await growPosition(client, order, market, quantity, notional, collateral, position);
  } else {
    const held = position as MarginPositionRow;
    const reduction = reduceBy(
      held.side,
      held.quantity,
      held.cost_cents,
      held.collateral_cents,
      quantity,
      price,
    );
    const shortfall = Math.max(0, -(reduction.releasedCollateralCents + reduction.profitCents));
    legs.push(
      {
        account: memberAccount(order.member_id, 'collateral'),
        amount_cents: -reduction.releasedCollateralCents,
      },
      { account: memberAccount(order.member_id, 'available'), amount_cents: reduction.payoutCents },
      { account: marginLendingAccount(market.id), amount_cents: -reduction.profitCents },
      { account: INSURANCE, amount_cents: -shortfall },
    );
    const remainingQuantity = held.quantity - quantity;
    await client.query(
      `update margin_positions
          set quantity = $2, cost_cents = cost_cents - $3, collateral_cents = collateral_cents - $4,
              status = case when $2 = 0 then 'closed' else status end,
              ended_at = case when $2 = 0 then now() else ended_at end
        where id = $1`,
      [held.id, remainingQuantity, reduction.basisCents, reduction.releasedCollateralCents],
    );
  }

  legs.push({
    account: memberAccount(order.member_id, 'available'),
    amount_cents: heldDelta - spentFromHeld,
  });

  const fillId = randomUUID();
  await client.query(
    `insert into fills (id, venue_id, market_id, order_id, member_id, trade_id, mode, side, outcome,
                        price, quantity, notional_cents, fee_cents, liquidity)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      fillId,
      market.venue_id,
      market.id,
      order.id,
      order.member_id,
      tradeId,
      order.mode,
      order.side,
      order.outcome,
      price,
      quantity,
      notional,
      fee,
      liquidity,
    ],
  );
  await postEntry(client, market.venue_id, 'fill', fillId, legs);
  await client.query(
    `update orders set filled_quantity = $2, status = $3, hold_cents = $4,
            reserved_units = greatest(reserved_units - $5, 0),
            ended_at = case when $3 = 'filled' then now() else ended_at end
      where id = $1`,
    [order.id, filled, status, newHold, shape === 'spot_sell' ? quantity : 0],
  );

  if (market.kind === 'event') {
    await applyEventPosition(client, market, order, quantity);
  }

  effects.fills.push({ member_id: order.member_id, fill_id: fillId });
  effects.balances.add(order.member_id);
  if (liquidity === 'maker') effects.orders.push({ member_id: order.member_id, order_id: order.id });
  return { ...order, filled_quantity: filled, status, hold_cents: newHold };
}

async function growPosition(
  client: PoolClient,
  order: OrderRow,
  market: MarketRow,
  quantity: number,
  notional: number,
  collateral: number,
  position: MarginPositionRow | null,
): Promise<void> {
  if (position === null) {
    await client.query(
      `insert into margin_positions (id, venue_id, member_id, market_id, side, quantity, cost_cents, collateral_cents, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'open')`,
      [
        randomUUID(),
        market.venue_id,
        order.member_id,
        market.id,
        order.side === 'buy' ? 'long' : 'short',
        quantity,
        notional,
        collateral,
      ],
    );
    return;
  }
  await client.query(
    `update margin_positions
        set quantity = quantity + $2, cost_cents = cost_cents + $3, collateral_cents = collateral_cents + $4
      where id = $1`,
    [position.id, quantity, notional, collateral],
  );
}

/** After each event fill a member holding both YES and NO closes the smaller count of pairs. */
async function applyEventPosition(
  client: PoolClient,
  market: MarketRow,
  order: OrderRow,
  quantity: number,
): Promise<void> {
  await client.query(
    `insert into event_positions (id, venue_id, member_id, market_id, outcome, quantity)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (member_id, market_id, outcome)
       do update set quantity = event_positions.quantity + $6`,
    [randomUUID(), market.venue_id, order.member_id, market.id, order.outcome, quantity],
  );
  const held = await client.query<{ outcome: string; quantity: number }>(
    'select outcome, quantity from event_positions where member_id = $1 and market_id = $2 for update',
    [order.member_id, market.id],
  );
  const yes = held.rows.find((row) => row.outcome === 'yes')?.quantity ?? 0;
  const no = held.rows.find((row) => row.outcome === 'no')?.quantity ?? 0;
  const pairs = Math.min(yes, no);
  if (pairs === 0) return;

  await client.query(
    'update event_positions set quantity = quantity - $3 where member_id = $1 and market_id = $2',
    [order.member_id, market.id, pairs],
  );
  await postEntry(client, market.venue_id, 'netting', `${market.id}:${order.member_id}`, [
    { account: escrowAccount(market.id), amount_cents: -pairs * EVENT_SCALE },
    { account: memberAccount(order.member_id, 'available'), amount_cents: pairs * EVENT_SCALE },
  ]);
}

export interface Liquidated {
  position_id: string;
  quantity: number;
  mark_price: number;
  returned_cents: number;
}

/**
 * Checks every open margin position on a pair against its maintenance requirement at the new mark.
 * A position below maintenance is liquidated at the mark.
 */
export async function runMaintenance(
  client: PoolClient,
  market: MarketRow,
  effects: Effects,
): Promise<{ checked: number; liquidated: Liquidated[] }> {
  await lockAdvisory(client, LOCK_MARKET, market.id);
  const mark = market.last_price;
  if (mark === null) return { checked: 0, liquidated: [] };

  const positions = await client.query<MarginPositionRow>(
    `select id, venue_id, member_id, market_id, side, quantity, cost_cents, collateral_cents, status
       from margin_positions where market_id = $1 and status = 'open' for update`,
    [market.id],
  );

  const liquidated: Liquidated[] = [];
  for (const position of positions.rows) {
    const equity = equityFor(
      position.side,
      position.quantity,
      position.cost_cents,
      position.collateral_cents,
      mark,
    );
    if (equity >= maintenanceFor(position.quantity, mark)) continue;

    const returned = Math.max(equity, 0);
    const deficit = Math.max(0, -equity);
    await postEntry(client, position.venue_id, 'liquidation', position.id, [
      {
        account: memberAccount(position.member_id, 'collateral'),
        amount_cents: -position.collateral_cents,
      },
      { account: memberAccount(position.member_id, 'available'), amount_cents: returned },
      {
        account: marginLendingAccount(market.id),
        amount_cents: -(equity - position.collateral_cents),
      },
      { account: INSURANCE, amount_cents: -deficit },
    ]);
    await client.query(
      `update margin_positions set status = 'liquidated', quantity = 0, cost_cents = 0,
              collateral_cents = 0, ended_at = now() where id = $1`,
      [position.id],
    );

    const resting = await client.query<OrderRow>(
      `select ${ORDER_COLUMNS} from orders
        where member_id = $1 and market_id = $2 and mode = 'margin'
          and status in ('resting','partially_filled') for update`,
      [position.member_id, market.id],
    );
    for (const order of resting.rows) await releaseOrder(client, order, 'liquidated', effects);

    liquidated.push({
      position_id: position.id,
      quantity: position.quantity,
      mark_price: mark,
      returned_cents: returned,
    });
    effects.liquidations.push({
      member_id: position.member_id,
      position_id: position.id,
      market_id: market.id,
      mark_price: mark,
      side: position.side,
      quantity: position.quantity,
      returned_cents: returned,
    });
    effects.balances.add(position.member_id);
    effects.books.add(market.id);
  }
  return { checked: positions.rowCount ?? 0, liquidated };
}

/** Each winning contract pays 100 cents from escrow to its holder, exactly once. */
export async function settleMarket(
  client: PoolClient,
  market: MarketRow,
  effects: Effects,
): Promise<boolean> {
  if (market.status !== 'resolved' || market.outcome === null) return false;
  const positions = await client.query<{ id: string; member_id: string; quantity: number }>(
    `select id, member_id, quantity from event_positions
      where market_id = $1 and outcome = $2 and quantity > 0 for update`,
    [market.id, market.outcome],
  );
  for (const position of positions.rows) {
    const claimed = await client.query(
      'insert into settlement_payouts (market_id, position_id) values ($1,$2) on conflict do nothing',
      [market.id, position.id],
    );
    if (claimed.rowCount === 0) continue;
    const payout = position.quantity * EVENT_SCALE;
    await postEntry(client, market.venue_id, 'payout', `${market.id}:${position.id}`, [
      { account: escrowAccount(market.id), amount_cents: -payout },
      { account: memberAccount(position.member_id, 'available'), amount_cents: payout },
    ]);
    effects.balances.add(position.member_id);
  }
  const status = nextMarketStatus(market.kind, market.status, 'settle');
  await client.query('update markets set status = $2, settled_at = now() where id = $1', [market.id, status]);
  effects.markets.add(market.id);
  return true;
}
