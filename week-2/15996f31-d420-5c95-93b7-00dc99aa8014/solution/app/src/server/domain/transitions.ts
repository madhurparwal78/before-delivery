// Order, drop and inspection-link state machines (brief: Business rules). Every transition is decided here.

import type { DropStatus, LinkStatus, OrderStatus } from "../../shared/api.js";
import { conflict } from "../http.js";

type OrderAction = "open" | "cancel" | "commit" | "place" | "issue_link" | "sign" | "settle" | "deliver";

const ORDER_FROM: Record<OrderAction, readonly OrderStatus[]> = {
  open: ["draft"],
  cancel: ["draft", "open", "filled"],
  commit: ["open"],
  deliver: ["open", "filled"],
  place: ["filled"],
  issue_link: ["placed"],
  sign: ["placed"],
  settle: ["inspected"],
};

const ORDER_TO: Partial<Record<OrderAction, OrderStatus>> = {
  open: "open",
  cancel: "cancelled",
  place: "placed",
  sign: "inspected",
  settle: "settled",
};

/** Throws 409 invalid_transition unless the action is allowed from the status; returns the resulting status. */
export function orderTransition(action: OrderAction, status: OrderStatus): OrderStatus {
  if (!ORDER_FROM[action].includes(status)) {
    throw conflict("invalid_transition", "That action isn't allowed while the order is " + status + ".");
  }
  return ORDER_TO[action] ?? status;
}

/** Open becomes filled once committed hives reach hives ordered. */
export function statusAfterCommit(hivesCommitted: number, hivesOrdered: number): OrderStatus {
  return hivesCommitted >= hivesOrdered ? "filled" : "open";
}

export type DropAction = "deliver" | "inspect" | "accept" | "dispute" | "resolve";

const DROP_FROM: Record<DropAction, DropStatus> = {
  deliver: "committed",
  inspect: "delivered",
  accept: "inspected",
  dispute: "inspected",
  resolve: "disputed",
};

const DROP_TO: Record<DropAction, DropStatus> = {
  deliver: "delivered",
  inspect: "inspected",
  accept: "accepted",
  dispute: "disputed",
  resolve: "accepted",
};

export function dropTransition(action: DropAction, status: DropStatus): DropStatus {
  if (DROP_FROM[action] !== status) {
    throw conflict("invalid_transition", "That action isn't allowed while the drop is " + status + ".");
  }
  return DROP_TO[action];
}

/** A drop counts as delivered into its block from delivery on. */
export function isDelivered(status: DropStatus): boolean {
  return status !== "committed";
}

/** A link's status as of `now`: signed wins; replacement or lifetime end make it expired; dead at exactly expires_at. */
export function linkStatus(stored: LinkStatus, expiresAt: Date, now: Date): LinkStatus {
  if (stored === "signed" || stored === "expired") return stored;
  return now.getTime() >= expiresAt.getTime() ? "expired" : stored;
}
