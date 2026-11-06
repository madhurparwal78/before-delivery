/**
 * The cold-storage shelf subscription. The app reports it active or ended only
 * as Kill Bill confirms, and a cancellation made directly in Kill Bill is
 * recorded here on the next read.
 */

import { db, type Db } from '../db.js';
import { BillingUnavailable, SHELF_PLAN, readSubscription } from '../services/killbill.js';
import type { ShelfSubscription } from '../../shared/types.js';
import type { ShelfSubscriptionRow } from '../rows.js';

const CANCELLED_STATES = new Set(['CANCELLED', 'EXPIRED']);

export async function storedActiveSubscription(
  tx: Db,
  renterId: string,
): Promise<ShelfSubscriptionRow | null> {
  return tx.maybeOne<ShelfSubscriptionRow>(
    `SELECT id, renter_id, shelf_label, plan, external_key, killbill_subscription_id, state, ordinal
       FROM shelf_subscriptions WHERE renter_id = $1 AND state = 'active'`,
    [renterId],
  );
}

function present(
  row: ShelfSubscriptionRow,
  billingState: ShelfSubscription['billing_state'],
  state: ShelfSubscription['state'],
): ShelfSubscription {
  return {
    shelf_label: row.shelf_label,
    plan: SHELF_PLAN,
    external_key: row.external_key,
    killbill_subscription_id: row.killbill_subscription_id,
    state,
    billing_state: billingState,
  };
}

export function presentCancelled(row: ShelfSubscriptionRow): ShelfSubscription {
  return present(row, 'CANCELLED', 'cancelled');
}

export function presentActive(row: ShelfSubscriptionRow): ShelfSubscription {
  return present(row, 'ACTIVE', 'active');
}

/**
 * Reads the renter's current subscription from Kill Bill and records an ending
 * that happened there. Returns the subscription the API should report.
 */
export async function reconcileShelfSubscription(
  renterId: string,
): Promise<ShelfSubscription | null> {
  const stored = await storedActiveSubscription(db, renterId);
  if (!stored) return null;
  try {
    const remote = await readSubscription(stored.killbill_subscription_id);
    if (CANCELLED_STATES.has(remote.state)) {
      await db.query(
        "UPDATE shelf_subscriptions SET state = 'cancelled', ended_at = now() WHERE id = $1",
        [stored.id],
      );
      return null;
    }
    return presentActive(stored);
  } catch (error) {
    if (error instanceof BillingUnavailable) {
      return present(stored, 'unknown', 'active');
    }
    throw error;
  }
}
