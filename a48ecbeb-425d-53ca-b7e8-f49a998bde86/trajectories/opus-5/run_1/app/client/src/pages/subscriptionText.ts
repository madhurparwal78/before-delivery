import { dunningBannerCopy, subscriptionCopy } from '../../../shared/copy.js';
import { formatLongDate, formatLongDateAndTime } from '../../../shared/time.js';
import type { SubscriptionPayload } from '../api.js';

/** The one published state text for a subscription. */
export function subscriptionStateText(subscription: SubscriptionPayload): string {
  const { state } = subscription;
  if (state === 'cancelled') return subscriptionCopy.state.cancelled;
  if (state === 'cancel_pending') {
    return subscriptionCopy.state.endsOn(
      formatLongDate(subscription.billing_end_date ?? ''),
    );
  }
  if (state === 'past_due') return subscriptionCopy.state.pastDue;
  if (state === 'paused') {
    return subscriptionCopy.state.paused(formatLongDate(subscription.pause?.resumes_on ?? ''));
  }
  if (subscription.pause !== null) {
    return subscriptionCopy.state.pauseScheduled(
      formatLongDate(subscription.pause.from),
      formatLongDate(subscription.pause.resumes_on),
    );
  }
  if (subscription.skip !== null) return subscriptionCopy.state.skipped;
  return subscriptionCopy.state.active;
}

/** The published dunning banner for the subscriber's dunning stage. */
export function dunningBannerText(subscription: SubscriptionPayload): string | null {
  const dunning = subscription.dunning;
  if (dunning === null) return null;
  if (!dunning.shipments_held) return dunningBannerCopy.beforeHold;
  return dunningBannerCopy.held(formatLongDateAndTime(new Date(dunning.cancels_at)));
}
