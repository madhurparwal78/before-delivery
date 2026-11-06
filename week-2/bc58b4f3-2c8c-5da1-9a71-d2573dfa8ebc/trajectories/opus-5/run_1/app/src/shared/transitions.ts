import type { AssignmentStatus, SeatStatus } from './contract.js';

export const RELEASABLE_FROM: readonly AssignmentStatus[] = ['draft'];
export const CLAIMABLE_FROM: readonly AssignmentStatus[] = ['released', 'partially_covered'];
export const GIVE_BACK_FROM: readonly AssignmentStatus[] = ['partially_covered', 'covered'];
export const TIME_CHANGE_FROM: readonly AssignmentStatus[] = [
  'draft',
  'released',
  'partially_covered',
  'covered',
];
export const VERIFIABLE_FROM: readonly AssignmentStatus[] = ['covered', 'served'];
export const CANCELLABLE_FROM: readonly AssignmentStatus[] = [
  'draft',
  'released',
  'partially_covered',
  'covered',
];
export const OFFER_VISIBLE_STATUSES: readonly AssignmentStatus[] = [
  'released',
  'partially_covered',
  'covered',
];
export const UNCOVERED_COUNTING_STATUSES: readonly AssignmentStatus[] = [
  'draft',
  'released',
  'partially_covered',
];

/** The coverage status a released assignment takes from the state of its seats. */
export function statusFromSeats(seatStatuses: readonly SeatStatus[]): AssignmentStatus {
  if (seatStatuses.every((status) => status === 'served')) {
    return 'verified';
  }
  if (seatStatuses.some((status) => status === 'served')) {
    return 'served';
  }
  if (!seatStatuses.includes('open')) {
    return 'covered';
  }
  return seatStatuses.includes('held') ? 'partially_covered' : 'released';
}
