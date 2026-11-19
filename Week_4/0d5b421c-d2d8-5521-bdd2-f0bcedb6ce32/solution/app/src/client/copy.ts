// Published copy that is not tied to one screen.
import type { Deposit } from "../shared/api.js";
import { formatEuros } from "../shared/euros.js";

export function depositLine(deposit: Deposit): string {
  const amount = formatEuros(deposit.amount_cents);
  switch (deposit.state) {
    case "none":
      return "No deposit";
    case "paid":
      return `Deposit €${amount} paid`;
    case "refunded":
      return `Refunded: €${amount}`;
    case "retained":
      return `Deposit kept: €${amount}`;
  }
}

export const PAYMENT_FAILED = "Your deposit didn't go through, so nothing was booked. Your table is still held.";
export const DEAD_MANAGE = "This booking link no longer works.";
export const DEAD_OFFER = "This offer link no longer works.";
export const OFFER_ENDED = "This offer has ended.";
export const CANCEL_DOWN = "We couldn't reach our payments system, so your booking is unchanged. Please try again shortly.";

export function depositParagraph(cents: number, perCoverCents: number): string {
  return `A deposit of €${formatEuros(cents)} is charged now: €${Math.trunc(perCoverCents / 100)} for each guest. It is refunded in full if you cancel at least 24 hours before your table. After that it is kept.`;
}
