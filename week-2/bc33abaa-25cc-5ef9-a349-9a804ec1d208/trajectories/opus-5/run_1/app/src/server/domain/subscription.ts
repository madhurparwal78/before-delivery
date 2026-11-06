import { SubscriptionState } from '../../shared/api';
import { fail } from '../http/errors';
import { SubscriptionRow } from './workspace';

const LEGAL_TRANSITIONS: Record<SubscriptionState, SubscriptionState[]> = {
  trial: ['active', 'suspended', 'cancelled'],
  active: ['past_due', 'cancelled'],
  past_due: ['active', 'suspended', 'cancelled'],
  suspended: ['active', 'cancelled'],
  cancelled: [],
};

export function assertSubscriptionTransition(from: SubscriptionState, to: SubscriptionState): void {
  if (!LEGAL_TRANSITIONS[from].includes(to)) {
    throw fail.conflict('invalid_transition', { from, to });
  }
}

/** Checkout only starts a plan from the trial or from a trial-end suspension. */
export function assertCheckoutAllowed(subscription: SubscriptionRow): void {
  const fromTrial = subscription.state === 'trial';
  const fromTrialSuspension =
    subscription.state === 'suspended' && subscription.suspended_reason === 'trial_ended';
  if (!fromTrial && !fromTrialSuspension) {
    throw fail.conflict('invalid_transition', { from: subscription.state, to: 'active' });
  }
}

export function assertActive(subscription: SubscriptionRow): void {
  if (subscription.state !== 'active') throw fail.conflict('subscription_not_active');
}
