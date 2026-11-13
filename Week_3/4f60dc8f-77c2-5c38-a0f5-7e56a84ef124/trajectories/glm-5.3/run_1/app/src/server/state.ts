import type { EngagementState, Milestone } from './types';
import { ApiError } from './errors';

/**
 * The engagement state machine. Each transition and its guard is decided
 * here alone. See the state table in the brief.
 */

export function canSendForReview(state: EngagementState): boolean {
  return state === 'deposit_paid' || state === 'revision_requested';
}

export function canAcceptReview(state: EngagementState, finalsOut: boolean): boolean {
  return state === 'look_dev_review' || (state === 'final_review' && finalsOut);
}

export function canRequestRevision(state: EngagementState, finalsOut: boolean): boolean {
  return state === 'look_dev_review' || (state === 'final_review' && finalsOut);
}

export function reviewerActionMilestone(state: EngagementState, finalsOut: boolean): Milestone | null {
  if (state === 'look_dev_review') {
    return 'look_dev';
  }
  if (state === 'final_review' && finalsOut) {
    return 'final_delivery';
  }
  return null;
}

export function canCancel(state: EngagementState): boolean {
  return state === 'deposit_paid' || state === 'look_dev_review' || state === 'revision_requested' || state === 'final_review';
}

export function canPostStills(state: EngagementState): boolean {
  return state === 'deposit_paid' || state === 'look_dev_review' || state === 'revision_requested' || state === 'final_review';
}

export function canRegenerateLink(state: EngagementState, finalsOut: boolean): boolean {
  return state === 'look_dev_review'
    || state === 'revision_requested'
    || (state === 'final_review' && finalsOut);
}

export function reviewMilestoneFor(state: EngagementState, finalsOut: boolean, lastMilestone: Milestone): Milestone {
  if (state === 'revision_requested') {
    return lastMilestone;
  }
  if (state === 'look_dev_review') {
    return 'look_dev';
  }
  if (state === 'final_review' && finalsOut) {
    return 'final_delivery';
  }
  return lastMilestone;
}

/** A reviewer action judged in final_review before finals are out. */
export function reviewerPreconditions(state: EngagementState, finalsOut: boolean): ApiError | null {
  if (state === 'final_review' && !finalsOut) {
    return new ApiError('finals_not_ready');
  }
  if (state === 'quoted' || state === 'deposit_paid') {
    return new ApiError('finals_not_ready');
  }
  if (state === 'delivered' || state === 'cancelled_with_refund') {
    return new ApiError('invalid_state');
  }
  if (canAcceptReview(state, finalsOut) || canRequestRevision(state, finalsOut)) {
    return null;
  }
  return new ApiError('finals_not_ready');
}

export function acceptTarget(state: EngagementState): EngagementState | null {
  if (state === 'look_dev_review') {
    return 'final_review';
  }
  if (state === 'final_review') {
    return 'delivered';
  }
  return null;
}

export function draftMilestoneOnAccept(state: EngagementState): Milestone | null {
  if (state === 'look_dev_review') {
    return 'look_dev';
  }
  if (state === 'final_review') {
    return 'final_delivery';
  }
  return null;
}
