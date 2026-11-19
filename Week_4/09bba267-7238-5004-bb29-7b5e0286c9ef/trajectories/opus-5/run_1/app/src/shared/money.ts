/** The order fee, charged once per order. */
export const ORDER_FEE_CENTS = 150;

const SEAT_FEE_NUMERATOR = 650;
const SEAT_FEE_DENOMINATOR = 10000;

/** The seat fee for one seat: face value x 6.5%, rounded half up to the cent. */
export function seatFeeCents(faceCents: number): number {
  return Math.floor((faceCents * SEAT_FEE_NUMERATOR) / SEAT_FEE_DENOMINATOR + 0.5);
}

export interface LedgerInput {
  readonly faceCents: number;
  readonly seatFeeCents: number;
}

export interface Ledger {
  readonly faceCents: number;
  readonly seatFeesCents: number;
  readonly orderFeeCents: number;
  readonly totalCents: number;
}

export function ledgerOf(lines: readonly LedgerInput[]): Ledger {
  const faceCents = lines.reduce((sum, line) => sum + line.faceCents, 0);
  const seatFeesCents = lines.reduce((sum, line) => sum + line.seatFeeCents, 0);
  const orderFeeCents = lines.length === 0 ? 0 : ORDER_FEE_CENTS;
  return { faceCents, seatFeesCents, orderFeeCents, totalCents: faceCents + seatFeesCents + orderFeeCents };
}

/**
 * A refund gives back each refunded ticket's face value plus seat fee, and the order fee as well
 * when the refund leaves the order with no issued tickets.
 */
export function refundAmountCents(input: {
  readonly refunded: readonly LedgerInput[];
  readonly issuedTicketsLeft: number;
}): number {
  const seats = input.refunded.reduce((sum, ticket) => sum + ticket.faceCents + ticket.seatFeeCents, 0);
  return seats + (input.issuedTicketsLeft === 0 ? ORDER_FEE_CENTS : 0);
}

export function formatMoney(cents: number): string {
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const dollars = Math.floor(absolute / 100);
  const remainder = absolute % 100;
  const grouped = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${grouped}.${remainder.toString().padStart(2, '0')}`;
}

/** Kill Bill records amounts in dollars. */
export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}
