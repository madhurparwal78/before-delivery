// Exchanges and refunds of issued tickets, each confirmed by Kill Bill before anything changes hands.
import { randomBytes } from "node:crypto";
import { exchangeDifferenceCents, refundCents, seatFeeCents } from "../shared/rules.js";
import type { Order } from "../shared/types.js";
import { changesOpen } from "./clock.js";
import { pool, transaction, type Tx } from "./db.js";
import { exchangeMail, refundMail } from "./emails.js";
import { fail, validation } from "./http.js";
import { KEY_MESSAGE } from "./idempotency.js";
import { purchase, refund, type KillBillResult } from "./killbill.js";
import { moveTicket, setTicketStatus, settleRefundedOrder } from "./orders.js";
import { enqueueMail } from "./outbox.js";
import { freeSeat, holdSeat, lockSeats, sellSeat } from "./seats.js";
import { buyerOrder, labelOf, ordersWhere } from "./views.js";

const NEW_SEAT_MESSAGE = "Choose a different seat that is on sale for this performance.";
const TICKETS_MESSAGE = "Choose one or more different tickets from this order.";

interface TicketRow {
  id: string;
  order_id: string;
  seat_id: string;
  face_cents: number;
  seat_fee_cents: number;
  status: string;
  buyer_id: string;
  performance_id: string;
  starts_at: Date;
  killbill_account_id: string;
  charged_exchanges: number;
}

async function ticketOf(buyerId: string, ticketId: string): Promise<TicketRow> {
  const found = await pool.query<TicketRow>(
    `SELECT k.id, k.order_id, k.seat_id, k.face_cents, k.seat_fee_cents, k.status, o.buyer_id, o.performance_id, p.starts_at,
            o.killbill_account_id, o.charged_exchanges
     FROM tickets k JOIN orders o ON o.id = k.order_id JOIN performances p ON p.id = o.performance_id
     WHERE k.id = $1 AND o.buyer_id = $2`, [ticketId, buyerId]);
  if (!found.rows[0]) throw fail(404, "not_found");
  return found.rows[0];
}

interface RefundPart {
  paymentId: string;
  cents: number;
}

/**
 * Refunds `cents` against the order's payments, newest first, never more than a payment still has refundable.
 * `done` lists every part Kill Bill confirmed, also when a later part fails, so each is recorded.
 */
async function refundAcrossPayments(orderId: string, cents: number, keyPrefix: string): Promise<{ result: KillBillResult<null>; done: RefundPart[] }> {
  const payments = await pool.query<{ killbill_payment_id: string; refundable: number }>(
    `SELECT killbill_payment_id, amount_cents - refunded_cents AS refundable FROM payments
     WHERE order_id = $1 AND amount_cents > refunded_cents ORDER BY created_at DESC`, [orderId]);
  const done: RefundPart[] = [];
  let left = cents;
  for (const [index, payment] of payments.rows.entries()) {
    if (left === 0) break;
    const part = Math.min(left, payment.refundable);
    const result = await refund(payment.killbill_payment_id, part, `${keyPrefix}-${index + 1}`);
    if (result.kind !== "confirmed") return { result, done };
    done.push({ paymentId: payment.killbill_payment_id, cents: part });
    left -= part;
  }
  return { result: { kind: "confirmed", value: null }, done };
}

async function recordRefunds(tx: Tx, refunds: RefundPart[]): Promise<void> {
  for (const r of refunds) {
    await tx.query("UPDATE payments SET refunded_cents = refunded_cents + $2 WHERE killbill_payment_id = $1", [r.paymentId, r.cents]);
  }
}

const refundKey = (orderId: string): string => `${orderId}-refund-${randomBytes(4).toString("hex")}`;

