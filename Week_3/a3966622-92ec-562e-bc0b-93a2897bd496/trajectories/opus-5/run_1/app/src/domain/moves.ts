export const MOVE_STATUSES = [
  'Ordered',
  'Window committed',
  'Pilot assigned',
  'Pilot away',
  'On board',
  'Completed',
  'Invoiced',
  'Cancelled',
  'Cancelled late',
  'Refused at ladder',
] as const;

export type MoveStatus = (typeof MOVE_STATUSES)[number];

export type PilotTransition = 'Pilot away' | 'On board' | 'Completed';

const PILOT_CHAIN: Record<PilotTransition, MoveStatus> = {
  'Pilot away': 'Pilot assigned',
  'On board': 'Pilot away',
  Completed: 'On board',
};

/** Commit is allowed from Ordered, and a re-commit in Window committed. */
export function commitAllowed(status: MoveStatus): boolean {
  return status === 'Ordered' || status === 'Window committed';
}

export function assignmentAllowed(status: MoveStatus): boolean {
  return status === 'Window committed';
}

export function pilotTransitionAllowed(status: MoveStatus, to: PilotTransition): boolean {
  return PILOT_CHAIN[to] === status;
}

export function amendmentAllowed(status: MoveStatus): boolean {
  return status === 'Ordered' || status === 'Window committed' || status === 'Pilot assigned';
}

export function cancellationAllowed(status: MoveStatus): boolean {
  return (
    status === 'Ordered' ||
    status === 'Window committed' ||
    status === 'Pilot assigned' ||
    status === 'Pilot away'
  );
}

export function ladderReportAllowed(status: MoveStatus): boolean {
  return status === 'Pilot away' || status === 'On board';
}

export function refusalAllowed(status: MoveStatus): boolean {
  return status === 'Pilot away';
}

export function reorderAllowed(status: MoveStatus): boolean {
  return status === 'Refused at ladder';
}

export function detentionAllowed(status: MoveStatus): boolean {
  return status === 'On board';
}

export function invoicingAllowed(status: MoveStatus): boolean {
  return status === 'Completed';
}

/** Statuses that hold a committed window, so an amendment or tide revision re-checks the plan. */
export function holdsCommittedWindow(status: MoveStatus): boolean {
  return status === 'Window committed' || status === 'Pilot assigned';
}
