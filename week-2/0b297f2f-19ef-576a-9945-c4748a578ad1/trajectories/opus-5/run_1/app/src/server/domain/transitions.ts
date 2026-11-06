import type { Placement, PlacementStatus, Role, Staff } from '../../shared/types';
import { errors } from '../http/errors';

/** The placement lifecycle, in one place. */
const legalTransitions: Record<PlacementStatus, PlacementStatus[]> = {
  proposed: ['claimed', 'removed'],
  claimed: ['proposed', 'hung'],
  hung: ['signed_off'],
  signed_off: [],
  removed: ['proposed'],
};

export function isLegalTransition(from: PlacementStatus, to: PlacementStatus): boolean {
  return legalTransitions[from].includes(to);
}

export function assertTransition(from: PlacementStatus, to: PlacementStatus): void {
  if (!isLegalTransition(from, to)) {
    throw errors.conflict('illegal_transition', 'That change is not allowed in this state.');
  }
}

export function assertRole(staff: Staff, role: Role): void {
  if (staff.role !== role) throw errors.forbidden();
}

const lockedStatuses: PlacementStatus[] = ['hung', 'signed_off', 'removed'];

/** Who may move a placement, and the locked-placement conflict that comes before those checks. */
export function assertMayMove(
  staff: Staff,
  placement: Placement,
  requestedWallId: string | undefined,
): void {
  if (staff.role === 'registrar') throw errors.forbidden();
  if (lockedStatuses.includes(placement.status)) {
    throw errors.conflict('placement_locked', 'That work can no longer be moved.');
  }
  if (placement.status === 'proposed') {
    if (staff.role !== 'curator') throw errors.forbidden();
  } else if (staff.role !== 'preparator' || placement.claimedBy?.id !== staff.id) {
    throw errors.forbidden();
  }
  if (
    staff.role === 'preparator' &&
    requestedWallId !== undefined &&
    requestedWallId !== placement.wallId
  ) {
    throw errors.forbidden();
  }
}
