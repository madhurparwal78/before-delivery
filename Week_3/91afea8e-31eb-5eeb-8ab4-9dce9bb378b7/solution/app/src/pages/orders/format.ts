import { rupees } from "../../../shared/format";
import type { Refund } from "./types";

const DAY = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const TIME = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });

/** An instant as a calendar day in India time. */
export const dayOf = (instant: string): string => DAY.format(new Date(instant));

/** An instant as day, month and time in India time. */
export const timeOf = (instant: string): string => TIME.format(new Date(instant));

function methodLabel(refund: Refund): string {
  switch (refund.method) {
    case "upi":
      return "UPI";
    case "card":
      return `card ending ${refund.card_last4 ?? ""}`.trim();
    case "netbanking":
      return "net banking";
    case "emi":
      return "card EMI";
    default:
      return "Chauraha balance";
  }
}

/** `Refunded <amount> to <method label>.` once the refund is recorded, `Refund of <amount> is on its way.` until then. */
export function refundText(refund: Refund): string {
  const amount = rupees(refund.amount_paise);
  return refund.status === "pending" ? `Refund of ${amount} is on its way.` : `Refunded ${amount} to ${methodLabel(refund)}.`;
}
