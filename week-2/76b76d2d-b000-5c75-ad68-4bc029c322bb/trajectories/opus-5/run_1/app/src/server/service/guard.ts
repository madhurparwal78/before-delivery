import { ApiError } from '../http/errors.ts';
import { billingState } from '../services.ts';

/** Money-moving and booking-changing requests are refused while Kill Bill is unreachable. */
export function assertBillingUp(): void {
  if (billingState() === 'down') throw new ApiError('billing_unavailable');
}
