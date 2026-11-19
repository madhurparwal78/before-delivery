import type { HoldKind, MarketKind, MarketStatus, Mode, OrderStatus, Outcome, Role, Side } from "../shared/rules.js";
import { one, rows, UUID, type Db } from "./db.js";
import { notFound } from "./errors.js";

export const iso = (value: Date | string | null): string | null => (value === null ? null : new Date(value).toISOString());

// ---- markets ----

export interface MarketRow {
  id: string;
  venue_id: string;
  kind: MarketKind;
  symbol: string;
  title: string;
  status: MarketStatus;
  stored_status: MarketStatus;
  closes_at: Date | null;
  outcome: Outcome | null;
  last_price: number | null;
  open_interest: number;
  taker_fee_bps: number;
  maker_fee_bps: number;
}

/** Status as read: an event is closed from its close instant, by the server clock. */
const MARKET_SELECT = `
  SELECT m.id, m.venue_id, m.kind, m.symbol, m.title, m.closes_at, m.outcome, m.last_price, m.status AS stored_status,
         CASE WHEN m.status IN ('trading', 'halted') AND m.closes_at <= now() THEN 'closed' ELSE m.status END AS status,
         v.taker_fee_bps, v.maker_fee_bps,
         CASE WHEN m.kind = 'event' THEN
                CASE WHEN m.status = 'settled' THEN 0
                     ELSE (SELECT coalesce(sum(quantity), 0) FROM event_positions e WHERE e.market_id = m.id AND e.outcome = 'yes') END
              ELSE (SELECT coalesce(sum(quantity), 0) FROM margin_positions p WHERE p.market_id = m.id AND p.status = 'open') END
           AS open_interest
    FROM markets m JOIN venues v ON v.id = m.venue_id`;

export function marketView(m: MarketRow) {
  return {
    id: m.id,
    kind: m.kind,
    symbol: m.symbol,
    title: m.title,
    status: m.status,
    closes_at: iso(m.closes_at),
    outcome: m.outcome,
    last_price: m.last_price,
    open_interest: m.open_interest,
    taker_fee_bps: m.taker_fee_bps,
    maker_fee_bps: m.maker_fee_bps,
  };
}

export async function marketById(db: Db, id: string, venueId: string | null, lock = false): Promise<MarketRow> {
  if (!UUID.test(id) || venueId === null) throw notFound();
  if (lock) await db.query("SELECT 1 FROM markets WHERE id = $1 AND venue_id = $2 FOR NO KEY UPDATE", [id, venueId]);
  const market = await one<MarketRow>(db, `${MARKET_SELECT} WHERE m.id = $1 AND m.venue_id = $2`, [id, venueId]);
  if (!market) throw notFound();
  return market;
}

export async function marketsOfVenue(db: Db, venueId: string): Promise<MarketRow[]> {
  return rows<MarketRow>(db, `${MARKET_SELECT} WHERE m.venue_id = $1 ORDER BY m.created_at, m.symbol`, [venueId]);
}

export async function marketRow(db: Db, id: string): Promise<MarketRow> {
  const market = await one<MarketRow>(db, `${MARKET_SELECT} WHERE m.id = $1`, [id]);
  if (!market) throw notFound();
  return market;
}

// ---- book ----

interface LevelRow {
  book_side: "bid" | "ask";
  book_price: number;
  quantity: number;
  spot_quantity: number;
  margin_quantity: number;
}

export async function bookOf(db: Db, market: MarketRow) {
  const levels = await rows<LevelRow>(
    db,
    `SELECT book_side, book_price,
            sum(quantity - filled_quantity) AS quantity,
            coalesce(sum(quantity - filled_quantity) FILTER (WHERE mode = 'spot'), 0) AS spot_quantity,
            coalesce(sum(quantity - filled_quantity) FILTER (WHERE mode = 'margin'), 0) AS margin_quantity
       FROM orders WHERE market_id = $1 AND status IN ('resting', 'partially_filled')
      GROUP BY book_side, book_price`,
    [market.id],
  );
  const level = (l: LevelRow) =>
    market.kind === "pair"
      ? { price: l.book_price, quantity: l.quantity, spot_quantity: l.spot_quantity, margin_quantity: l.margin_quantity }
      : { price: l.book_price, quantity: l.quantity };
  const sequence = await one<{ seq: number }>(db, "SELECT coalesce(max(seq), 0) AS seq FROM fills WHERE market_id = $1", [market.id]);
  return {
    market_id: market.id,
    sequence: (sequence?.seq ?? 0) + levels.reduce((total, l) => total + l.quantity, 0),
    last_price: market.last_price,
    bids: levels.filter((l) => l.book_side === "bid").sort((a, b) => b.book_price - a.book_price).map(level),
    asks: levels.filter((l) => l.book_side === "ask").sort((a, b) => a.book_price - b.book_price).map(level),
  };
}

