// Ends holds and offers at their server expiry instant. Runs before every API request and every second in
// every copy, so an ended hold or offer is released in every response, whatever any device clock says.
import { hasExpired, isoInstant, offerEnded } from "./clock.js";
import { notify, pool, transaction } from "./db.js";
import { freeSeat, lockSeats } from "./seats.js";

interface CartRow {
  buyer_id: string;
  performance_id: string;
  expires_at: Date;
}

interface OfferRow {
  token: string;
  performance_id: string;
  seat_id: string;
  expires_at: Date;
  starts_at: Date;
}

async function endHold(cart: CartRow, now: Date): Promise<void> {
  await transaction(async (tx) => {
    const locked = await tx.query<CartRow>(
      "SELECT buyer_id, performance_id, expires_at FROM carts WHERE buyer_id = $1 AND performance_id = $2 FOR UPDATE",
      [cart.buyer_id, cart.performance_id]);
    const current = locked.rows[0];
    if (!current || !hasExpired(current.expires_at, now)) return;
    const held = await tx.query<{ id: string; order_id: string | null }>(
      `SELECT id, order_id FROM seats WHERE performance_id = $1 AND buyer_id = $2 AND state = 'held' AND ticket_id IS NULL`,
      [cart.performance_id, cart.buyer_id]);
    // A checkout that started before the expiry instant keeps its seats until Kill Bill answers.
    if (held.rows.some((s) => s.order_id !== null)) return;
    await lockSeats(tx, cart.performance_id, held.rows.map((s) => s.id));
    for (const seat of held.rows) await freeSeat(tx, cart.performance_id, seat.id, now);
    await tx.query("DELETE FROM carts WHERE buyer_id = $1 AND performance_id = $2", [cart.buyer_id, cart.performance_id]);
    await notify(tx, { k: "hold_ended", b: cart.buyer_id, p: cart.performance_id, e: isoInstant(current.expires_at) });
    await notify(tx, { k: "buyer", b: cart.buyer_id });
  });
}

async function endOffer(offer: OfferRow, now: Date): Promise<void> {
  await transaction(async (tx) => {
    await lockSeats(tx, offer.performance_id, [offer.seat_id]);
    const locked = await tx.query<{ entry_id: string; status: string; accepting: boolean }>(
      "SELECT entry_id, status, coalesce(accepting_until > $2, false) AS accepting FROM offers WHERE token = $1 FOR UPDATE",
      [offer.token, now]);
    const current = locked.rows[0];
    if (current.status !== "open" || current.accepting) return;
    await tx.query("UPDATE offers SET status = 'expired' WHERE token = $1", [offer.token]);
    await tx.query("UPDATE waitlist_entries SET status = 'expired' WHERE id = $1", [current.entry_id]);
    await freeSeat(tx, offer.performance_id, offer.seat_id, now);
    await notify(tx, { k: "offer_closed", t: offer.token, by: null });
  });
}

export async function sweep(now: Date): Promise<void> {
  const carts = await pool.query<CartRow>("SELECT buyer_id, performance_id, expires_at FROM carts");
  for (const cart of carts.rows) {
    if (hasExpired(cart.expires_at, now)) await endHold(cart, now);
  }
  const offers = await pool.query<OfferRow>(
    `SELECT o.token, o.performance_id, o.seat_id, o.expires_at, p.starts_at
     FROM offers o JOIN performances p ON p.id = o.performance_id
     WHERE o.status = 'open' AND NOT coalesce(o.accepting_until > $1, false)`, [now]);
  for (const offer of offers.rows) {
    if (offerEnded(offer.expires_at, offer.starts_at, now)) await endOffer(offer, now);
  }
}
