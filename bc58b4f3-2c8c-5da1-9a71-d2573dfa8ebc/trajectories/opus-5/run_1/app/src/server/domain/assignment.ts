import type { AssignmentRecord, AssignmentStatus, SeatRecord } from './types.js';

/** Team seats: ASL longer than 60 minutes needs two interpreters. */
export function seatCountFor(languageCode: string, durationMinutes: number): number {
  return languageCode === 'asl' && durationMinutes > 60 ? 2 : 1;
}

/** The coverage status implied by the current seat statuses. */
export function coverageStatus(seats: readonly Pick<SeatRecord, 'status'>[]): AssignmentStatus {
  const open = seats.filter((seat) => seat.status === 'open').length;
  if (open === seats.length) return 'released';
  if (open === 0) return 'covered';
  return 'partially_covered';
}

export function canRelease(status: AssignmentStatus): boolean {
  return status === 'draft';
}

export function canClaim(status: AssignmentStatus): boolean {
  return status === 'released' || status === 'partially_covered';
}

export function canGiveBack(status: AssignmentStatus): boolean {
  return status === 'partially_covered' || status === 'covered';
}

export function canChangeTime(status: AssignmentStatus): boolean {
  return (
    status === 'draft' ||
    status === 'released' ||
    status === 'partially_covered' ||
    status === 'covered'
  );
}

export function canCancel(status: AssignmentStatus): boolean {
  return canChangeTime(status);
}

export function canVerify(status: AssignmentStatus): boolean {
  return status === 'covered' || status === 'served';
}

/** The status an assignment reaches once a seat has been verified. */
export function statusAfterVerification(seats: readonly Pick<SeatRecord, 'status'>[]): AssignmentStatus {
  return seats.every((seat) => seat.status === 'served') ? 'verified' : 'served';
}

/** An interpreter may see an assignment as an offer in these statuses. */
export function isOfferable(status: AssignmentStatus): boolean {
  return status === 'released' || status === 'partially_covered' || status === 'covered';
}

export function endOf(assignment: Pick<AssignmentRecord, 'startAt' | 'durationMinutes'>): Date {
  return new Date(assignment.startAt.getTime() + assignment.durationMinutes * 60000);
}

/** Uncovered minutes: open-seat minutes of assignments still waiting for cover. */
export function uncoveredMinutes(assignments: readonly AssignmentRecord[]): number {
  let total = 0;
  for (const assignment of assignments) {
    if (
      assignment.status !== 'draft' &&
      assignment.status !== 'released' &&
      assignment.status !== 'partially_covered'
    ) {
      continue;
    }
    const open = assignment.seats.filter((seat) => seat.status === 'open').length;
    total += assignment.durationMinutes * open;
  }
  return total;
}
