export type OrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'picking'
  | 'packed'
  | 'shipped'
  | 'refunded';

export type FulfilmentTarget = 'picking' | 'packed' | 'shipped';

export type RefundStatus = 'none' | 'partially_refunded' | 'refunded';

const FULFILMENT_MOVES: Readonly<Record<FulfilmentTarget, readonly OrderStatus[]>> = {
  picking: ['paid'],
  packed: ['picking'],
  shipped: ['packed'],
};

/** The one decision on whether fulfilment staff may move an order's status. */
export function canFulfilmentMove(from: OrderStatus, to: FulfilmentTarget): boolean {
  return FULFILMENT_MOVES[to].includes(from);
}

/** Statuses a full refund may turn into `refunded`. */
const REFUNDABLE_STATUSES: readonly OrderStatus[] = ['paid', 'picking', 'packed', 'shipped'];

export function canRefund(status: OrderStatus): boolean {
  return REFUNDABLE_STATUSES.includes(status);
}

/** A full refund restocks the cans only while the order has not shipped. */
export function restocksOnFullRefund(status: OrderStatus): boolean {
  return status === 'paid' || status === 'picking' || status === 'packed';
}

