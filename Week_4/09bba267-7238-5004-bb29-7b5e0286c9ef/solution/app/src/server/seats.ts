// Seat state transitions. Every change of a seat's state happens here, under the seat's row lock.
import { randomBytes } from "node:crypto";
import { orderTotals, seatFeeCents } from "../shared/rules.js";
import { config } from "./config.js";
import { expiryFrom, salesOpen } from "./clock.js";
import { notify, type Tx } from "./db.js";
import { offerMail } from "./emails.js";
import { enqueueMail } from "./outbox.js";
import { venueExpiry, venueLabel } from "./venueTime.js";
import { labelOf } from "./views.js";
import type { SeatState } from "../shared/types.js";

interface SeatRow {
  id: string;
  tier_id: string | null;
  state: SeatState;
  buyer_id: string | null;
  order_id: string | null;
  ticket_id: string | null;
  offer_token: string | null;
}

/** Locks the named seats of a performance in id order (the one lock order every writer uses). */
export async function lockSeats(tx: Tx, performanceId: string, seatIds: readonly string[]): Promise<Map<string, SeatRow>> {
  const rows = await tx.query<SeatRow>(
    `SELECT id, tier_id, state, buyer_id, order_id, ticket_id, offer_token FROM seats
     WHERE performance_id = $1 AND id = ANY($2) ORDER BY id FOR UPDATE`, [performanceId, [...seatIds]]);
  return new Map(rows.rows.map((r) => [r.id, r]));
}

/** on_sale → held: for the buyer's cart, or for a ticket's exchange while its payment confirms. */
export async function holdSeat(tx: Tx, performanceId: string, seatId: string, buyerId: string, ticketId: string | null): Promise<void> {
  await tx.query(
    `UPDATE seats SET state = 'held', buyer_id = $3, ticket_id = $4, order_id = NULL, offer_token = NULL
     WHERE performance_id = $1 AND id = $2 AND state = 'on_sale'`, [performanceId, seatId, buyerId, ticketId]);
  await notify(tx, { k: "seats", p: performanceId });
}

/** Held seats join a checkout in progress (`orderId`) or leave it (`null`), staying held. */
export async function markCheckout(tx: Tx, performanceId: string, seatIds: readonly string[], orderId: string | null): Promise<void> {
  await tx.query("UPDATE seats SET order_id = $3 WHERE performance_id = $1 AND id = ANY($2) AND state = 'held'",
    [performanceId, [...seatIds], orderId]);
}

/** held → sold or offered → sold, on a confirmed payment. */
export async function sellSeat(tx: Tx, performanceId: string, seatId: string, buyerId: string, orderId: string, ticketId: string): Promise<void> {
  await tx.query(
    `UPDATE seats SET state = 'sold', buyer_id = $3, order_id = $4, ticket_id = $5, offer_token = NULL
     WHERE performance_id = $1 AND id = $2 AND state IN ('held', 'offered')`, [performanceId, seatId, buyerId, orderId, ticketId]);
  await notify(tx, { k: "seats", p: performanceId });
}

/**
 * A seat becomes free (release, expiry, declined payment, an exchange's old seat, a refund, an offer that ends):
 * it is offered to its tier's earliest waiting entry while sales are open, otherwise it goes back on sale.
 */
export async function freeSeat(tx: Tx, performanceId: string, seatId: string, now: Date): Promise<void> {
  const show = await tx.query<{ title: string; starts_at: Date; tier_id: string; face_cents: number }>(
    `SELECT p.title, p.starts_at, s.tier_id, t.face_cents FROM seats s
     JOIN performances p ON p.id = s.performance_id
     JOIN tiers t ON t.performance_id = s.performance_id AND t.id = s.tier_id
     WHERE s.performance_id = $1 AND s.id = $2`, [performanceId, seatId]);
  const seat = show.rows[0];
  await tx.query("SELECT 1 FROM tiers WHERE performance_id = $1 AND id = $2 FOR UPDATE", [performanceId, seat.tier_id]);
  const next = salesOpen(seat.starts_at, now)
    ? (await tx.query<{ id: string; buyer_id: string; email: string }>(
      `SELECT id, buyer_id, email FROM waitlist_entries
       WHERE performance_id = $1 AND tier_id = $2 AND status = 'waiting'
       ORDER BY joined_at, seq LIMIT 1 FOR UPDATE`, [performanceId, seat.tier_id])).rows[0]
    : undefined;
  await notify(tx, { k: "seats", p: performanceId });
  if (!next) {
    await tx.query(
      `UPDATE seats SET state = 'on_sale', buyer_id = NULL, order_id = NULL, ticket_id = NULL, offer_token = NULL
       WHERE performance_id = $1 AND id = $2`, [performanceId, seatId]);
    return;
  }
  const token = randomBytes(18).toString("base64url");
  const expiresAt = expiryFrom(now, config.offerSeconds);
  await tx.query("UPDATE waitlist_entries SET status = 'offered' WHERE id = $1", [next.id]);
  await tx.query("INSERT INTO offers (token, entry_id, performance_id, seat_id, status, expires_at) VALUES ($1, $2, $3, $4, 'open', $5)",
    [token, next.id, performanceId, seatId, expiresAt]);
  await tx.query(
    `UPDATE seats SET state = 'offered', buyer_id = $3, order_id = NULL, ticket_id = NULL, offer_token = $4
     WHERE performance_id = $1 AND id = $2`, [performanceId, seatId, next.buyer_id, token]);
  const { totalCents } = orderTotals([{ faceCents: seat.face_cents, seatFeeCents: seatFeeCents(seat.face_cents) }]);
  await enqueueMail(tx, "offer", offerMail({
    to: next.email, token, seatLabel: labelOf(seatId), performanceTitle: seat.title, startsAtVenue: venueLabel(seat.starts_at),
    totalCents, acceptBy: venueExpiry(expiresAt),
  }));
  await notify(tx, { k: "offer", b: next.buyer_id, t: token, l: labelOf(seatId) });
  await notify(tx, { k: "buyer", b: next.buyer_id });
}
