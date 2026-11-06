export type EnrolmentState = 'held' | 'confirmed' | 'completed' | 'certified' | 'refunded' | 'withdrawn';

/** The states that hold a cohort seat and block a second enrolment in the same course. */
export const ACTIVE_ENROLMENT_STATES: readonly EnrolmentState[] = [
  'held',
  'confirmed',
  'completed',
  'certified',
];

export function isInactiveForStudy(state: EnrolmentState): boolean {
  return state === 'held' || state === 'refunded' || state === 'withdrawn';
}

export function hasFinishedActivity(state: EnrolmentState): boolean {
  return state === 'completed' || state === 'certified';
}
