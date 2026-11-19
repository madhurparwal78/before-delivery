// Reads that build the API's JSON objects from the database. Counts come from seat states when read.
import { HALL_SEATS, bySeatOrder, seatById } from "../shared/hall.js";
import { orderTotals, seatFeeCents } from "../shared/rules.js";
import type {
  Cart, Entry, EntryStatus, Offer, OfferStatus, Order, OrderStatus, OwnerOrder, OwnerTier, Performance, Seat, SeatState, TicketStatus,
} from "../shared/types.js";
import { changesOpen, hasExpired, isoInstant, salesOpen, secondsLeft } from "./clock.js";
import type { Db } from "./db.js";
import { venueLabel } from "./venueTime.js";

export const labelOf = (seatId: string): string => seatById(seatId).label;

interface PerformanceRow {
  id: string;
  title: string;
  starts_at: Date;
}

interface TierRow {
  performance_id: string;
  id: string;
  name: string;
  face_cents: number;
  on_sale: number;
  held: number;
  sold: number;
  offered: number;
  waiting: number;
}

export async function performanceRow(db: Db, id: string): Promise<PerformanceRow | undefined> {
  const found = await db.query<PerformanceRow>("SELECT id, title, starts_at FROM performances WHERE id = $1", [id]);
  return found.rows[0];
}

/** Each tier's seat-state counts and waitlist length, read from seat states: the one place seats remaining is decided. */
export async function tierCounts(db: Db, performanceId?: string, tierId?: string): Promise<TierRow[]> {
  const tiers = await db.query<TierRow>(
    `SELECT t.performance_id, t.id, t.name, t.face_cents,
            count(s.id) FILTER (WHERE s.state = 'on_sale')::int AS on_sale,
            count(s.id) FILTER (WHERE s.state = 'held')::int AS held,
            count(s.id) FILTER (WHERE s.state = 'sold')::int AS sold,
            count(s.id) FILTER (WHERE s.state = 'offered')::int AS offered,
            (SELECT count(*)::int FROM waitlist_entries w
              WHERE w.performance_id = t.performance_id AND w.tier_id = t.id AND w.status = 'waiting') AS waiting
     FROM tiers t
     LEFT JOIN seats s ON s.performance_id = t.performance_id AND s.tier_id = t.id
     WHERE ($1::text IS NULL OR t.performance_id = $1) AND ($2::text IS NULL OR t.id = $2)
     GROUP BY t.performance_id, t.id, t.name, t.face_cents, t.position
     ORDER BY t.performance_id, t.position`, [performanceId ?? null, tierId ?? null]);
  return tiers.rows;
}

/** Performances in start order, each tier with its seat-state counts and waitlist length. */
export async function ownerPerformances(db: Db, now: Date, id?: string): Promise<Performance<OwnerTier>[]> {
  const filter = id === undefined ? "" : "WHERE p.id = $1";
  const params = id === undefined ? [] : [id];
  const shows = await db.query<PerformanceRow>(
    `SELECT p.id, p.title, p.starts_at FROM performances p ${filter} ORDER BY p.starts_at, p.created_at, p.id`, params);
  const tiers = await tierCounts(db, id);
  return shows.rows.map((show) => ({
    id: show.id,
    title: show.title,
    startsAt: isoInstant(show.starts_at),
    startsAtVenue: venueLabel(show.starts_at),
    salesOpen: salesOpen(show.starts_at, now),
    changesOpen: changesOpen(show.starts_at, now),
    tiers: tiers.filter((t) => t.performance_id === show.id).map((t) => ({
      id: t.id,
      name: t.name,
      faceCents: t.face_cents,
      seatFeeCents: seatFeeCents(t.face_cents),
      remaining: t.on_sale,
      waitlistLength: t.waiting,
      onSale: t.on_sale,
      held: t.held,
      sold: t.sold,
      offered: t.offered,
    })),
  }));
}

export async function performances(db: Db, now: Date, id?: string): Promise<Performance[]> {
  return (await ownerPerformances(db, now, id)).map((show) => ({
    ...show,
    tiers: show.tiers.map(({ id: tierId, name, faceCents, seatFeeCents: fee, remaining, waitlistLength }) =>
      ({ id: tierId, name, faceCents, seatFeeCents: fee, remaining, waitlistLength })),
  }));
}

