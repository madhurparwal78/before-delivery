const ORDER_STATUSES = ['placed', 'picking', 'ready', 'collected', 'cancelled'] as const;
const RETURN_STATUSES = ['requested', 'received', 'settled', 'declined'] as const;
const HOLD_STATUSES = ['active', 'released', 'converted'] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type ReturnStatus = (typeof RETURN_STATUSES)[number];
export type HoldStatus = (typeof HOLD_STATUSES)[number];

const ORDER_MOVES: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  placed: ['picking', 'cancelled'],
  picking: ['ready', 'cancelled'],
  ready: ['collected', 'cancelled'],
  collected: [],
  cancelled: [],
};

const RETURN_MOVES: Readonly<Record<ReturnStatus, readonly ReturnStatus[]>> = {
  requested: ['received', 'declined'],
  received: ['settled'],
  settled: [],
  declined: [],
};

export function canMoveOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_MOVES[from].includes(to);
}

export function canMoveReturn(from: ReturnStatus, to: ReturnStatus): boolean {
  return RETURN_MOVES[from].includes(to);
}

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value);
}

export function isReturnStatus(value: unknown): value is ReturnStatus {
  return typeof value === 'string' && (RETURN_STATUSES as readonly string[]).includes(value);
}

export const ORDER_EVENT_OF_STATUS: Readonly<Record<OrderStatus, string>> = {
  placed: 'order.placed',
  picking: 'order.picking',
  ready: 'order.ready',
  collected: 'order.collected',
  cancelled: 'order.cancelled',
};

export const RETURN_EVENT_OF_STATUS: Readonly<Record<ReturnStatus, string>> = {
  requested: 'return.requested',
  received: 'return.received',
  settled: 'return.settled',
  declined: 'return.declined',
};
