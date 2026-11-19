// The legal moves of orders, returns and holds, written once for the server's checks and the screens' row actions.

const ORDER_STATUSES = ["placed", "picking", "ready", "collected", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  placed: ["picking", "cancelled"],
  picking: ["ready", "cancelled"],
  ready: ["collected", "cancelled"],
  collected: [],
  cancelled: [],
};

const RETURN_STATUSES = ["requested", "received", "settled", "declined"] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

export const RETURN_TRANSITIONS: Record<ReturnStatus, ReturnStatus[]> = {
  requested: ["received", "declined"],
  received: ["settled"],
  settled: [],
  declined: [],
};

const HOLD_STATUSES = ["active", "released", "converted"] as const;
export type HoldStatus = (typeof HOLD_STATUSES)[number];

export const HOLD_TRANSITIONS: Record<HoldStatus, HoldStatus[]> = {
  active: ["released", "converted"],
  released: [],
  converted: [],
};

export function isOrderStatus(value: string): value is OrderStatus {
  return ORDER_STATUSES.some((status) => status === value);
}

export function isReturnStatus(value: string): value is ReturnStatus {
  return RETURN_STATUSES.some((status) => status === value);
}