export async function seatsOf(db: Db, performanceId: string, buyerId: string): Promise<Seat[]> {
  const rows = await db.query<{ id: string; tier_id: string | null; state: SeatState; buyer_id: string | null }>(
    "SELECT id, tier_id, state, buyer_id FROM seats WHERE performance_id = $1", [performanceId]);
  const byId = new Map(rows.rows.map((r) => [r.id, r]));
  return HALL_SEATS.map((hall) => {
    const row = byId.get(hall.id);
    const state = row?.state ?? "not_on_sale";
    return {
      id: hall.id,
      section: hall.section,
      row: hall.row,
      number: hall.number,
      label: hall.label,
      tierId: row?.tier_id ?? null,
      state,
      mine: state !== "on_sale" && state !== "not_on_sale" && row?.buyer_id === buyerId,
      offCentreDeg: hall.offCentreDeg,
      stageDistanceM: hall.stageDistanceM,
    };
  });
}

/** The buyer's held seats for a performance and their shared expiry instant. */
export async function cartOf(db: Db, buyerId: string, performanceId: string, now: Date): Promise<Cart> {
  const lines = await db.query<{ id: string; tier_id: string; name: string; face_cents: number }>(
    `SELECT s.id, s.tier_id, t.name, t.face_cents
     FROM seats s JOIN tiers t ON t.performance_id = s.performance_id AND t.id = s.tier_id
     WHERE s.performance_id = $1 AND s.buyer_id = $2 AND s.state = 'held' AND s.ticket_id IS NULL
     ORDER BY s.ordinal`, [performanceId, buyerId]);
  const cart = await db.query<{ expires_at: Date }>(
    "SELECT expires_at FROM carts WHERE buyer_id = $1 AND performance_id = $2", [buyerId, performanceId]);
  const seats = lines.rows.map((r) => ({
    seatId: r.id, label: labelOf(r.id), tierId: r.tier_id, tierName: r.name, faceCents: r.face_cents, seatFeeCents: seatFeeCents(r.face_cents),
  }));
  const expiresAt = seats.length > 0 ? cart.rows[0]?.expires_at ?? null : null;
  return {
    performanceId,
    seats,
    ...orderTotals(seats),
    expiresAt: expiresAt ? isoInstant(expiresAt) : null,
    secondsLeft: expiresAt ? secondsLeft(expiresAt, now) : null,
  };
}

interface OrderRow {
  id: string;
  performance_id: string;
  title: string;
  starts_at: Date;
  name: string;
  email: string;
  status: OrderStatus;
  face_cents: number;
  seat_fees_cents: number;
  order_fee_cents: number;
  total_cents: number;
  receipt: "queued" | "sent" | null;
  killbill_account_id: string | null;
  created_at: Date;
}

/** Orders matching `where` (a condition on `o`), newest first, with tickets in seat order and Kill Bill payments. */
export async function ordersWhere(db: Db, where: string, params: unknown[]): Promise<OwnerOrder[]> {
  const orders = await db.query<OrderRow>(
    `SELECT o.id, o.performance_id, p.title, p.starts_at, o.name, o.email, o.status, o.face_cents, o.seat_fees_cents,
            o.order_fee_cents, o.total_cents, o.killbill_account_id, o.created_at,
            (SELECT x.status FROM outbox x WHERE x.order_id = o.id AND x.kind = 'receipt' ORDER BY x.id LIMIT 1) AS receipt
     FROM orders o JOIN performances p ON p.id = o.performance_id
     WHERE ${where} ORDER BY o.created_at DESC, o.id DESC`, params);
  const ids = orders.rows.map((o) => o.id);
  const tickets = await db.query<{ id: string; order_id: string; seat_id: string; name: string; face_cents: number; seat_fee_cents: number; status: TicketStatus }>(
    `SELECT k.id, k.order_id, k.seat_id, t.name, k.face_cents, k.seat_fee_cents, k.status
     FROM tickets k JOIN orders o ON o.id = k.order_id JOIN tiers t ON t.performance_id = o.performance_id AND t.id = k.tier_id
     WHERE k.order_id = ANY($1)`, [ids]);
  const payments = await db.query<{ order_id: string; killbill_payment_id: string; amount_cents: number; refunded_cents: number }>(
    "SELECT order_id, killbill_payment_id, amount_cents, refunded_cents FROM payments WHERE order_id = ANY($1) ORDER BY created_at",
    [ids]);
  return orders.rows.map((o) => {
    const paid = payments.rows.filter((p) => p.order_id === o.id);
    return {
      id: o.id,
      performanceId: o.performance_id,
      performanceTitle: o.title,
      startsAtVenue: venueLabel(o.starts_at),
      name: o.name,
      email: o.email,
      status: o.status,
      tickets: tickets.rows.filter((t) => t.order_id === o.id).sort((a, b) => bySeatOrder(a.seat_id, b.seat_id)).map((t) => ({
        id: t.id, seatId: t.seat_id, label: labelOf(t.seat_id), tierName: t.name, faceCents: t.face_cents, seatFeeCents: t.seat_fee_cents, status: t.status,
      })),
      faceCents: o.face_cents,
      seatFeesCents: o.seat_fees_cents,
      orderFeeCents: o.order_fee_cents,
      totalCents: o.total_cents,
      netPaidCents: paid.reduce((sum, p) => sum + p.amount_cents - p.refunded_cents, 0),
      receipt: o.receipt,
      createdAt: isoInstant(o.created_at),
      killbillAccountId: o.killbill_account_id,
      killbillPaymentIds: paid.map((p) => p.killbill_payment_id),
    };
  });
}

