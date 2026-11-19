import { db } from "./db.js";
import { activeSeats, BillingUnavailable, SEAT_PRICE_CENTS } from "./killbill.js";

function dollars(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** Seats, next invoice and licence term end come from Kill Bill's confirmed state on the office account only. */
export async function billingJson(): Promise<Record<string, unknown>> {
  const waiting = (
    await db.query<{ id: string; full_name: string; seat: string; seat_since: Date }>(
      "SELECT id, full_name, seat, seat_since FROM people WHERE seat IN ('waiting_on_billing','release_waiting') ORDER BY seat_since",
    )
  ).map((person) => ({
    person_id: person.id,
    name: person.full_name,
    change: person.seat === "waiting_on_billing" ? "add" : "release",
    since: person.seat_since.toISOString(),
  }));
  try {
    const seats = await activeSeats();
    const dates = seats.flatMap((seat) => (seat.chargedThroughDate ? [seat.chargedThroughDate.slice(0, 10)] : []));
    const earliest = dates.length > 0 ? [...dates].sort()[0] : undefined;
    const due = earliest ? dates.filter((date) => date === earliest).length : 0;
    return {
      reachable: true,
      seats: seats.length,
      seat_price: dollars(SEAT_PRICE_CENTS),
      currency: "USD",
      next_invoice: earliest ? { date: earliest, amount: dollars(due * SEAT_PRICE_CENTS) } : null,
      licence_term_ends_on: earliest ?? null,
      waiting,
    };
  } catch (error) {
    if (!(error instanceof BillingUnavailable)) throw error;
    return {
      reachable: false,
      seats: null,
      seat_price: dollars(SEAT_PRICE_CENTS),
      currency: "USD",
      next_invoice: null,
      licence_term_ends_on: null,
      waiting,
    };
  }
}
