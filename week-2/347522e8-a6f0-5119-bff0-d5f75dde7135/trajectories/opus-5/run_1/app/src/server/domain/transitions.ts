/** The legal state transitions for bookings, documents and renters. */

import type { BookingStatus, DocumentStatus, RenterStatus } from '../../shared/types.js';

const BOOKING_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  hold: ['confirmed', 'expired', 'displaced'],
  confirmed: ['displaced', 'cancelled', 'checked_in'],
  checked_in: ['completed'],
  expired: [],
  displaced: [],
  cancelled: [],
  completed: [],
};

export function canBookingMove(from: BookingStatus, to: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[from].includes(to);
}

export function canDocumentMove(from: DocumentStatus, to: DocumentStatus): boolean {
  return from === 'pending_review' && (to === 'approved' || to === 'rejected');
}

export const RENTER_STATUSES: RenterStatus[] = [
  'applied',
  'documents_review',
  'active',
  'suspended',
  'offboarded',
];

export function isRenterStatus(value: unknown): value is RenterStatus {
  return typeof value === 'string' && (RENTER_STATUSES as string[]).includes(value);
}

/**
 * The transitions the operator may request. Reinstatement and suspension also
 * happen automatically, which `canRenterMove` covers for the scan and reviews.
 */
export function canRenterMove(from: RenterStatus, to: RenterStatus): boolean {
  if (to === 'offboarded') return from !== 'offboarded';
  if (to === 'active') return from === 'documents_review' || from === 'suspended';
  if (to === 'suspended') return from === 'active';
  if (to === 'documents_review') return from === 'applied';
  return false;
}

/** Only the operator's endpoint is this narrow: it never moves a renter backwards. */
export function canOperatorRequestRenterMove(from: RenterStatus, to: RenterStatus): boolean {
  if (to !== 'active' && to !== 'offboarded') return false;
  return canRenterMove(from, to);
}