/** The buyer-facing order, without the owner's Kill Bill fields. */
export function buyerOrder(order: OwnerOrder): Order {
  const { killbillAccountId: _account, killbillPaymentIds: _payments, ...rest } = order;
  return rest;
}

interface OfferRow {
  token: string;
  performance_id: string;
  seat_id: string;
  status: OfferStatus;
  expires_at: Date;
  tier_name: string;
  face_cents: number;
}

const OFFER_SELECT = `
  SELECT o.token, o.entry_id, o.performance_id, o.seat_id, o.status, o.expires_at, t.name AS tier_name, t.face_cents
  FROM offers o
  JOIN seats s ON s.performance_id = o.performance_id AND s.id = o.seat_id
  JOIN tiers t ON t.performance_id = s.performance_id AND t.id = s.tier_id`;

function offerView(row: OfferRow, now: Date): Offer {
  const fee = seatFeeCents(row.face_cents);
  const totals = orderTotals([{ faceCents: row.face_cents, seatFeeCents: fee }]);
  return {
    token: row.token,
    performanceId: row.performance_id,
    seatId: row.seat_id,
    label: labelOf(row.seat_id),
    tierName: row.tier_name,
    faceCents: row.face_cents,
    seatFeeCents: fee,
    orderFeeCents: totals.orderFeeCents,
    totalCents: totals.totalCents,
    status: row.status === "open" && hasExpired(row.expires_at, now) ? "expired" : row.status,
    expiresAt: isoInstant(row.expires_at),
    secondsLeft: row.status === "open" ? secondsLeft(row.expires_at, now) : 0,
  };
}

export async function offerByToken(db: Db, token: string, now: Date): Promise<Offer | undefined> {
  const found = await db.query<OfferRow>(`${OFFER_SELECT} WHERE o.token = $1`, [token]);
  return found.rows[0] ? offerView(found.rows[0], now) : undefined;
}

/** The buyer's waitlist entries, newest first, each with its place while waiting and its latest offer. */
export async function entriesOf(db: Db, buyerId: string, now: Date, entryId?: string): Promise<Entry[]> {
  const rows = await db.query<{ id: string; performance_id: string; tier_id: string; tier_name: string; status: EntryStatus; position: number | null }>(
    `SELECT w.id, w.performance_id, w.tier_id, t.name AS tier_name, w.status,
            CASE WHEN w.status = 'waiting' THEN
              (SELECT count(*)::int FROM waitlist_entries x
               WHERE x.performance_id = w.performance_id AND x.tier_id = w.tier_id AND x.status = 'waiting'
                 AND (x.joined_at, x.seq) <= (w.joined_at, w.seq))
            END AS position
     FROM waitlist_entries w JOIN tiers t ON t.performance_id = w.performance_id AND t.id = w.tier_id
     WHERE w.buyer_id = $1 AND ($2::text IS NULL OR w.id = $2)
     ORDER BY w.joined_at DESC, w.seq DESC`, [buyerId, entryId ?? null]);
  const offers = await db.query<OfferRow & { entry_id: string }>(
    `${OFFER_SELECT} WHERE o.entry_id = ANY($1) ORDER BY o.created_at DESC`, [rows.rows.map((r) => r.id)]);
  return rows.rows.map((r) => {
    const latest = offers.rows.find((o) => o.entry_id === r.id);
    return {
      id: r.id,
      performanceId: r.performance_id,
      tierId: r.tier_id,
      tierName: r.tier_name,
      position: r.position,
      status: r.status,
      offer: latest ? offerView(latest, now) : null,
    };
  });
}
