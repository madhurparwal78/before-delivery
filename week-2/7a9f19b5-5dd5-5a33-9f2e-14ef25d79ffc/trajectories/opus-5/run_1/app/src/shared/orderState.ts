/** The one place the order state machine and its display labels are decided. */

import type { OrderStatus } from "./types.js";

/** Statuses actually stored against an order; `overdue` is derived at read time. */
export type StoredOrderStatus = Exclude<OrderStatus, "overdue">;

export const DISPLAY_STATUS: Record<OrderStatus, string> = {
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

/** States whose cart lines may still be edited, and which `GET /api/cart` returns. */
export const OPEN_CART_STATUSES: readonly StoredOrderStatus[] = ["cart", "declined", "gateway_unavailable"];

export function isOpenCart(status: OrderStatus): boolean {
  return (OPEN_CART_STATUSES as readonly OrderStatus[]).includes(status);
}

/** Authorise accepts a cart, or a retry of a declined or gateway-unavailable order. */
export function canAuthorise(status: OrderStatus): boolean {
  return status === "cart" || status === "declined" || status === "gateway_unavailable";
}

export function canPlaceOnAccount(status: OrderStatus): boolean {
  return status === "cart";
}

/** Dispatch captures an `authorised` card order or invoices a `placed` account order. */
export function canDispatch(status: OrderStatus): boolean {
  return status === "authorised" || status === "placed";
}

export function canRefund(status: OrderStatus): boolean {
  return status === "captured" || status === "partially_refunded";
}

export function canRecordPayment(status: OrderStatus): boolean {
  return status === "invoiced" || status === "overdue";
}

/** Where a refund leaves the order once Kill Bill has recorded it. */
export function statusAfterRefund(capturedCents: number, refundedCents: number): StoredOrderStatus {
  return refundedCents >= capturedCents ? "refunded" : "partially_refunded";
}

export function refundableCents(order: { captured_cents: number; refunded_cents: number }): number {
  return order.captured_cents - order.refunded_cents;
}
