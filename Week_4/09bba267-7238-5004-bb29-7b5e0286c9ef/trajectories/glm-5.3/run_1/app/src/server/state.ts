import type { Pool, PoolClient } from 'pg';
import type { Cart, CartLine, Entry, Offer, Order, Performance, Seat, Ticket, Tier } from '../shared/api-types';
import { ORDER_FEE_CENTS, seatFeeCents } from './money';
import { seatLabel, seatOrder, sectionName } from './hall';
import { venueLabel } from './venue-time';

export type PerformanceRow = {
  id: string;
  title: string;
  starts_at: Date;
};

export type SeatRow = {
  seat_id: string;
  tier_id: string | null;
  state: 'on_sale' | 'held' | 'sold' | 'offered' | 'not_on_sale';
};

export type TierRow = {
  id: string;
  name: string;
  face_cents: number;
};

export type TicketRow = {
  id: string;
  seat_id: string;
  tier_id: string | null;
  tier_name: string;
  face_cents: number;
  seat_fee_cents: number;
  status: 'payment_pending' | 'issued' | 'exchange_pending' | 'refund_pending' | 'refunded';
};

export type OrderRow = {
  id: string;
  performance_id: string;
  buyer_id: string;
  name: string;
  email: string;
  email_lower: string;
  status: 'pending_payment' | 'paid' | 'partially_refunded' | 'refunded' | 'cancelled';
  face_cents: number;
  seat_fees_cents: number;
  order_fee_cents: number;
  total_cents: number;
  net_paid_cents: number;
  receipt: 'queued' | 'sent' | null;
  exchange_count: number;
  killbill_account_id: string | null;
  created_at: Date;
};

export async function performanceRows(db: Pool | PoolClient): Promise<PerformanceRow[]> {
  const result = await db.query<PerformanceRow>('SELECT id, title, starts_at FROM performances ORDER BY starts_at ASC');
  return result.rows;
}

export async function performanceById(db: Pool | PoolClient, id: string): Promise<PerformanceRow | null> {
  const result = await db.query<PerformanceRow>('SELECT id, title, starts_at FROM performances WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function tierRows(db: Pool | PoolClient, performanceId: string): Promise<TierRow[]> {
  const result = await db.query<TierRow>(
    'SELECT id, name, face_cents FROM tiers WHERE performance_id = $1 ORDER BY face_cents DESC, id ASC',
    [performanceId],
  );
  return result.rows;
}

export async function seatRows(db: Pool | PoolClient, performanceId: string): Promise<SeatRow[]> {
  const result = await db.query<SeatRow>(
    'SELECT seat_id, tier_id, state FROM seats WHERE performance_id = $1 ORDER BY seat_id',
    [performanceId],
  );
  return result.rows;
}

export async function holdExpiryFor(db: Pool | PoolClient, performanceId: string, buyerId: string): Promise<Date | null> {
  const result = await db.query<{ expires_at: Date }>(
    'SELECT expires_at FROM holds WHERE performance_id = $1 AND buyer_id = $2',
    [performanceId, buyerId],
  );
  return result.rows[0]?.expires_at ?? null;
}

export function secondsLeft(expiresAt: Date | null, now: Date): number | null {
  if (!expiresAt) return null;
  return Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000));
}

