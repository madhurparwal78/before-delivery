import type { Cart, CartLine } from '../../shared/api';
import { seatLabel, sortSeatIds } from '../../shared/hall';
import { ledgerOf, seatFeeCents } from '../../shared/money';
import { type Db, first, rows } from '../db';
import { buyerTopic, performanceTopic, recordChange } from '../live';
import { SALES_OPEN_SQL } from './rules';
import { freeSeat, holdSeatRow, lockSeatRows } from './seats';

export const MAX_SEATS_PER_PERFORMANCE = 8;

interface CartSeatRow {
  seat_id: string;
  tier_id: string;
  tier_name: string;
  face_cents: number;
  expires_at: Date;
  seconds_left: number;
}

const CART_SQL = `select s.seat_id, s.tier_id, t.name as tier_name, t.face_cents,
    s.hold_expires_at as expires_at,
    ceil(extract(epoch from (s.hold_expires_at - now())))::int as seconds_left
  from seats s
  join tiers t on t.performance_id = s.performance_id and t.tier_id = s.tier_id
  where s.performance_id = $1 and s.hold_buyer_id = $2 and s.hold_kind = 'cart'
    and s.state = 'held' and s.hold_expires_at > now()`;

function toCart(performanceId: string, cartRows: readonly CartSeatRow[]): Cart {
  const order = sortSeatIds(cartRows.map((row) => row.seat_id));
  const lines: CartLine[] = order.flatMap((seatId) => {
    const row = cartRows.find((candidate) => candidate.seat_id === seatId);
    if (!row) return [];
    return [
      {
        seatId: row.seat_id,
        label: seatLabel(row.seat_id),
        tierId: row.tier_id,
        tierName: row.tier_name,
        faceCents: row.face_cents,
        seatFeeCents: seatFeeCents(row.face_cents),
      },
    ];
  });
  const ledger = ledgerOf(lines);
  const expiry = cartRows[0];
  return {
    performanceId,
    seats: lines,
    ...ledger,
    expiresAt: expiry ? `${expiry.expires_at.toISOString().slice(0, 19)}Z` : null,
    secondsLeft: expiry ? Math.max(0, expiry.seconds_left) : null,
  };
}

export async function loadCart(db: Db, performanceId: string, buyerId: string): Promise<Cart> {
  return toCart(performanceId, await rows<CartSeatRow>(db, CART_SQL, [performanceId, buyerId]));
}

async function heldSeatCount(db: Db, performanceId: string, buyerId: string): Promise<number> {
  const row = await first<{ count: string }>(
    db,
    `select count(*) as count from seats s
     where s.performance_id = $1 and s.hold_buyer_id = $2 and s.hold_kind = 'cart'
       and s.state = 'held' and s.hold_expires_at > now()`,
    [performanceId, buyerId],
  );
  return Number(row?.count ?? 0);
}

async function liveTicketCount(db: Db, performanceId: string, buyerId: string): Promise<number> {
  const row = await first<{ count: string }>(
    db,
    `select count(*) as count from tickets tk
     join orders o on o.id = tk.order_id
     where tk.performance_id = $1 and o.buyer_id = $2 and o.status <> 'cancelled'
       and tk.status in ('payment_pending', 'issued', 'exchange_pending', 'refund_pending')`,
    [performanceId, buyerId],
  );
  return Number(row?.count ?? 0);
}

export type HoldOutcome =
  | { readonly kind: 'held'; readonly cart: Cart; readonly held: string[]; readonly taken: string[] }
  | { readonly kind: 'sales_closed' }
  | { readonly kind: 'seats_taken'; readonly taken: string[]; readonly cart: Cart }
  | { readonly kind: 'over_limit' };

export async function holdSeats(
  db: Db,
  performanceId: string,
  buyerId: string,
  seatIds: readonly string[],
): Promise<HoldOutcome> {
  const salesOpen = await first<{ sales_open: boolean }>(
    db,
    `select (${SALES_OPEN_SQL}) as sales_open from performances p where p.id = $1`,
    [performanceId],
  );
  if (!salesOpen?.sales_open) return { kind: 'sales_closed' };

  const seatRows = await lockSeatRows(db, performanceId, seatIds);
  const alreadyHeld: string[] = [];
  const claimable: string[] = [];
  const taken: string[] = [];
  for (const seat of seatRows) {
    if (seat.effective_state === 'held' && seat.hold_buyer_id === buyerId && seat.hold_kind === 'cart') {
      alreadyHeld.push(seat.seat_id);
    } else if (seat.effective_state === 'on_sale' && seat.tier_id !== null) {
      claimable.push(seat.seat_id);
    } else {
      taken.push(seat.seat_id);
    }
  }
  if (claimable.length === 0 && taken.length > 0) {
    return { kind: 'seats_taken', taken: sortSeatIds(taken), cart: await loadCart(db, performanceId, buyerId) };
  }
  const requestedNew = seatIds.length - alreadyHeld.length;
  const alreadyCommitted =
    (await heldSeatCount(db, performanceId, buyerId)) + (await liveTicketCount(db, performanceId, buyerId));
  if (alreadyCommitted + requestedNew > MAX_SEATS_PER_PERFORMANCE) return { kind: 'over_limit' };

  const sharedExpiry = await first<{ expires_at: Date | null }>(
    db,
    `select min(s.hold_expires_at) as expires_at from seats s
     where s.performance_id = $1 and s.hold_buyer_id = $2 and s.hold_kind = 'cart'
       and s.state = 'held' and s.hold_expires_at > now()`,
    [performanceId, buyerId],
  );
  for (const seatId of claimable) {
    await holdSeatRow(db, performanceId, seatId, buyerId, 'cart', sharedExpiry?.expires_at ?? null);
  }
  await recordChange(db, [performanceTopic(performanceId), buyerTopic(buyerId)]);
  return {
    kind: 'held',
    cart: await loadCart(db, performanceId, buyerId),
    held: sortSeatIds(claimable),
    taken: sortSeatIds(taken),
  };
}

export async function releaseHeldSeat(
  db: Db,
  performanceId: string,
  buyerId: string,
  seatId: string,
): Promise<Cart | null> {
  const seatRows = await lockSeatRows(db, performanceId, [seatId]);
  const seat = seatRows[0];
  const heldByBuyer =
    seat !== undefined &&
    seat.effective_state === 'held' &&
    seat.hold_buyer_id === buyerId &&
    seat.hold_kind === 'cart';
  if (!heldByBuyer) return null;
  await freeSeat(db, performanceId, seatId);
  await recordChange(db, [buyerTopic(buyerId)]);
  return loadCart(db, performanceId, buyerId);
}
