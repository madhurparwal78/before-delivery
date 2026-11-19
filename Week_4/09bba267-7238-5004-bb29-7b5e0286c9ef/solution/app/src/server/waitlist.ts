// Waitlist entries and the offers made to them, in strict join order.
import { randomBytes } from "node:crypto";
import type { Entry, Offer, Order } from "../shared/types.js";
import { offerEnded, salesOpen } from "./clock.js";
import { notify, pool, transaction } from "./db.js";
import { fail, validation } from "./http.js";
import { contactFields, payOrder } from "./checkout.js";
import { KEY_MESSAGE } from "./idempotency.js";
import { cancelOrder, createPendingOrder, issueOrder } from "./orders.js";
import { freeSeat, lockSeats } from "./seats.js";
import { buyerOrder, entriesOf, offerByToken, ordersWhere, performanceRow, tierCounts } from "./views.js";

/** How long an acceptance holds its offer open while Kill Bill answers (several 10 s calls at most). */
const ACCEPTING_MS = 60_000;

export async function joinWaitlist(buyerId: string, performanceId: string, tierId: string, body: unknown, now: Date): Promise<Entry> {
  const show = await performanceRow(pool, performanceId);
  const tier = show && (await pool.query("SELECT 1 FROM tiers WHERE performance_id = $1 AND id = $2", [performanceId, tierId])).rowCount;
  if (!show || !tier) throw fail(404, "not_found");
  if (!salesOpen(show.starts_at, now)) throw fail(409, "sales_closed");
  const id = `w-${randomBytes(8).toString("hex")}`;
  try {
    await transaction(async (tx) => {
      // The tier row lock orders this join against a seat of the tier coming free (see freeSeat).
      await tx.query("SELECT 1 FROM tiers WHERE performance_id = $1 AND id = $2 FOR UPDATE", [performanceId, tierId]);
      const [counts] = await tierCounts(tx, performanceId, tierId);
      if (counts.on_sale > 0) throw fail(409, "tier_not_sold_out");
      const { contact, errors } = contactFields(body);
      const active = await tx.query(
        "SELECT 1 FROM waitlist_entries WHERE performance_id = $1 AND tier_id = $2 AND lower(email) = lower($3) AND status IN ('waiting', 'offered')",
        [performanceId, tierId, contact.email]);
      if (active.rowCount) throw fail(409, "already_waiting");
      if (Object.keys(errors).length) throw validation(errors);
      await tx.query(
        "INSERT INTO waitlist_entries (id, performance_id, tier_id, buyer_id, name, email, status) VALUES ($1, $2, $3, $4, $5, $6, 'waiting')",
        [id, performanceId, tierId, buyerId, contact.name, contact.email]);
      await notify(tx, { k: "seats", p: performanceId });
      await notify(tx, { k: "buyer", b: buyerId });
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw fail(409, "already_waiting");
    throw error;
  }
  const [entry] = await entriesOf(pool, buyerId, now, id);
  return entry;
}

interface OfferRow {
  entry_id: string;
  performance_id: string;
  seat_id: string;
  status: string;
  expires_at: Date;
  starts_at: Date;
  buyer_id: string;
  name: string;
  email: string;
}

async function offerRow(token: string): Promise<OfferRow> {
  const found = await pool.query<OfferRow>(
    `SELECT o.entry_id, o.performance_id, o.seat_id, o.status, o.expires_at, p.starts_at, w.buyer_id, w.name, w.email
     FROM offers o JOIN performances p ON p.id = o.performance_id JOIN waitlist_entries w ON w.id = o.entry_id
     WHERE o.token = $1`, [token]);
  if (!found.rows[0]) throw fail(404, "not_found");
  return found.rows[0];
}

/** An offer that is not open answers 410 when it expired and 409 when it was accepted or declined. */
function refuseClosed(status: string): void {
  if (status === "expired") throw fail(410, "offer_expired");
  if (status !== "open") throw fail(409, "offer_closed");
}

export async function declineOffer(buyerId: string, token: string, now: Date): Promise<Offer> {
  const offer = await offerRow(token);
  await transaction(async (tx) => {
    await lockSeats(tx, offer.performance_id, [offer.seat_id]);
    const current = await tx.query<{ status: string; accepting: boolean }>(
      "SELECT status, coalesce(accepting_until > $2, false) AS accepting FROM offers WHERE token = $1 FOR UPDATE", [token, now]);
    refuseClosed(current.rows[0].status);
    if (current.rows[0].accepting) throw fail(409, "offer_closed");
    await tx.query("UPDATE offers SET status = 'declined' WHERE token = $1", [token]);
    await tx.query("UPDATE waitlist_entries SET status = 'declined' WHERE id = $1", [offer.entry_id]);
    await freeSeat(tx, offer.performance_id, offer.seat_id, now);
    await notify(tx, { k: "offer_closed", t: token, by: buyerId });
    await notify(tx, { k: "buyer", b: offer.buyer_id });
  });
  return (await offerByToken(pool, token, now)) as Offer;
}

export async function acceptOffer(buyerId: string, token: string, keyValid: boolean, now: Date): Promise<Order> {
  const offer = await offerRow(token);
  const pending = await transaction(async (tx) => {
    await lockSeats(tx, offer.performance_id, [offer.seat_id]);
    const current = await tx.query<{ status: string; accepting: boolean; expires_at: Date }>(
      "SELECT status, coalesce(accepting_until > $2, false) AS accepting, expires_at FROM offers WHERE token = $1 FOR UPDATE", [token, now]);
    const { status, accepting, expires_at: expiresAt } = current.rows[0];
    if (!salesOpen(offer.starts_at, now)) throw fail(409, "sales_closed");
    refuseClosed(status);
    if (accepting) throw fail(409, "offer_closed");
    if (offerEnded(expiresAt, offer.starts_at, now)) throw fail(410, "offer_expired");
    if (!keyValid) throw validation({ idempotencyKey: KEY_MESSAGE });
    const tier = await tx.query<{ tier_id: string; face_cents: number }>(
      `SELECT s.tier_id, t.face_cents FROM seats s JOIN tiers t ON t.performance_id = s.performance_id AND t.id = s.tier_id
       WHERE s.performance_id = $1 AND s.id = $2`, [offer.performance_id, offer.seat_id]);
    const orderId = await createPendingOrder(tx, offer.buyer_id, offer.performance_id, offer.name, offer.email,
      [{ seatId: offer.seat_id, tierId: tier.rows[0].tier_id, faceCents: tier.rows[0].face_cents }]);
    await tx.query("UPDATE offers SET accepting_until = $2 WHERE token = $1", [token, new Date(now.getTime() + ACCEPTING_MS)]);
    const [order] = await ordersWhere(tx, "o.id = $1", [orderId]);
    return { orderId, totalCents: order.totalCents };
  });

  const paid = await payOrder(pending.orderId, { name: offer.name, email: offer.email }, pending.totalCents);
  await transaction(async (tx) => {
    await lockSeats(tx, offer.performance_id, [offer.seat_id]);
    await tx.query("SELECT 1 FROM offers WHERE token = $1 FOR UPDATE", [token]);
    await tx.query("UPDATE offers SET accepting_until = NULL WHERE token = $1", [token]);
    if (paid.kind === "confirmed") {
      await tx.query("UPDATE offers SET status = 'accepted' WHERE token = $1", [token]);
      await tx.query("UPDATE waitlist_entries SET status = 'accepted' WHERE id = $1", [offer.entry_id]);
      await issueOrder(tx, pending.orderId, paid.value.accountId, paid.value.paymentId);
      await notify(tx, { k: "offer_closed", t: token, by: buyerId });
      return;
    }
    await cancelOrder(tx, pending.orderId);
    if (paid.kind === "declined") {
      await tx.query("UPDATE offers SET status = 'declined' WHERE token = $1", [token]);
      await tx.query("UPDATE waitlist_entries SET status = 'declined' WHERE id = $1", [offer.entry_id]);
      await freeSeat(tx, offer.performance_id, offer.seat_id, now);
      await notify(tx, { k: "offer_closed", t: token, by: buyerId });
    }
  });
  if (paid.kind === "declined") throw fail(402, "payment_declined");
  if (paid.kind === "unreachable") throw fail(503, "payments_unavailable");
  const [order] = await ordersWhere(pool, "o.id = $1", [pending.orderId]);
  return buyerOrder(order);
}
