// Money rules, in whole cents. Server and browser both import these, so each rule is decided once.

const ORDER_FEE_CENTS = 150;
const SEAT_FEE_RATE = 650;
const SEAT_FEE_SCALE = 10000;

/** Seat fee for one seat: face × 650 / 10000, rounded half up to the cent. */
export function seatFeeCents(faceCents: number): number {
  return Math.floor((faceCents * SEAT_FEE_RATE + SEAT_FEE_SCALE / 2) / SEAT_FEE_SCALE);
}

interface PricedSeat {
  faceCents: number;
  seatFeeCents: number;
}

interface Totals {
  faceCents: number;
  seatFeesCents: number;
  orderFeeCents: number;
  totalCents: number;
}

/** An order's (or a cart's) total: face values plus seat fees plus one order fee; an empty cart is all zero. */
export function orderTotals(seats: readonly PricedSeat[]): Totals {
  if (seats.length === 0) return { faceCents: 0, seatFeesCents: 0, orderFeeCents: 0, totalCents: 0 };
  const faceCents = seats.reduce((sum, s) => sum + s.faceCents, 0);
  const seatFeesCents = seats.reduce((sum, s) => sum + s.seatFeeCents, 0);
  return { faceCents, seatFeesCents, orderFeeCents: ORDER_FEE_CENTS, totalCents: faceCents + seatFeesCents + ORDER_FEE_CENTS };
}

/** Exchange difference: new face + seat fee minus old face + seat fee; the order fee is never part of it. */
export function exchangeDifferenceCents(from: PricedSeat, to: PricedSeat): number {
  return to.faceCents + to.seatFeeCents - (from.faceCents + from.seatFeeCents);
}

interface OrderTicket extends PricedSeat {
  id: string;
  status: string;
}

/** Refund of `chosen` tickets: each one's face + seat fee, plus the order fee when no issued ticket would be left. */
export function refundCents(tickets: readonly OrderTicket[], chosen: readonly string[]): { refundCents: number; includesOrderFee: boolean } {
  const refunded = tickets.filter((t) => chosen.includes(t.id));
  const includesOrderFee = !tickets.some((t) => t.status === "issued" && !chosen.includes(t.id));
  const seatsCents = refunded.reduce((sum, t) => sum + t.faceCents + t.seatFeeCents, 0);
  return { refundCents: seatsCents + (includesOrderFee ? ORDER_FEE_CENTS : 0), includesOrderFee };
}

/** `$1,234.50` */
export function formatMoney(cents: number): string {
  const dollars = Math.floor(cents / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${dollars}.${String(cents % 100).padStart(2, "0")}`;
}
