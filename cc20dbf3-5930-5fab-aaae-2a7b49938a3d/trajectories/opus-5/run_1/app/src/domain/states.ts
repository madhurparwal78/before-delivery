/** Hold and loan states, and the one place each legal move is decided. */

export type HoldStatus = 'requested' | 'ready' | 'collected' | 'expired' | 'cancelled';
export type StoredLoanStatus = 'out' | 'returned' | 'inspected' | 'settled';
export type LoanStatus = StoredLoanStatus | 'overdue';

export const HOLD_STATUS_WORDS: Record<HoldStatus, string> = {
  requested: 'Requested',
  ready: 'Ready',
  collected: 'Collected',
  expired: 'Expired',
  cancelled: 'Cancelled',
};

export const LOAN_STATUS_WORDS: Record<LoanStatus, string> = {
  out: 'Out',
  overdue: 'Overdue',
  returned: 'Returned',
  inspected: 'Inspected',
  settled: 'Settled',
};

/** A ready hold counts as expired at or after its pickup deadline, in every response. */
export function effectiveHoldStatus(
  stored: HoldStatus,
  pickupDeadline: Date | null,
  now: Date,
): HoldStatus {
  if (stored === 'ready' && pickupDeadline !== null && now.getTime() >= pickupDeadline.getTime()) {
    return 'expired';
  }
  return stored;
}

/** A hold occupies its unit while it is requested, or ready and still collectable. */
export function holdIsActive(status: HoldStatus): boolean {
  return status === 'requested' || status === 'ready';
}

/** A loan is overdue whenever now is strictly after its due instant and it is still out. */
export function effectiveLoanStatus(stored: StoredLoanStatus, dueAt: Date, now: Date): LoanStatus {
  if (stored === 'out' && now.getTime() > dueAt.getTime()) return 'overdue';
  return stored;
}

export function loanIsActive(status: LoanStatus): boolean {
  return status === 'out' || status === 'overdue';
}

export function canMarkReady(status: HoldStatus): boolean {
  return status === 'requested';
}

export function canCancelHold(status: HoldStatus): boolean {
  return status === 'requested' || status === 'ready';
}

export function canCheckOutHold(status: HoldStatus): boolean {
  return status === 'ready';
}

export function canRenew(status: LoanStatus): boolean {
  return status === 'out';
}

export function canReturn(status: LoanStatus): boolean {
  return status === 'out' || status === 'overdue';
}

export function canInspect(status: LoanStatus): boolean {
  return status === 'returned';
}

export function canSettle(status: LoanStatus): boolean {
  return status === 'inspected';
}

/** The stage the server assigns to a photo, from the loan's state right now. */
export function photoStageFor(status: LoanStatus): 'checkout' | 'return' | null {
  if (status === 'out' || status === 'overdue') return 'checkout';
  if (status === 'returned') return 'return';
  return null;
}
