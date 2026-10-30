/**
 * The single place every order, drop and inspection-link transition is
 * decided. Reused everywhere else.
 */

export type OrderStatus = "draft" | "open" | "filled" | "placed" | "inspected" | "settled" | "cancelled";
export type OrderAction = "open" | "cancel" | "fill" | "place" | "issue_link" | "sign" | "settle";
export type DropStatus = "committed" | "delivered" | "inspected" | "disputed" | "accepted";
export type DropAction = "deliver" | "mark_inspected" | "accept" | "dispute" | "resolve";
export type LinkStatus = "issued" | "used" | "signed" | "expired";
export type SettlementStatus = "none" | "queued" | "settled";

export const ORDER_LABELS: Record<OrderStatus, string> = {
  draft: "Draft",
  open: "Open",
  filled: "Filled",
  placed: "Placed",
  inspected: "Inspected",
  settled: "Settled",
  cancelled: "Cancelled",
};

export const DROP_LABELS: Record<DropStatus, string> = {
  committed: "Committed",
  delivered: "Delivered",
  inspected: "Inspected",
  disputed: "Disputed",
  accepted: "Accepted",
};

export const LINK_LABELS: Record<LinkStatus, string> = {
  issued: "Issued",
  used: "Used",
  signed: "Signed",
  expired: "Expired",
};

const ORDER_TRANSITIONS: Record<OrderAction, readonly OrderStatus[]> = {
  open: ["draft"],
  cancel: ["draft", "open", "filled"],
  fill: ["open"],
  place: ["filled"],
  issue_link: ["placed"],
  sign: ["placed"],
  settle: ["inspected"],
};

const DROP_TRANSITIONS: Record<DropAction, readonly DropStatus[]> = {
  deliver: ["committed"],
  mark_inspected: ["delivered"],
  accept: ["inspected"],
  dispute: ["inspected"],
  resolve: ["disputed"],
};

export function orderTransitionAllowed(action: OrderAction, status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[action].includes(status);
}

export function dropTransitionAllowed(action: DropAction, status: DropStatus): boolean {
  return DROP_TRANSITIONS[action].includes(status);
}

/** The status label the desk shows, including the queued-settlement state. */
export function orderStatusLabel(status: OrderStatus, settlementStatus: SettlementStatus): string {
  if (status === "inspected" && settlementStatus === "queued") return "Settlement queued";
  return ORDER_LABELS[status];
}
