/** The monthly walk-in shelf subscription. */

import { db } from '../db.js';
import * as errors from '../http/errors.js';
import { json, type Route, type RouteResult, type SessionContext } from '../http/router.js';
import { requireResolved } from '../http/resolve.js';
import { Validator } from '../http/validate.js';
import { renterBillingAccountId } from '../domain/billingAccount.js';
import {
  presentActive,
  presentCancelled,
  reconcileShelfSubscription,
  storedActiveSubscription,
} from '../domain/shelf.js';
import {
  BillingUnavailable,
  SHELF_PLAN,
  cancelShelfSubscription,
  createShelfSubscription,
} from '../services/killbill.js';
import type { ShelfSubscriptionRow } from '../rows.js';

async function start(context: SessionContext): Promise<RouteResult> {
  const renter = requireResolved(context.resolved, 'renter');
  if (renter.status !== 'active') throw errors.renterNotActive();
  // `already_subscribed` is judged after reconciling with Kill Bill.
  if ((await reconcileShelfSubscription(renter.id)) !== null) throw errors.alreadySubscribed();

  const validator = new Validator(context.body);
  const shelfLabel = validator.text('shelf_label', 1, 40);
  validator.done();

  const ordinalRow = await db.one<{ next: number }>(
    'SELECT COALESCE(MAX(ordinal), 0)::int + 1 AS next FROM shelf_subscriptions WHERE renter_id = $1',
    [renter.id],
  );
  const externalKey = `shelf-${renter.id}-${ordinalRow.next}`;

  try {
    const accountId = await renterBillingAccountId(renter);
    const remote = await createShelfSubscription(accountId, externalKey);
    const stored = await db.one<ShelfSubscriptionRow>(
      `INSERT INTO shelf_subscriptions
         (renter_id, shelf_label, plan, external_key, killbill_subscription_id, state, ordinal)
       VALUES ($1, $2, $3, $4, $5, 'active', $6)
       RETURNING id, renter_id, shelf_label, plan, external_key, killbill_subscription_id,
                 state, ordinal`,
      [
        renter.id,
        shelfLabel,
        SHELF_PLAN,
        externalKey,
        remote.subscriptionId,
        ordinalRow.next,
      ],
    );
    return json(201, { subscription: presentActive(stored) });
  } catch (error) {
    if (error instanceof BillingUnavailable) throw errors.billingUnavailable();
    throw error;
  }
}

async function end(context: SessionContext): Promise<RouteResult> {
  const renter = requireResolved(context.resolved, 'renter');
  const stored = await storedActiveSubscription(db, renter.id);
  if (!stored) throw errors.notSubscribed();

  try {
    await cancelShelfSubscription(stored.killbill_subscription_id);
  } catch (error) {
    if (error instanceof BillingUnavailable) throw errors.billingUnavailable();
    throw error;
  }
  await db.query(
    "UPDATE shelf_subscriptions SET state = 'cancelled', ended_at = now() WHERE id = $1",
    [stored.id],
  );
  return json(200, { subscription: presentCancelled(stored) });
}

export const shelfRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/renters/:renter_id/shelf-subscription',
    auth: 'session',
    roles: ['operator'],
    body: 'json',
    resolve: ['renter'],
    handle: start,
  },
  {
    method: 'DELETE',
    path: '/api/renters/:renter_id/shelf-subscription',
    auth: 'session',
    roles: ['operator'],
    resolve: ['renter'],
    handle: end,
  },
];
