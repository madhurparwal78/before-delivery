import type { CycleStatus } from '../../shared/types.ts';

/** Cycle transitions, their guards and the cutoff switch: the one place a cycle's state is decided. */

const COORDINATOR_MOVES: Record<string, CycleStatus[]> = {
  draft: ['open'],
  sealing: ['ordered'],
  ordered: ['received'],
  received: ['breakdown'],
  breakdown: ['closed'],
  closing: ['closed'],
};

export function isLegalTransition(from: CycleStatus, to: CycleStatus): boolean {
  return (COORDINATOR_MOVES[from] ?? []).includes(to);
}

/** An open cycle whose cutoff has passed is sealing on every read and write path. */
export function effectiveStatus(
  storedStatus: CycleStatus,
  cutoffAtMs: number | null,
  nowMs: number,
): CycleStatus {
  if (storedStatus === 'open' && cutoffAtMs !== null && nowMs >= cutoffAtMs) return 'sealing';
  return storedStatus;
}

export function acceptingPledges(
  storedStatus: CycleStatus,
  cutoffAtMs: number | null,
  nowMs: number,
): boolean {
  return effectiveStatus(storedStatus, cutoffAtMs, nowMs) === 'open';
}

export function uploadsAllowed(status: CycleStatus): boolean {
  return status === 'ordered' || status === 'received' || status === 'breakdown' || status === 'closing';
}

export function shortsAllowed(status: CycleStatus): boolean {
  return status === 'received' || status === 'breakdown';
}