export async function exchangeTicket(buyerId: string, ticketId: string, body: unknown, keyValid: boolean, now: Date): Promise<{ order: Order; differenceCents: number }> {
  const ticket = await ticketOf(buyerId, ticketId);
  const requested = (body as { newSeatId?: unknown }).newSeatId;
  const newSeatId = typeof requested === "string" && requested !== ticket.seat_id ? requested : "";
  const performanceId = ticket.performance_id;

  const pending = await transaction(async (tx) => {
    const seats = await lockSeats(tx, performanceId, [ticket.seat_id, newSeatId]);
    const current = await tx.query<{ status: string }>("SELECT status FROM tickets WHERE id = $1 FOR UPDATE", [ticketId]);
    if (!changesOpen(ticket.starts_at, now)) throw fail(409, "changes_closed");
    if (current.rows[0].status !== "issued") throw fail(409, "ticket_not_issued");
    const tierId = seats.get(newSeatId)?.tier_id ?? null;
    if (tierId && seats.get(newSeatId)?.state !== "on_sale") throw fail(409, "seats_taken", { taken: [newSeatId] });
    const errors: Record<string, string> = {};
    if (!tierId) errors.newSeatId = NEW_SEAT_MESSAGE;
    if (!keyValid) errors.idempotencyKey = KEY_MESSAGE;
    if (!tierId || Object.keys(errors).length) throw validation(errors);
    const tier = await tx.query<{ face_cents: number }>("SELECT face_cents FROM tiers WHERE performance_id = $1 AND id = $2",
      [performanceId, tierId]);
    await holdSeat(tx, performanceId, newSeatId, buyerId, ticketId);
    await setTicketStatus(tx, [ticketId], "exchange_pending", buyerId);
    const faceCents = tier.rows[0].face_cents;
    return {
      newSeatId, tierId, faceCents,
      differenceCents: exchangeDifferenceCents(
        { faceCents: ticket.face_cents, seatFeeCents: ticket.seat_fee_cents }, { faceCents, seatFeeCents: seatFeeCents(faceCents) }),
    };
  });

  const { differenceCents } = pending;
  let charged: KillBillResult<string | null>;
  let refunded: RefundPart[] = [];
  if (differenceCents > 0) {
    const paymentKey = `${ticket.order_id}-exchange-${ticket.charged_exchanges + 1}`;
    charged = await purchase(ticket.killbill_account_id, differenceCents, paymentKey, `${paymentKey}-purchase`);
  } else if (differenceCents < 0) {
    const parts = await refundAcrossPayments(ticket.order_id, -differenceCents, refundKey(ticket.order_id));
    charged = parts.result;
    refunded = parts.done;
  } else {
    charged = { kind: "confirmed", value: null };
  }

  await transaction(async (tx) => {
    await lockSeats(tx, performanceId, [ticket.seat_id, pending.newSeatId]);
    await recordRefunds(tx, refunded);
    if (charged.kind !== "confirmed") {
      await freeSeat(tx, performanceId, pending.newSeatId, now);
      await setTicketStatus(tx, [ticketId], "issued", buyerId);
      return;
    }
    if (charged.value) {
      await tx.query("INSERT INTO payments (killbill_payment_id, order_id, external_key, amount_cents) VALUES ($1, $2, $3, $4)",
        [charged.value, ticket.order_id, `${ticket.order_id}-exchange-${ticket.charged_exchanges + 1}`, differenceCents]);
      await tx.query("UPDATE orders SET charged_exchanges = charged_exchanges + 1 WHERE id = $1", [ticket.order_id]);
    }
    await moveTicket(tx, ticketId, pending.newSeatId, pending.tierId, pending.faceCents, buyerId);
    await sellSeat(tx, performanceId, pending.newSeatId, buyerId, ticket.order_id, ticketId);
    await freeSeat(tx, performanceId, ticket.seat_id, now);
    const [order] = await ordersWhere(tx, "o.id = $1", [ticket.order_id]);
    await enqueueMail(tx, "exchange", exchangeMail(buyerOrder(order), labelOf(ticket.seat_id), labelOf(pending.newSeatId), differenceCents));
  });
  if (charged.kind === "declined") throw fail(402, "payment_declined");
  if (charged.kind === "unreachable") throw fail(503, "payments_unavailable");
  const [order] = await ordersWhere(pool, "o.id = $1", [ticket.order_id]);
  return { order: buyerOrder(order), differenceCents };
}

export async function refundTickets(buyerId: string, orderId: string, body: unknown, keyValid: boolean, now: Date): Promise<{ order: Order; refundCents: number }> {
  const found = await pool.query<{ performance_id: string; starts_at: Date }>(
    "SELECT o.performance_id, p.starts_at FROM orders o JOIN performances p ON p.id = o.performance_id WHERE o.id = $1 AND o.buyer_id = $2",
    [orderId, buyerId]);
  if (!found.rows[0]) throw fail(404, "not_found");
  const { performance_id: performanceId, starts_at: startsAt } = found.rows[0];
  const ticketIds = (body as { ticketIds?: unknown }).ticketIds;

  const pending = await transaction(async (tx) => {
    await tx.query("SELECT id FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
    const tickets = await tx.query<{ id: string; seat_id: string; face_cents: number; seat_fee_cents: number; status: string }>(
      "SELECT id, seat_id, face_cents, seat_fee_cents, status FROM tickets WHERE order_id = $1 ORDER BY id FOR UPDATE", [orderId]);
    if (!changesOpen(startsAt, now)) throw fail(409, "changes_closed");
    const ids = Array.isArray(ticketIds) ? ticketIds : [];
    const chosen = tickets.rows.filter((t) => ids.includes(t.id));
    if (chosen.some((t) => t.status !== "issued")) throw fail(409, "ticket_not_issued");
    const errors: Record<string, string> = {};
    if (ids.length === 0 || chosen.length !== ids.length || new Set(ids).size !== ids.length) errors.ticketIds = TICKETS_MESSAGE;
    if (!keyValid) errors.idempotencyKey = KEY_MESSAGE;
    if (Object.keys(errors).length) throw validation(errors);
    await setTicketStatus(tx, chosen.map((t) => t.id), "refund_pending", buyerId);
    const priced = tickets.rows.map((t) => ({ id: t.id, status: t.status, faceCents: t.face_cents, seatFeeCents: t.seat_fee_cents }));
    return { chosen, ...refundCents(priced, chosen.map((t) => t.id)) };
  });

  const { result, done } = await refundAcrossPayments(orderId, pending.refundCents, refundKey(orderId));
  await transaction(async (tx) => {
    await lockSeats(tx, performanceId, pending.chosen.map((t) => t.seat_id));
    await recordRefunds(tx, done);
    const ids = pending.chosen.map((t) => t.id);
    if (result.kind !== "confirmed") {
      await setTicketStatus(tx, ids, "issued", buyerId);
      return;
    }
    await setTicketStatus(tx, ids, "refunded", buyerId);
    for (const t of pending.chosen) await freeSeat(tx, performanceId, t.seat_id, now);
    await settleRefundedOrder(tx, orderId);
    const [order] = await ordersWhere(tx, "o.id = $1", [orderId]);
    await enqueueMail(tx, "refund", refundMail(buyerOrder(order), pending.chosen.map((t) => labelOf(t.seat_id)), pending.includesOrderFee, pending.refundCents));
  });
  if (result.kind === "declined") throw fail(402, "payment_declined");
  if (result.kind === "unreachable") throw fail(503, "payments_unavailable");
  const [order] = await ordersWhere(pool, "o.id = $1", [orderId]);
  return { order: buyerOrder(order), refundCents: pending.refundCents };
}
