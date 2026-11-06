import type { BookingStatus } from '../../shared/types.js';

export type BookingAction =
  | 'pay'
  | 'cancel'
  | 'override_cancel'
  | 'cutoff'
  | 'check_in'
  | 'overrun'
  | 'check_out'
  | 'cleaning_fee'
  | 'settle';

export const ACTIVE_BOOKING_STATUSES: readonly BookingStatus[] = [
  'confirmed',
  'checked_in',
  'overrun_billed',
  'checked_out',
  'settled',
];

interface Rule {
  from: readonly BookingStatus[];
  to: BookingStatus | 'by_refund_tier';
}

/** The one booking state table. */
const RULES: Record<BookingAction, Rule> = {
  pay: { from: ['confirmed'], to: 'confirmed' },
  cancel: { from: ['confirmed'], to: 'by_refund_tier' },
  override_cancel: { from: ['confirmed'], to: 'cancelled_refunded' },
  cutoff: { from: ['confirmed'], to: 'unpaid_cancelled' },
  check_in: { from: ['confirmed'], to: 'checked_in' },
  overrun: { from: ['checked_in'], to: 'overrun_billed' },
  check_out: { from: ['checked_in', 'overrun_billed'], to: 'checked_out' },
  cleaning_fee: { from: ['checked_out'], to: 'checked_out' },
  settle: { from: ['checked_out'], to: 'settled' },
};

export function allowsAction(status: BookingStatus, action: BookingAction): boolean {
  return RULES[action].from.includes(status);
}

export function statusAfter(action: Exclude<BookingAction, 'cancel'>): BookingStatus {
  const target = RULES[action].to;
  if (target === 'by_refund_tier') throw new Error(`${action} needs a refund tier`);
  return target;
}

export function statusAfterCancel(tier: 'full' | 'none'): BookingStatus {
  return tier === 'full' ? 'cancelled_refunded' : 'cancelled_forfeit';
}
