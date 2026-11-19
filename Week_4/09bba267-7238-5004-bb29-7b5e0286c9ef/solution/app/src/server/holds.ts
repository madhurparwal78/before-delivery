// Holding and releasing seats. The buyer's row lock makes concurrent holds from any tab or copy count together;
// each seat's row lock gives every contested seat exactly one winner.
import { bySeatOrder } from "../shared/hall.js";
import type { Cart } from "../shared/types.js";
import { config } from "./config.js";
import { expiryFrom, salesOpen } from "./clock.js";
import { notify, pool, transaction, type Tx } from "./db.js";
import { fail, validation } from "./http.js";
import { freeSeat, holdSeat, lockSeats } from "./seats.js";
import { cartOf, performanceRow } from "./views.js";

const SEAT_LIMIT = 8;
const SEATS_MESSAGE = "Choose between 1 and 8 different seats that are on sale for this performance.";
const LIMIT_MESSAGE = "You can hold up to 8 seats for a performance.";

export async function lockBuyerCart(tx: Tx, buyerId: string, performanceId: string): Promise<void> {
  await tx.query("SELECT id FROM buyers WHERE id = $1 FOR UPDATE", [buyerId]);
  await tx.query("SELECT 1 FROM carts WHERE buyer_id = $1 AND performance_id = $2 FOR UPDATE", [buyerId, performanceId]);
}

/** Seats counted toward the limit: held in the cart (not yet in a checkout) plus the buyer's live tickets. */
async function seatsCounted(tx: Tx, buyerId: string, performanceId: string): Promise<number> {
  const counted = await tx.query<{ n: number }>(
    `SELECT (SELECT count(*) FROM seats WHERE performance_id = $2 AND buyer_id = $1 AND state = 'held'
               AND order_id IS NULL AND ticket_id IS NULL)
          + (SELECT count(*) FROM tickets k JOIN orders o ON o.id = k.order_id
             WHERE o.buyer_id = $1 AND o.performance_id = $2 AND o.status <> 'cancelled'
               AND k.status IN ('issued', 'payment_pending', 'exchange_pending', 'refund_pending')) AS n`,
    [buyerId, performanceId]);
  return Number(counted.rows[0].n);
}

interface HoldResult {
  cart: Cart;
  held: string[];
  taken: string[];
}

export async function holdSeats(buyerId: string, performanceId: string, body: unknown, now: Date): Promise<HoldResult> {
  const show = await performanceRow(pool, performanceId);
  if (!show) throw fail(404, "not_found");
  if (!salesOpen(show.starts_at, now)) throw fail(409, "sales_closed");
  const seatIds = (body as { seatIds?: unknown }).seatIds;
  const wellFormed = Array.isArray(seatIds) && seatIds.length >= 1 && seatIds.length <= SEAT_LIMIT
    && seatIds.every((id): id is string => typeof id === "string") && new Set(seatIds).size === seatIds.length;
  if (!wellFormed) throw validation({ seatIds: SEATS_MESSAGE });

  return transaction(async (tx) => {
    await lockBuyerCart(tx, buyerId, performanceId);
    const seats = await lockSeats(tx, performanceId, seatIds);
    if (seatIds.some((id) => !seats.get(id)?.tier_id)) throw validation({ seatIds: SEATS_MESSAGE });
    const mine = (id: string): boolean => {
      const seat = seats.get(id);
      return seat?.state === "held" && seat.buyer_id === buyerId && seat.ticket_id === null;
    };
    const requested = seatIds.filter((id) => !mine(id)).sort(bySeatOrder);
    const free = requested.filter((id) => seats.get(id)?.state === "on_sale");
    const taken = requested.filter((id) => !free.includes(id));
    if (free.length === 0 && taken.length > 0) {
      throw fail(409, "seats_taken", { taken, cart: await cartOf(tx, buyerId, performanceId, now) });
    }
    if ((await seatsCounted(tx, buyerId, performanceId)) + requested.length > SEAT_LIMIT) {
      throw validation({ seatIds: LIMIT_MESSAGE });
    }
    for (const id of free) await holdSeat(tx, performanceId, id, buyerId, null);
    await tx.query(
      "INSERT INTO carts (buyer_id, performance_id, expires_at) VALUES ($1, $2, $3) ON CONFLICT (buyer_id, performance_id) DO NOTHING",
      [buyerId, performanceId, expiryFrom(now, config.holdSeconds)]);
    await notify(tx, { k: "buyer", b: buyerId });
    return { cart: await cartOf(tx, buyerId, performanceId, now), held: free, taken };
  });
}

/** A cart with no held seat left is gone, so the next hold starts a new expiry instant. */
export async function dropEmptyCart(tx: Tx, buyerId: string, performanceId: string): Promise<void> {
  await tx.query(
    `DELETE FROM carts c WHERE buyer_id = $1 AND performance_id = $2 AND NOT EXISTS (
       SELECT 1 FROM seats s WHERE s.performance_id = c.performance_id AND s.buyer_id = c.buyer_id
         AND s.state = 'held' AND s.ticket_id IS NULL)`, [buyerId, performanceId]);
  await notify(tx, { k: "buyer", b: buyerId });
}

export async function releaseSeat(buyerId: string, performanceId: string, seatId: string, now: Date): Promise<Cart> {
  return transaction(async (tx) => {
    await lockBuyerCart(tx, buyerId, performanceId);
    const seat = (await lockSeats(tx, performanceId, [seatId])).get(seatId);
    if (!(seat?.state === "held" && seat.buyer_id === buyerId && seat.ticket_id === null && seat.order_id === null)) {
      throw fail(404, "not_found");
    }
    await freeSeat(tx, performanceId, seatId, now);
    await dropEmptyCart(tx, buyerId, performanceId);
    return cartOf(tx, buyerId, performanceId, now);
  });
}