export async function buildPerformance(
  db: Pool | PoolClient,
  performance: PerformanceRow,
  now: Date,
  withOwnerCounts: boolean,
): Promise<Performance> {
  const tiers = await tierRows(db, performance.id);
  const seats = await seatRows(db, performance.id);
  const waitlistCounts = await db.query<{ tier_id: string; count: string }>(
    `SELECT tier_id, count(*)::int AS count FROM waitlist_entries WHERE performance_id = $1 AND status = 'waiting' GROUP BY tier_id`,
    [performance.id],
  );
  const waitingByTier = new Map(waitlistCounts.rows.map((r) => [r.tier_id, Number(r.count)]));
  const ownerCounts = withOwnerCounts ? await ownerTierCounts(seats) : null;
  const tierObjects: Tier[] = tiers.map((tier) => {
    const tierSeats = seats.filter((s) => s.tier_id === tier.id);
    const remaining = tierSeats.filter((s) => s.state === 'on_sale').length;
    const base = {
      id: tier.id,
      name: tier.name,
      faceCents: tier.face_cents,
      seatFeeCents: seatFeeCents(tier.face_cents),
      remaining,
      waitlistLength: waitingByTier.get(tier.id) ?? 0,
    };
    if (ownerCounts) {
      const counts = ownerCounts.get(tier.id) ?? { onSale: 0, held: 0, sold: 0, offered: 0 };
      return { ...base, ...counts };
    }
    return base;
  });
  return {
    id: performance.id,
    title: performance.title,
    startsAt: performance.starts_at.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    startsAtVenue: venueLabel(performance.starts_at),
    salesOpen: performance.starts_at.getTime() > now.getTime(),
    changesOpen: performance.starts_at.getTime() - 24 * 3600_000 > now.getTime(),
    tiers: tierObjects,
  };
}

async function ownerTierCounts(seats: SeatRow[]): Promise<Map<string, { onSale: number; held: number; sold: number; offered: number }>> {
  const map = new Map<string, { onSale: number; held: number; sold: number; offered: number }>();
  for (const seat of seats) {
    if (!seat.tier_id || seat.state === 'not_on_sale') continue;
    const entry = map.get(seat.tier_id) ?? { onSale: 0, held: 0, sold: 0, offered: 0 };
    if (seat.state === 'on_sale') entry.onSale += 1;
    if (seat.state === 'held') entry.held += 1;
    if (seat.state === 'sold') entry.sold += 1;
    if (seat.state === 'offered') entry.offered += 1;
    map.set(seat.tier_id, entry);
  }
  return map;
}

export async function buildSeats(
  db: Pool | PoolClient,
  performanceId: string,
  buyerId: string,
): Promise<Seat[]> {
  const seats = await seatRows(db, performanceId);
  const geo = await db.query<{ seat_id: string; off_centre_deg: number; stage_distance_m: string }>(
    'SELECT seat_id, off_centre_deg, to_char(stage_distance_m, \'FM99990.0\') AS stage_distance_m FROM seats_geo',
  );
  const geoBySeat = new Map(geo.rows.map((row) => [row.seat_id, { deg: row.off_centre_deg, dist: row.stage_distance_m }]));
  const mySeats = new Set<string>();
  const heldByMe = await db.query<{ seat_id: string }>(
    `SELECT s.seat_id FROM seats s WHERE s.performance_id = $1 AND s.state = 'held' AND s.hold_token = $2`,
    [performanceId, buyerId],
  );
  for (const row of heldByMe.rows) mySeats.add(row.seat_id);
  const soldToMe = await db.query<{ seat_id: string }>(
    `SELECT t.seat_id FROM tickets t JOIN orders o ON o.id = t.order_id
     WHERE t.performance_id = $1 AND o.buyer_id = $2 AND t.status IN ('issued','exchange_pending','refund_pending','payment_pending')`,
    [performanceId, buyerId],
  );
  for (const row of soldToMe.rows) mySeats.add(row.seat_id);
  const offeredToMe = await db.query<{ seat_id: string }>(
    `SELECT of.seat_id FROM offers of JOIN waitlist_entries e ON e.id = of.entry_id
     WHERE of.performance_id = $1 AND e.buyer_id = $2 AND of.status = 'open'`,
    [performanceId, buyerId],
  );
  for (const row of offeredToMe.rows) mySeats.add(row.seat_id);

  const sorted = [...seats].sort((a, b) => seatOrder(a.seat_id) - seatOrder(b.seat_id));
  return sorted.map((seat) => {
    const facts = geoBySeat.get(seat.seat_id) ?? { deg: 0, dist: '0.0' };
    const mine = mySeats.has(seat.seat_id);
    return {
      id: seat.seat_id,
      section: seat.seat_id.split('-')[0] as Seat['section'],
      row: seat.seat_id.split('-')[1],
      number: Number(seat.seat_id.split('-')[2]),
      label: seatLabel(seat.seat_id),
      tierId: seat.tier_id,
      state: seat.state,
      mine,
      offCentreDeg: facts.deg,
      stageDistanceM: facts.dist,
    };
  });
}

