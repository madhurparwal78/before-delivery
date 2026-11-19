import type { Db } from '../db/pool.js';
import type { Balance, MarketRow, OrderRow, Venue } from './types.js';

export const iso = (value: Date): string => value.toISOString();

export interface MarketView {
  id: string;
  kind: string;
  symbol: string;
  title: string;
  status: string;
  closes_at: string | null;
  outcome: string | null;
  last_price: number | null;
  open_interest: number;
  taker_fee_bps: number;
  maker_fee_bps: number;
}

/**
 * An event's open interest is the YES contracts its members hold after netting; a pair's is the
 * total quantity of every open margin position. Spot holdings do not count.
 */
export async function openInterest(db: Db, market: MarketRow): Promise<number> {
  if (market.kind === 'event') {
    if (market.status === 'settled') return 0;
    const result = await db.query<{ total: string | null }>(
      `select sum(quantity) as total from event_positions where market_id = $1 and outcome = 'yes'`,
      [market.id],
    );
    return Number(result.rows[0]?.total ?? 0);
  }
  const result = await db.query<{ total: string | null }>(
    `select sum(quantity) as total from margin_positions where market_id = $1 and status = 'open'`,
    [market.id],
  );
  return Number(result.rows[0]?.total ?? 0);
}

export async function marketView(db: Db, market: MarketRow, venue: Venue): Promise<MarketView> {
  return {
    id: market.id,
    kind: market.kind,
    symbol: market.symbol,
    title: market.title,
    status: market.status,
    closes_at: market.closes_at === null ? null : iso(market.closes_at),
    outcome: market.outcome,
    last_price: market.last_price,
    open_interest: await openInterest(db, market),
    taker_fee_bps: venue.taker_fee_bps,
    maker_fee_bps: venue.maker_fee_bps,
  };
}

export interface FillView {
  id: string;
  order_id: string;
  market_id: string;
  mode: string | null;
  side: string;
  outcome: string | null;
  price: number;
  quantity: number;
  notional_cents: number;
  fee_cents: number;
  liquidity: string;
  filled_at: string;
}

interface FillRecord {
  id: string;
  order_id: string;
  market_id: string;
  mode: string | null;
  side: string;
  outcome: string | null;
  price: number;
  quantity: number;
  notional_cents: number;
  fee_cents: number;
  liquidity: string;
  filled_at: Date;
}

const FILL_COLUMNS =
  'id, order_id, market_id, mode, side, outcome, price, quantity, notional_cents, fee_cents, liquidity, filled_at';

const toFillView = (row: FillRecord): FillView => ({ ...row, filled_at: iso(row.filled_at) });

export async function fillsOfOrder(db: Db, orderId: string): Promise<FillView[]> {
  const result = await db.query<FillRecord>(
    `select ${FILL_COLUMNS} from fills where order_id = $1 order by sequence`,
    [orderId],
  );
  return result.rows.map(toFillView);
}

export async function fillById(db: Db, fillId: string, memberId: string): Promise<FillView | null> {
  const result = await db.query<FillRecord>(
    `select ${FILL_COLUMNS} from fills where id = $1 and member_id = $2`,
    [fillId, memberId],
  );
  const row = result.rows[0];
  return row === undefined ? null : toFillView(row);
}

export async function fillsOfMember(
  db: Db,
  memberId: string,
  marketId: string | null,
): Promise<FillView[]> {
  const result = await db.query<FillRecord>(
    `select ${FILL_COLUMNS} from fills
     where member_id = $1 and ($2::uuid is null or market_id = $2)
     order by sequence desc limit 200`,
    [memberId, marketId],
  );
  return result.rows.map(toFillView);
}

export interface OrderView {
  id: string;
  market_id: string;
  mode: string | null;
  side: string;
  outcome: string | null;
  price: number;
  quantity: number;
  filled_quantity: number;
  remaining_quantity: number;
  status: string;
  hold_cents: number;
  taker_fee_bps: number;
  maker_fee_bps: number;
  created_at: string;
  fills: FillView[];
}

export async function orderView(db: Db, order: OrderRow): Promise<OrderView> {
  return {
    id: order.id,
    market_id: order.market_id,
    mode: order.mode,
    side: order.side,
    outcome: order.outcome,
    price: order.price,
    quantity: order.quantity,
    filled_quantity: order.filled_quantity,
    remaining_quantity: order.quantity - order.filled_quantity,
    status: order.status,
    hold_cents: order.hold_cents,
    taker_fee_bps: order.taker_fee_bps,
    maker_fee_bps: order.maker_fee_bps,
    created_at: iso(order.created_at),
    fills: await fillsOfOrder(db, order.id),
  };
}

export async function balanceOf(db: Db, memberId: string): Promise<Balance> {
  const result = await db.query<{
    available_cents: number;
    held_cents: number;
    collateral_cents: number;
  }>('select available_cents, held_cents, collateral_cents from member_balances where member_id = $1', [
    memberId,
  ]);
  const row = result.rows[0] ?? { available_cents: 0, held_cents: 0, collateral_cents: 0 };
  return { ...row, total_cents: row.available_cents + row.held_cents + row.collateral_cents };
}

export interface BookLevel {
  price: number;
  quantity: number;
  spot_quantity?: number;
  margin_quantity?: number;
}

export interface BookView {
  market_id: string;
  sequence: number;
  last_price: number | null;
  bids: BookLevel[];
  asks: BookLevel[];
}

export async function bookOf(db: Db, market: MarketRow): Promise<BookView> {
  const result = await db.query<{
    book_side: string;
    book_price: number;
    quantity: string;
    spot_quantity: string;
    margin_quantity: string;
  }>(
    `select book_side,
            book_price,
            sum(quantity - filled_quantity) as quantity,
            sum(case when mode = 'spot' then quantity - filled_quantity else 0 end) as spot_quantity,
            sum(case when mode = 'margin' then quantity - filled_quantity else 0 end) as margin_quantity
       from orders
      where market_id = $1 and status in ('resting','partially_filled')
      group by book_side, book_price
      having sum(quantity - filled_quantity) > 0`,
    [market.id],
  );

  const level = (row: (typeof result.rows)[number]): BookLevel =>
    market.kind === 'pair'
      ? {
          price: row.book_price,
          quantity: Number(row.quantity),
          spot_quantity: Number(row.spot_quantity),
          margin_quantity: Number(row.margin_quantity),
        }
      : { price: row.book_price, quantity: Number(row.quantity) };

  const bids = result.rows
    .filter((row) => row.book_side === 'bid')
    .map(level)
    .sort((left, right) => right.price - left.price);
  const asks = result.rows
    .filter((row) => row.book_side === 'ask')
    .map(level)
    .sort((left, right) => left.price - right.price);

  return { market_id: market.id, sequence: market.book_sequence, last_price: market.last_price, bids, asks };
}
