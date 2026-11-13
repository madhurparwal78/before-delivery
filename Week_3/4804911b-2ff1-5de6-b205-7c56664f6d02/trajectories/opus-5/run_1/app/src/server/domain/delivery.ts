import type { SvixAttempt } from '../services/svix.js';

export type DeliveryState = 'pending' | 'delivered' | 'failed' | 'redelivered' | 'cancelled';

export interface DeliveryShape {
  attempts: SvixAttempt[];
  redeliveryRequested: boolean;
  redeliveryFrom: number | null;
  cancelled: boolean;
}

export function finishedAttempts(attempts: SvixAttempt[]): SvixAttempt[] {
  return attempts.filter((attempt) => attempt.outcome === 'success' || attempt.outcome === 'failed');
}

/** The one place a delivery's state is decided, and only from Svix attempts. */
export function deliveryState(delivery: DeliveryShape): DeliveryState {
  const finished = finishedAttempts(delivery.attempts);
  const successAt = finished.findIndex((attempt) => attempt.outcome === 'success');
  if (successAt >= 0) {
    const from = delivery.redeliveryRequested ? delivery.redeliveryFrom ?? 0 : Number.POSITIVE_INFINITY;
    const resentSuccess = finished.some(
      (attempt, index) => attempt.outcome === 'success' && index >= from,
    );
    return resentSuccess ? 'redelivered' : 'delivered';
  }
  if (delivery.cancelled) return 'cancelled';
  if (finished.length > 0) return 'failed';
  return 'pending';
}

export function redeliveryOutstanding(delivery: DeliveryShape): boolean {
  if (!delivery.redeliveryRequested) return false;
  return finishedAttempts(delivery.attempts).length <= (delivery.redeliveryFrom ?? 0);
}
