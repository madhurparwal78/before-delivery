// The order state machine: the one place that decides which moves are legal.
import { ApiError } from "./http.ts";
import type { OrderRow, OrderStatus } from "./records.ts";

type OrderMove = "restrict" | "schedule" | "ration" | "cancel" | "close" | "lapse" | "startConfirmed" | "finishConfirmed" | "reopen";

const MOVES: Record<OrderMove, { from: readonly OrderStatus[]; to: OrderStatus }> = {
  restrict: { from: ["scheduled"], to: "requested" },
  schedule: { from: ["requested"], to: "scheduled" },
  ration: { from: ["requested"], to: "scheduled" },
  cancel: { from: ["requested", "scheduled"], to: "closed" },
  close: { from: ["requested", "scheduled", "running"], to: "closed" },
  lapse: { from: ["requested", "scheduled"], to: "closed" },
  startConfirmed: { from: ["scheduled"], to: "running" },
  finishConfirmed: { from: ["running"], to: "delivered" },
  reopen: { from: ["closed"], to: "running" },
};

export function canMove(move: OrderMove, from: OrderStatus): boolean {
  return MOVES[move].from.includes(from);
}

/** The status after `move`, or 409 `illegal_transition`. */
export function nextStatus(move: OrderMove, from: OrderStatus): OrderStatus {
  if (!canMove(move, from)) {
    throw new ApiError(409, "illegal_transition", "That change is not allowed for this order now.");
  }
  return MOVES[move].to;
}

/** An order counts against its window and allocation while scheduled, running, delivered or closed after flow. */
export function counts(order: Pick<OrderRow, "status" | "closed_after_flow">): boolean {
  return order.status === "scheduled" || order.status === "running" || order.status === "delivered" || order.closed_after_flow;
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  requested: "Requested",
  scheduled: "Scheduled",
  running: "Running",
  delivered: "Delivered",
  closed: "Closed",
};
