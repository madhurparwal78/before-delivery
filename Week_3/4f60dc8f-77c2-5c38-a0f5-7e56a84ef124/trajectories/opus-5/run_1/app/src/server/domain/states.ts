import type { EngagementState, ReviewMilestone } from '../../shared/domain.js';
import type { ErrorCode } from '../../shared/errors.js';

export type EngagementPhase = {
  state: EngagementState;
  finalsOut: boolean;
  revisionMilestone: ReviewMilestone | null;
};

export type Transition = { to: EngagementPhase } | { error: ErrorCode };

const phase = (
  state: EngagementState,
  finalsOut = false,
  revisionMilestone: ReviewMilestone | null = null,
): EngagementPhase => ({ state, finalsOut, revisionMilestone });

/** The milestone a review link or reviewer action applies to in a given phase. */
export const activeMilestone = (current: EngagementPhase): ReviewMilestone | null => {
  switch (current.state) {
    case 'look_dev_review':
      return 'look_dev';
    case 'revision_requested':
      return current.revisionMilestone;
    case 'final_review':
      return current.finalsOut ? 'final_delivery' : 'look_dev';
    case 'delivered':
      return 'final_delivery';
    default:
      return null;
  }
};

export const reviewerActionsOpen = (current: EngagementPhase): boolean =>
  current.state === 'look_dev_review' || (current.state === 'final_review' && current.finalsOut);

export const depositTransition = (current: EngagementPhase): Transition =>
  current.state === 'quoted' ? { to: phase('deposit_paid') } : { error: 'invalid_state' };

/** The milestone whose stills must exist before the founder may send for review. */
export const sendForReviewMilestone = (current: EngagementPhase): ReviewMilestone | null => {
  switch (current.state) {
    case 'deposit_paid':
      return 'look_dev';
    case 'look_dev_review':
      return 'look_dev';
    case 'revision_requested':
      return current.revisionMilestone;
    case 'final_review':
      return 'final_delivery';
    default:
      return null;
  }
};

export const sendForReviewTransition = (current: EngagementPhase): Transition => {
  switch (current.state) {
    case 'deposit_paid':
    case 'look_dev_review':
      return { to: phase('look_dev_review') };
    case 'revision_requested':
      return current.revisionMilestone === 'look_dev'
        ? { to: phase('look_dev_review') }
        : { to: phase('final_review', true) };
    case 'final_review':
      return { to: phase('final_review', true) };
    default:
      return { error: 'invalid_state' };
  }
};

export const regenerateAllowed = (current: EngagementPhase): Transition =>
  current.state === 'look_dev_review' ||
  current.state === 'revision_requested' ||
  (current.state === 'final_review' && current.finalsOut)
    ? { to: current }
    : { error: 'invalid_state' };

export const reviewerAcceptTransition = (current: EngagementPhase): Transition => {
  if (current.state === 'look_dev_review') return { to: phase('final_review') };
  if (current.state === 'final_review')
    return current.finalsOut ? { to: phase('delivered') } : { error: 'finals_not_ready' };
  return { error: 'invalid_state' };
};

export const reviewerRevisionTransition = (current: EngagementPhase): Transition => {
  if (current.state === 'look_dev_review')
    return { to: phase('revision_requested', false, 'look_dev') };
  if (current.state === 'final_review')
    return current.finalsOut
      ? { to: phase('revision_requested', true, 'final_delivery') }
      : { error: 'finals_not_ready' };
  return { error: 'invalid_state' };
};

const CANCELLABLE: readonly EngagementState[] = [
  'deposit_paid',
  'look_dev_review',
  'revision_requested',
  'final_review',
];

export const cancelTransition = (current: EngagementPhase): Transition =>
  CANCELLABLE.includes(current.state)
    ? { to: phase('cancelled_with_refund') }
    : { error: 'invalid_state' };

/** Founder still posts are allowed only in these phases. */
export const stillPostAllowed = (current: EngagementPhase): boolean =>
  current.state === 'deposit_paid' ||
  current.state === 'look_dev_review' ||
  current.state === 'revision_requested' ||
  current.state === 'final_review';

/** Quote, unit and model changes are only open while the engagement is quoted. */
export const quoteOpen = (current: EngagementPhase): boolean => current.state === 'quoted';