export async function buildCart(
  db: Pool | PoolClient,
  performanceId: string,
  buyerId: string,
  now: Date,
): Promise<Cart> {
  const held = await db.query<{ seat_id: string; tier_id: string; tier_name: string; face_cents: number }>(
    `SELECT s.seat_id, s.tier_id, t.name AS tier_name, t.face_cents
     FROM seats s JOIN tiers t ON t.performance_id = s.performance_id AND t.id = s.tier_id
     WHERE s.performance_id = $1 AND s.state = 'held' AND s.hold_token = $2
     ORDER BY s.seat_id`,
    [performanceId, buyerId],
  );
  const expiry = await holdExpiryFor(db, performanceId, buyerId);
  const seats: CartLine[] = held.rows.map((row) => ({
    seatId: row.seat_id,
    label: seatLabel(row.seat_id),
    tierId: row.tier_id,
    tierName: row.tier_name,
    faceCents: row.face_cents,
    seatFeeCents: seatFeeCents(row.face_cents),
  }));
  const face = seats.reduce((sum, s) => sum + s.faceCents, 0);
  const fees = seats.reduce((sum, s) => sum + s.seatFeeCents, 0);
  const empty = seats.length === 0;
  return {
    performanceId,
    seats,
    faceCents: face,
    seatFeesCents: fees,
    orderFeeCents: empty ? 0 : ORDER_FEE_CENTS,
    totalCents: empty ? 0 : face + fees + ORDER_FEE_CENTS,
    expiresAt: empty ? null : expiry ? expiry.toISOString().replace(/\.\d{3}Z$/, 'Z') : null,
    secondsLeft: empty ? null : secondsLeft(expiry, now),
  };
}

export async function ticketRows(db: Pool | PoolClient, orderId: string): Promise<TicketRow[]> {
  const result = await db.query<TicketRow>('SELECT id, seat_id, tier_id, tier_name, face_cents, seat_fee_cents, status FROM tickets WHERE order_id = $1 ORDER BY seat_id', [orderId]);
  return result.rows;
}

export async function orderRow(db: Pool | PoolClient, orderId: string): Promise<OrderRow | null> {
  const result = await db.query<OrderRow>('SELECT * FROM orders WHERE id = $1', [orderId]);
  return result.rows[0] ?? null;
}

export function toTicket(row: TicketRow): Ticket {
  return {
    id: row.id,
    seatId: row.seat_id,
    label: seatLabel(row.seat_id),
    tierName: row.tier_name,
    faceCents: row.face_cents,
    seatFeeCents: row.seat_fee_cents,
    status: row.status,
  };
}

export async function buildOrder(db: Pool | PoolClient, order: OrderRow): Promise<Order> {
  const performance = await performanceById(db, order.performance_id);
  const tickets = await ticketRows(db, order.id);
  const killbillPayments = await db.query<{ payment_id: string }>(
    'SELECT payment_id FROM killbill_payment_records WHERE order_id = $1 ORDER BY created_at ASC',
    [order.id],
  );
  return {
    id: order.id,
    performanceId: order.performance_id,
    performanceTitle: performance?.title ?? '',
    startsAtVenue: performance ? venueLabel(performance.starts_at) : '',
    name: order.name,
    email: order.email,
    status: order.status,
    tickets: tickets.map(toTicket),
    faceCents: order.face_cents,
    seatFeesCents: order.seat_fees_cents,
    orderFeeCents: order.order_fee_cents,
    totalCents: order.total_cents,
    netPaidCents: order.net_paid_cents,
    receipt: order.receipt,
    createdAt: order.created_at.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    killbillPaymentIds: killbillPayments.rows.map((r) => r.payment_id),
    killbillAccountId: order.killbill_account_id ?? '',
  };
}

