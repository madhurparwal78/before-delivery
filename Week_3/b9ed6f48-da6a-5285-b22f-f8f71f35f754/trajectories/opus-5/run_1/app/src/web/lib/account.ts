import { useResource } from './hooks.js';
import { useStore } from './store.js';
import type { Currency } from '../../shared/money.js';
import type { Membership, Order } from '../../shared/types.js';

/**
 * The currency this person's Kill Bill account is fixed to, if it is. The account is made
 * at the first payment attempt, so a membership or any settled order names it.
 */
export function useLockedCurrency(): Currency | null {
  const { user } = useStore();
  const membership = useResource<{ membership: Membership | null }>(user ? '/api/me/membership' : null);
  const orders = useResource<{ orders: Order[] }>(user ? '/api/me/orders' : null);
  return membership.data?.membership?.currency ?? orders.data?.orders[0]?.currency ?? null;
}
