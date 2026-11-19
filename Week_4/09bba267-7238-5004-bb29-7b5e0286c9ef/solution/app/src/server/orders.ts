// Order and ticket state transitions. Every change of an order's or a ticket's status happens here.
import { randomBytes } from "node:crypto";
import { orderTotals, seatFeeCents } from "../shared/rules.js";
import type { TicketStatus } from "../shared/types.js";
import { notify, type Tx } from "./db.js";
import { receiptMail } from "./emails.js";
import { enqueueMail } from "./outbox.js";
import { sellSeat } from "./seats.js";
import { buyerOrder, ordersWhere } from "./views.js";

const ORDER_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function orderId(): string {
  return `HH-${[...randomBytes(8)].map((b) => ORDER_ALPHABET[b % ORDER_ALPHABET.length]).join("")}`;
}

interface OrderSeat {
  seatId: string;
  tierId: string;
  faceCents: number;
}

/** A new order in `pending_payment` with its tickets `payment_pending`. */
export async function createPendingOrder(
  tx: Tx, buyerId: string, performanceId: string, name: string, email: string, seats: readonly OrderSeat[],
): Promise<string> {
  const id = orderId();
  const priced = seats.map((s) => ({ ...s, seatFeeCents: seatFeeCents(s.faceCents) }));
  const totals = orderTotals(priced);
  await tx.query(
    `INSERT INTO orders (id, buyer_id, performance_id, name, email, status, face_cents, seat_fees_cents, order_fee_cents, total_cents)
     VALUES ($1, $2, $3, $4, $5, 'pending_payment', $6, $7, $8, $9)`,
    [id, buyerId, performanceId, name, email, totals.faceCents, totals.seatFeesCents, totals.orderFeeCents, totals.totalCents]);
  for (const seat of priced) {
    await tx.query(
      `INSERT INTO tickets (id, order_id, seat_id, tier_id, face_cents, seat_fee_cents, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'payment_pending')`,
      [`t-${randomBytes(8).toString("hex")}`, id, seat.seatId, seat.tierId, seat.faceCents, seat.seatFeeCents]);
  }
  await notify(tx, { k: "buyer", b: buyerId });
  return id;
}

/** Kill Bill confirmed the purchase: the order is paid, its seats sold, its tickets issued and its receipt queued. */
export async function issueOrder(tx: Tx, id: string, accountId: string, paymentId: string): Promise<void> {
  const order = await tx.query<{ buyer_id: string; performance_id: string; total_cents: number }>(
    "UPDATE orders SET status = 'paid', killbill_account_id = $2 WHERE id = $1 RETURNING buyer_id, performance_id, total_cents",
    [id, accountId]);
  const { buyer_id: buyerId, performance_id: performanceId, total_cents: totalCents } = order.rows[0];
  await tx.query("INSERT INTO payments (killbill_payment_id, order_id, external_key, amount_cents) VALUES ($1, $2, $2, $3)",
    [paymentId, id, totalCents]);
  const tickets = await tx.query<{ id: string; seat_id: string }>(
    "UPDATE tickets SET status = 'issued' WHERE order_id = $1 RETURNING id, seat_id", [id]);
  for (const ticket of tickets.rows) await sellSeat(tx, performanceId, ticket.seat_id, buyerId, id, ticket.id);
  const [view] = await ordersWhere(tx, "o.id = $1", [id]);
  await enqueueMail(tx, "receipt", receiptMail(buyerOrder(view)), id);
  await notify(tx, { k: "buyer", b: buyerId });
}

/** Kill Bill declined, or could not be reached: the order is cancelled and no ticket is issued. */
export async function cancelOrder(tx: Tx, id: string): Promise<void> {
  const order = await tx.query<{ buyer_id: string }>("UPDATE orders SET status = 'cancelled' WHERE id = $1 RETURNING buyer_id", [id]);
  await notify(tx, { k: "buyer", b: order.rows[0].buyer_id });
}

/** Moves tickets between issued and the pending statuses of an exchange or a refund. */
export async function setTicketStatus(tx: Tx, ticketIds: readonly string[], status: TicketStatus, buyerId: string): Promise<void> {
  await tx.query("UPDATE tickets SET status = $2 WHERE id = ANY($1)", [[...ticketIds], status]);
  await notify(tx, { k: "buyer", b: buyerId });
}

/** A confirmed exchange: the ticket moves to its new seat and is issued again. */
export async function moveTicket(tx: Tx, ticketId: string, seatId: string, tierId: string, faceCents: number, buyerId: string): Promise<void> {
  await tx.query("UPDATE tickets SET seat_id = $2, tier_id = $3, face_cents = $4, seat_fee_cents = $5, status = 'issued' WHERE id = $1",
    [ticketId, seatId, tierId, faceCents, seatFeeCents(faceCents)]);
  await notify(tx, { k: "buyer", b: buyerId });
}

/** After a confirmed refund: refunded when no ticket is left issued, partially refunded otherwise. */
export async function settleRefundedOrder(tx: Tx, id: string): Promise<void> {
  await tx.query(
    `UPDATE orders SET status = CASE WHEN EXISTS (SELECT 1 FROM tickets WHERE order_id = $1 AND status <> 'refunded')
                                     THEN 'partially_refunded' ELSE 'refunded' END
     WHERE id = $1`, [id]);
}
