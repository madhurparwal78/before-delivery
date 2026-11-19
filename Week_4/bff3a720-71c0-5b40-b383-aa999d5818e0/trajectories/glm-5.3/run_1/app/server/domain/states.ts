/** Booking states and their legal moves — one place for the whole app. */

export type BookingState =
  | 'held'
  | 'requested'
  | 'confirmed'
  | 'completed'
  | 'rated'
  | 'expired'
  | 'declined'
  | 'withdrawn'
  | 'cancelled_by_passenger'
  | 'cancelled_by_driver';

export type RideState = 'published' | 'changed' | 'departed' | 'arrived' | 'cancelled';

export interface TransitionResult { to: BookingState | null }

/** Every move the API may ask for, mapped to its outcome. */
export function bookingTransition(from: BookingState, action: BookingAction): TransitionResult {
  const table: Record<BookingState, Partial<Record<BookingAction, BookingState>>> = {
    held: { confirm: 'confirmed', release: 'expired', confirm_late: 'expired' },
    requested: { accept: 'confirmed', decline: 'declined', withdraw: 'withdrawn', expire: 'expired' },
    confirmed: { cancel_by_passenger: 'cancelled_by_passenger', cancel_by_driver: 'cancelled_by_driver', complete: 'completed' },
    completed: { reveal: 'rated' },
    rated: {},
    expired: {},
    declined: {},
    withdrawn: {},
    cancelled_by_passenger: {},
    cancelled_by_driver: {},
  };
  return { to: table[from][action] ?? null };
}

export type BookingAction =
  | 'confirm'
  | 'confirm_late'
  | 'release'
  | 'accept'
  | 'decline'
  | 'withdraw'
  | 'expire'
  | 'cancel_by_passenger'
  | 'cancel_by_driver'
  | 'complete'
  | 'reveal';

export const ACTIVE_HOLD_STATES: ReadonlySet<BookingState> = new Set(['held', 'requested']);
export const SEAT_HOLDING_STATES: ReadonlySet<BookingState> = new Set(['held', 'requested', 'confirmed']);
export const ALL_BOOKING_STATES: BookingState[] = [
  'held', 'requested', 'confirmed', 'completed', 'rated',
  'expired', 'declined', 'withdrawn', 'cancelled_by_passenger', 'cancelled_by_driver',
];
