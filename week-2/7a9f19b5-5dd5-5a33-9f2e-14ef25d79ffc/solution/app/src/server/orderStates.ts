// The order state changes the brief allows, in one place. Every handler that changes a stored status asks here.
import type { OrderStatus, ReportedStatus } from "../shared/types.js";
import { invalidState } from "./errors.js";

const ALLOWED: Record<OrderStatus, readonly OrderStatus[]> = {
  // card: authorise; account: place on account
  cart: ["authorised", "declined", "gateway_unavailable", "placed"],
  declined: ["authorised", "declined", "gateway_unavailable"],
  gateway_unavailable: ["authorised", "declined", "gateway_unavailable"],
  // dispatch captures a card order
  authorised: ["captured"],
  // refunds
  captured: ["partially_refunded", "refunded"],
  partially_refunded: ["partially_refunded", "refunded"],
  refunded: [],
  // account orders: dispatch raises the invoice, record payment pays it
  placed: ["invoiced"],
  invoiced: ["paid"],
  paid: [],
};

/** Orders whose lines can still be edited, and which GET /api/cart returns. */
export const OPEN_STATUSES: readonly OrderStatus[] = ["cart", "declined", "gateway_unavailable"];

export function isOpen(status: OrderStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

/** Throws the brief's 409 `invalid_state` (reporting `reported`, e.g. `overdue`) unless `from → to` is allowed. */
export function assertChange(from: OrderStatus, to: OrderStatus, reported: ReportedStatus = from): void {
  if (!ALLOWED[from].includes(to)) throw invalidState(reported);
}

const LABELS: Record<ReportedStatus, string> = {
  cart: "Cart",
  authorised: "Authorised",
  captured: "Paid",
  partially_refunded: "Partly refunded",
  refunded: "Refunded",
  declined: "Declined",
  gateway_unavailable: "Payment pending",
  placed: "Placed",
  invoiced: "Invoiced",
  paid: "Paid",
  overdue: "Overdue",
};

export function displayStatus(status: ReportedStatus): string {
  return LABELS[status];
}
