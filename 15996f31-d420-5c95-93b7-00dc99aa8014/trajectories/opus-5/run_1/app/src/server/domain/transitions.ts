import type { DropStatus, InspectionLinkStatus, OrderStatus } from '../../shared/labels';

export type OrderAction = 'open' | 'cancel' | 'fill' | 'place' | 'issue_link' | 'sign' | 'settle';
export type DropAction = 'deliver' | 'sign' | 'accept' | 'dispute' | 'resolve';

const ORDER_TRANSITIONS: Record<OrderAction, { from: readonly OrderStatus[]; to: OrderStatus }> = {
  open: { from: ['draft'], to: 'open' },
  cancel: { from: ['draft', 'open', 'filled'], to: 'cancelled' },
  fill: { from: ['open'], to: 'filled' },
  place: { from: ['filled'], to: 'placed' },
  issue_link: { from: ['placed'], to: 'placed' },
  sign: { from: ['placed'], to: 'inspected' },
  settle: { from: ['inspected'], to: 'settled' },
};

const DROP_TRANSITIONS: Record<DropAction, { from: readonly DropStatus[]; to: DropStatus }> = {
  deliver: { from: ['committed'], to: 'delivered' },
  sign: { from: ['delivered'], to: 'inspected' },
  accept: { from: ['inspected'], to: 'accepted' },
  dispute: { from: ['inspected'], to: 'disputed' },
  resolve: { from: ['disputed'], to: 'accepted' },
};

export function nextOrderStatus(action: OrderAction, current: OrderStatus): OrderStatus | null {
  const transition = ORDER_TRANSITIONS[action];
  return transition.from.includes(current) ? transition.to : null;
}

export function nextDropStatus(action: DropAction, current: DropStatus): DropStatus | null {
  const transition = DROP_TRANSITIONS[action];
  return transition.from.includes(current) ? transition.to : null;
}

/** A truckload may be delivered only while its order is still taking hives. */
export function orderAcceptsDelivery(orderStatus: OrderStatus): boolean {
  return orderStatus === 'open' || orderStatus === 'filled';
}

export type InspectionLinkState = 'live' | 'signed' | 'expired';

export function inspectionLinkState(
  link: { status: InspectionLinkStatus; expiresAt: Date },
  now: Date,
): InspectionLinkState {
  if (link.status === 'signed') return 'signed';
  if (link.status === 'expired') return 'expired';
  return now.getTime() >= link.expiresAt.getTime() ? 'expired' : 'live';
}