export async function buildEntry(db: Pool | PoolClient, entryRow: EntryRow): Promise<Entry> {
  const performance = await performanceById(db, entryRow.performance_id);
  const tier = performance ? await tierRows(db, performance.id) : [];
  const tierName = tier.find((t) => t.id === entryRow.tier_id)?.name ?? entryRow.tier_id;
  const positionResult = await db.query<{ position: number | null }>(
    `WITH waiting AS (
       SELECT id, row_number() OVER (ORDER BY joined_at ASC, id ASC) AS position
       FROM waitlist_entries WHERE performance_id = $1 AND tier_id = $2 AND status = 'waiting'
     )
     SELECT position FROM waiting WHERE id = $3`,
    [entryRow.performance_id, entryRow.tier_id, entryRow.id],
  );
  const offer = await openOfferForEntry(db, entryRow, new Date());
  return {
    id: entryRow.id,
    performanceId: entryRow.performance_id,
    tierId: entryRow.tier_id,
    tierName,
    position: positionResult.rows[0]?.position === undefined ? null : Number(positionResult.rows[0].position),
    status: entryRow.status,
    offer,
  };
}

export async function openOfferForEntry(db: Pool | PoolClient, entryRow: EntryRow, now: Date): Promise<Offer | null> {
  const result = await db.query<OfferRow>(
    `SELECT * FROM offers WHERE entry_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [entryRow.id],
  );
  const offerRow = result.rows[0];
  if (!offerRow) return null;
  return buildOffer(db, offerRow, now);
}

export type OfferRow = {
  token: string;
  performance_id: string;
  tier_id: string;
  entry_id: string;
  seat_id: string;
  status: 'open' | 'accepted' | 'declined' | 'expired';
  created_at: Date;
  expires_at: Date;
};

export type EntryRow = {
  id: string;
  performance_id: string;
  tier_id: string;
  buyer_id: string;
  name: string;
  email: string;
  email_lower: string;
  status: 'waiting' | 'offered' | 'accepted' | 'declined' | 'expired';
  joined_at: Date;
};

export async function buildOffer(db: Pool | PoolClient, offer: OfferRow, now: Date): Promise<Offer | null> {
  const performance = await performanceById(db, offer.performance_id);
  if (!performance) return null;
  const tiers = await tierRows(db, offer.performance_id);
  const tier = tiers.find((t) => t.id === offer.tier_id);
  if (!tier) return null;
  const expired = offer.status === 'open' && offer.expires_at.getTime() <= now.getTime();
  const status: Offer['status'] = expired ? 'expired' : offer.status;
  const seat = await db.query<{ state: string }>('SELECT state FROM seats WHERE performance_id = $1 AND seat_id = $2', [
    offer.performance_id,
    offer.seat_id,
  ]);
  const liveStatus =
    status === 'open' && seat.rows[0] && seat.rows[0].state !== 'offered' ? seat.rows[0].state === 'sold' ? 'accepted' : status : status;
  const finalStatus = status === 'open' && liveStatus !== 'open' ? liveStatus : status;
  const face = tier.face_cents;
  const fee = seatFeeCents(face);
  return {
    token: offer.token,
    performanceId: offer.performance_id,
    seatId: offer.seat_id,
    label: seatLabel(offer.seat_id),
    tierName: tier.name,
    faceCents: face,
    seatFeeCents: fee,
    orderFeeCents: ORDER_FEE_CENTS,
    totalCents: face + fee + ORDER_FEE_CENTS,
    status: finalStatus as Offer['status'],
    expiresAt: offer.expires_at.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    secondsLeft: Math.max(0, Math.ceil((offer.expires_at.getTime() - now.getTime()) / 1000)),
  };
}

export { seatFeeCents, sectionName };