// ---- orders and fills ----

export interface OrderRow {
  id: string;
  seq: number;
  venue_id: string;
  market_id: string;
  member_id: string;
  mode: Mode | null;
  side: Side;
  outcome: Outcome | null;
  price: number;
  book_side: "bid" | "ask";
  book_price: number;
  hold_kind: HoldKind;
  quantity: number;
  filled_quantity: number;
  status: OrderStatus;
  hold_cents: number;
  taker_fee_bps: number;
  maker_fee_bps: number;
  created_at: Date;
}

export interface FillRow {
  id: string;
  order_id: string;
  market_id: string;
  member_id: string;
  mode: Mode | null;
  side: Side;
  outcome: Outcome | null;
  price: number;
  quantity: number;
  notional_cents: number;
  fee_cents: number;
  liquidity: "maker" | "taker";
  filled_at: Date;
}

export function fillView(f: FillRow) {
  return {
    id: f.id,
    order_id: f.order_id,
    market_id: f.market_id,
    mode: f.mode,
    side: f.side,
    outcome: f.outcome,
    price: f.price,
    quantity: f.quantity,
    notional_cents: f.notional_cents,
    fee_cents: f.fee_cents,
    liquidity: f.liquidity,
    filled_at: iso(f.filled_at),
  };
}

function orderView(o: OrderRow, fills: FillRow[]) {
  return {
    id: o.id,
    market_id: o.market_id,
    mode: o.mode,
    side: o.side,
    outcome: o.outcome,
    price: o.price,
    quantity: o.quantity,
    filled_quantity: o.filled_quantity,
    remaining_quantity: o.quantity - o.filled_quantity,
    status: o.status,
    hold_cents: o.hold_cents,
    taker_fee_bps: o.taker_fee_bps,
    maker_fee_bps: o.maker_fee_bps,
    created_at: iso(o.created_at),
    fills: fills.map(fillView),
  };
}

type OrderView = ReturnType<typeof orderView>;

export async function orderViews(db: Db, orders: OrderRow[]): Promise<OrderView[]> {
  if (orders.length === 0) return [];
  const fills = await rows<FillRow>(db, "SELECT * FROM fills WHERE order_id = ANY($1) ORDER BY seq", [orders.map((o) => o.id)]);
  return orders.map((o) => orderView(o, fills.filter((f) => f.order_id === o.id)));
}

/** The caller's own order; anyone else's answers like an id that does not exist. */
export async function ownOrder(db: Db, id: string, memberId: string, lock = false): Promise<OrderRow> {
  if (!UUID.test(id)) throw notFound();
  const order = await one<OrderRow>(db, `SELECT * FROM orders WHERE id = $1 AND member_id = $2${lock ? " FOR UPDATE" : ""}`, [id, memberId]);
  if (!order) throw notFound();
  return order;
}

// ---- members ----

export interface MemberRow {
  id: string;
  venue_id: string | null;
  username: string;
  email: string;
  display_name: string;
  roles: Role[];
  killbill_account_id: string | null;
}

export interface VenueRow {
  id: string;
  slug: string;
  name: string;
  time_zone: string;
  taker_fee_bps: number;
  maker_fee_bps: number;
  flagship_symbol: string | null;
  created_at: Date;
}

export async function memberById(db: Db, id: string): Promise<MemberRow> {
  const member = await one<MemberRow>(db, "SELECT * FROM members WHERE id = $1", [id]);
  if (!member) throw notFound();
  return member;
}

export async function venueById(db: Db, id: string): Promise<VenueRow> {
  const venue = await one<VenueRow>(db, "SELECT * FROM venues WHERE id = $1", [id]);
  if (!venue) throw notFound();
  return venue;
}
