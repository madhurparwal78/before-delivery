// Checkout: the held seats become a pending order, Kill Bill records the purchase, and only then are tickets issued.
import type { Order } from "../shared/types.js";
import { salesOpen } from "./clock.js";
import { pool, transaction } from "./db.js";
import { fail, validation } from "./http.js";
import { dropEmptyCart, lockBuyerCart } from "./holds.js";
import { KEY_MESSAGE } from "./idempotency.js";
import { ensureAccount, purchase, type KillBillResult } from "./killbill.js";
import { cancelOrder, createPendingOrder, issueOrder } from "./orders.js";
import { freeSeat, lockSeats, markCheckout } from "./seats.js";
import { buyerOrder, ordersWhere, performanceRow } from "./views.js";

const NAME_MESSAGE = "Enter your full name.";
const EMAIL_MESSAGE = "Enter an email address like name@example.com.";

interface Contact {
  name: string;
  email: string;
}

/** Name: 1 to 80 characters after trimming. Email: at most 254 characters, one `@` with text on both sides, a dot in the domain. */
export function contactFields(body: unknown): { contact: Contact; errors: Record<string, string> } {
  const { name, email } = body as { name?: unknown; email?: unknown };
  const trimmedName = typeof name === "string" ? name.trim() : "";
  const trimmedEmail = typeof email === "string" ? email.trim() : "";
  const errors: Record<string, string> = {};
  if (trimmedName.length < 1 || trimmedName.length > 80) errors.name = NAME_MESSAGE;
  const [local, domain, ...rest] = trimmedEmail.split("@");
  const emailOk = trimmedEmail.length <= 254 && rest.length === 0 && !!local && !!domain && domain.includes(".")
    && !/\s/.test(trimmedEmail);
  if (!emailOk) errors.email = EMAIL_MESSAGE;
  return { contact: { name: trimmedName, email: trimmedEmail }, errors };
}

/** Records one purchase for an order's total on the fan's Kill Bill account. */
export async function payOrder(orderId: string, contact: Contact, totalCents: number): Promise<KillBillResult<{ accountId: string; paymentId: string }>> {
  const account = await ensureAccount(contact.email, contact.name);
  if (account.kind !== "confirmed") return account;
  const paid = await purchase(account.value, totalCents, orderId, `${orderId}-purchase`);
  return paid.kind === "confirmed" ? { kind: "confirmed", value: { accountId: account.value, paymentId: paid.value } } : paid;
}

export async function checkout(buyerId: string, performanceId: string, body: unknown, keyValid: boolean, now: Date): Promise<Order> {
  const show = await performanceRow(pool, performanceId);
  if (!show) throw fail(404, "not_found");

  const pending = await transaction(async (tx) => {
    await lockBuyerCart(tx, buyerId, performanceId);
    if (!salesOpen(show.starts_at, now)) throw fail(409, "sales_closed");
    const held = await tx.query<{ id: string; tier_id: string; face_cents: number }>(
      `SELECT s.id, s.tier_id, t.face_cents FROM seats s JOIN tiers t ON t.performance_id = s.performance_id AND t.id = s.tier_id
       WHERE s.performance_id = $1 AND s.buyer_id = $2 AND s.state = 'held' AND s.ticket_id IS NULL AND s.order_id IS NULL
       ORDER BY s.ordinal`, [performanceId, buyerId]);
    if (held.rows.length === 0) throw fail(409, "cart_empty");
    await lockSeats(tx, performanceId, held.rows.map((s) => s.id));
    const { contact, errors } = contactFields(body);
    if (!keyValid) errors.idempotencyKey = KEY_MESSAGE;
    if (Object.keys(errors).length) throw validation(errors);
    const seats = held.rows.map((s) => ({ seatId: s.id, tierId: s.tier_id, faceCents: s.face_cents }));
    const orderId = await createPendingOrder(tx, buyerId, performanceId, contact.name, contact.email, seats);
    await markCheckout(tx, performanceId, held.rows.map((s) => s.id), orderId);
    const [order] = await ordersWhere(tx, "o.id = $1", [orderId]);
    return { orderId, contact, seatIds: held.rows.map((s) => s.id), totalCents: order.totalCents };
  });

  const paid = await payOrder(pending.orderId, pending.contact, pending.totalCents);
  await transaction(async (tx) => {
    await lockBuyerCart(tx, buyerId, performanceId);
    await lockSeats(tx, performanceId, pending.seatIds);
    if (paid.kind === "confirmed") {
      await issueOrder(tx, pending.orderId, paid.value.accountId, paid.value.paymentId);
    } else {
      await cancelOrder(tx, pending.orderId);
      if (paid.kind === "declined") {
        for (const seatId of pending.seatIds) await freeSeat(tx, performanceId, seatId, now);
      } else {
        await markCheckout(tx, performanceId, pending.seatIds, null);
      }
    }
    await dropEmptyCart(tx, buyerId, performanceId);
  });
  if (paid.kind === "declined") throw fail(402, "payment_declined");
  if (paid.kind === "unreachable") throw fail(503, "payments_unavailable");
  const [order] = await ordersWhere(pool, "o.id = $1", [pending.orderId]);
  return buyerOrder(order);
}
