import * as copy from '../../shared/copy';
import type { FeeStatus, HoldStatus, ItemStatus, LoanStatus, PartState } from '../../shared/types';

/** The one place that judges each loan, hold, fee and membership transition. */

export function checkoutConflict(status: LoanStatus): string | null {
  return status === 'reserved' ? null : copy.ALREADY_CHECKED_OUT;
}

export function cancelLoanConflict(status: LoanStatus): string | null {
  return status === 'reserved' ? null : copy.ONLY_RESERVED_CANCELS;
}

export function checkinConflict(status: LoanStatus): string | null {
  switch (status) {
    case 'reserved':
      return copy.NOT_CHECKED_OUT;
    case 'pending-photo':
      return copy.WAITING_FOR_PHOTO;
    case 'out':
      return null;
    default:
      return copy.ALREADY_CHECKED_IN;
  }
}

export const takeDownConflict = checkinConflict;

export function hangConflict(
  status: LoanStatus,
  partState: PartState,
  partName: string,
): string | null {
  switch (status) {
    case 'reserved':
      return copy.NOT_CHECKED_OUT;
    case 'pending-photo':
      return copy.WAITING_FOR_PHOTO;
    default:
      return partState === 'hung' ? copy.partAlreadyHung(partName) : null;
  }
}

export function finishConflict(status: LoanStatus): string | null {
  return status === 'pending-photo' ? null : copy.NOT_WAITING_FOR_PHOTO;
}

export function placeHoldConflict(
  memberIsActive: boolean,
  itemStatus: ItemStatus,
  memberAlreadyHolds: boolean,
): string | null {
  if (!memberIsActive) return copy.MEMBERSHIP_NOT_ACTIVE_HOLD;
  if (itemStatus === 'on-wall') return copy.TOOL_ON_WALL;
  if (memberAlreadyHolds) return copy.ALREADY_HOLDING;
  return null;
}

export function cancelHoldConflict(status: HoldStatus): string | null {
  return status === 'queued' || status === 'ready' ? null : copy.HOLD_NO_LONGER_ACTIVE;
}

/** Which tools a member may be lent, in the published message order. */
export function reserveItemConflict(
  tag: string,
  itemStatus: ItemStatus,
  heldForThisMember: boolean,
): string | null {
  if (itemStatus === 'on-wall') return null;
  if (itemStatus === 'held') {
    return heldForThisMember ? null : copy.tagHeldForAnother(tag);
  }
  if (itemStatus === 'incomplete') return copy.tagMissingParts(tag);
  return copy.tagNotOnWall(tag);
}

export function feeWriteConflict(status: FeeStatus): string | null {
  if (status === 'settled') return copy.FEE_ALREADY_SETTLED;
  if (status === 'waived-by-coordinator') return copy.FEE_ALREADY_WAIVED;
  return null;
}

export function waiverRequestConflict(
  status: FeeStatus,
  waiverStatus: 'requested' | 'approved' | 'declined' | null,
): string | null {
  const feeConflict = feeWriteConflict(status);
  if (feeConflict) return feeConflict;
  return waiverStatus === 'requested' ? copy.WAIVER_ALREADY_WAITING : null;
}

export function waiverDecisionConflict(
  status: FeeStatus,
  waiverStatus: 'requested' | 'approved' | 'declined' | null,
): string | null {
  const feeConflict = feeWriteConflict(status);
  if (feeConflict) return feeConflict;
  return waiverStatus === 'requested' ? null : copy.NO_WAIVER_TO_DECIDE;
}

export function cancelMembershipConflict(
  status: 'pending-payment' | 'active' | 'lapsed',
  endsAtTerm: boolean,
): string | null {
  if (status !== 'active') return copy.ONLY_ACTIVE_CANCELS;
  return endsAtTerm ? copy.ALREADY_ENDING : null;
}
