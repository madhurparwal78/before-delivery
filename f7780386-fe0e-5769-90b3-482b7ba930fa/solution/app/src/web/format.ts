// Display helpers over API values: kitchen-local clock text from server instants, money strings.

import { kitchenDate, kitchenMinute } from "../shared/zone.js";
import { clock } from "../shared/rules.js";

/** "2026-11-02 06:00" for a server instant, in the kitchen's zone. */
export function kitchenStamp(instant: string, timeZone: string): string {
  const at = Date.parse(instant);
  return `${kitchenDate(at, timeZone)} ${clock(kitchenMinute(at, timeZone))}`;
}

/** "06:00" for a server instant, in the kitchen's zone. */
export function kitchenClock(instant: string, timeZone: string): string {
  return clock(kitchenMinute(Date.parse(instant), timeZone));
}

/** Integer cents from an API money string such as "84.00" or "-14.00" (no floating point). */
export function moneyCents(amount: string): number {
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(amount);
  if (!match) return 0;
  const cents = Number(match[2]) * 100 + Number(match[3]);
  return match[1] === "-" ? -cents : cents;
}

/** mm:ss for a countdown. */
export function countdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export const KIND_WORDS: Record<string, string> = {
  opening: "Opening balance",
  pack_purchase: "Pack purchase",
  booking_debit: "Booking",
  cancellation_refund: "Cancellation refund",
  adjustment: "Adjustment",
  reversal: "Reversal",
};

export const DOCUMENT_KIND_WORDS: Record<string, string> = {
  liability_insurance: "Liability insurance",
  food_handler_card: "Food handler card",
};

export const DOCUMENT_STATUS_WORDS: Record<string, string> = {
  uploaded: "Waiting for review",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
};

export const BOOKING_STATUS_WORDS: Record<string, string> = {
  confirmed: "Confirmed",
  checked_in: "Checked in",
  completed: "Completed",
  cancelled_free: "Cancelled",
  cancelled_with_fee: "Cancelled with fee",
};
