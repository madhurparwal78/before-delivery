export type ReservationState =
  | 'held'
  | 'deposit_paid'
  | 'paid_in_full'
  | 'checked_in_day1'
  | 'checked_in_day2'
  | 'certificate_issued'
  | 'released'
  | 'cancelled'
  | 'refunded';

export type PaymentKind = 'deposit' | 'balance' | 'full' | 'upgrade' | 'group';

/** Active states past `held`: these benches count as sold in the ledger. */
export const SOLD_STATES: readonly ReservationState[] = [
  'deposit_paid',
  'paid_in_full',
  'checked_in_day1',
  'checked_in_day2',
  'certificate_issued',
];

/** States in which a seat may be assigned to a colleague. */
export const ASSIGNABLE_STATES: readonly ReservationState[] = ['deposit_paid', 'paid_in_full'];

const TRANSITIONS: Record<ReservationState, readonly ReservationState[]> = {
  held: ['deposit_paid', 'paid_in_full', 'released'],
  deposit_paid: ['paid_in_full', 'cancelled'],
  paid_in_full: ['checked_in_day1', 'cancelled'],
  checked_in_day1: ['checked_in_day2'],
  checked_in_day2: ['certificate_issued'],
  certificate_issued: [],
  released: [],
  cancelled: ['refunded'],
  refunded: [],
};

export function canTransition(from: ReservationState, to: ReservationState): boolean {
  return TRANSITIONS[from].includes(to);
}
