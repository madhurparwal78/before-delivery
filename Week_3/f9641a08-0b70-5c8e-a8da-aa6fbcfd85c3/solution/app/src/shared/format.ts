// Display formatting shared by the server (messages, emails) and the web app.

const rupees = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const day = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", year: "numeric" });
const dayTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** `₹12,499`, `₹1,24,999`, `-₹1,375`. */
export function inr(amount: number): string {
  return `${amount < 0 ? "-" : ""}₹${rupees.format(Math.abs(amount))}`;
}

/** `4 November 2026` in India Standard Time. */
export function longDate(iso: string | Date): string {
  return day.format(typeof iso === "string" ? new Date(iso) : iso);
}

/** `4 Nov 2026, 14:05` in India Standard Time. */
export function shortDateTime(iso: string): string {
  return dayTime.format(new Date(iso));
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export const SIZE_LABELS: Record<string, string> = {
  cabin: "Cabin",
  "check-in-medium": "Check-in Medium",
  "check-in-large": "Check-in Large",
  underseat: "Underseat",
  "one-size": "One size",
};

export const ORDER_STATUS_WORDS: Record<string, string> = {
  placed: "Placed",
  packed: "Packed",
  partially_shipped: "Partially shipped",
  shipped: "Shipped",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export const PAYMENT_STATUS_WORDS: Record<string, string> = {
  pending: "Pending",
  authorized: "Authorized",
  captured: "Paid",
  partially_refunded: "Partially refunded",
  refunded: "Refunded",
  failed: "Failed",
};

export const RETURN_STATUS_WORDS: Record<string, string> = {
  requested: "Requested",
  approved: "Approved",
  rejected: "Rejected",
  in_transit: "In transit",
  received: "Received",
  inspected: "Inspected",
  refunded: "Refunded",
  exchanged: "Exchanged",
};

export const TRIAL_STATUS_WORDS: Record<string, string> = {
  requested: "Requested",
  approved: "Approved",
  rejected: "Rejected",
  returned: "Returned",
  refunded: "Refunded",
};

export const CLAIM_STATUS_WORDS: Record<string, string> = {
  submitted: "Submitted",
  under_review: "Under review",
  approved: "Approved",
  rejected: "Rejected",
  repair: "Repair",
  replacement: "Replacement",
  resolved: "Resolved",
};

export const TIMELINE_LABELS: Record<string, string> = {
  placed: "Order placed",
  packed: "Packed",
  partially_shipped: "Partially shipped",
  shipped: "Shipped",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};
