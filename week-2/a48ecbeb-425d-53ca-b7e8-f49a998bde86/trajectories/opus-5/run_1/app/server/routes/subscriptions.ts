import { apiMessages, subscriptionCopy } from '../../shared/copy.js';
import { readChangeRequest, requestChange } from '../app/changes.js';
import { recoverFromDunning } from '../app/dunning.js';
import { settleRenewal } from '../app/renewals.js';
import { readSubscription, readSubscriptions } from '../app/subscriptionView.js';
import { getInvoice, withBillingOutage } from '../services/killbill.js';
import {
  findChangeRequest,
  findSubscription,
  listSubscriptions,
  openDunningRun,
  updateSubscriptionCard,
  type SubscriptionRecord,
} from '../db/subscriptions.js';
import { validateCard } from '../domain/cards.js';
import { ApiError, conflict, notFound, validationError } from '../http/errors.js';
import type { Route } from '../http/router.js';
import { CUSTOMER_ONLY } from './support.js';

const BILLING_COPY = subscriptionCopy.billingOutage;

async function ownSubscription(
  userId: string,
  id: string,
): Promise<SubscriptionRecord> {
  const record = await findSubscription(id);
  if (record === null || record.user_id !== userId) throw notFound();
  return record;
}

export const subscriptionRoutes: readonly Route[] = [
  {
    method: 'GET',
    path: '/api/subscriptions',
    roles: CUSTOMER_ONLY,
    handle: async (ctx) =>
      withBillingOutage(BILLING_COPY, async () => {
        const records = await listSubscriptions(ctx.user!.id);
        return { status: 200, json: { subscriptions: await readSubscriptions(records) } };
      }),
  },
  {
    method: 'GET',
    path: '/api/subscriptions/:id',
    roles: CUSTOMER_ONLY,
    handle: async (ctx) => {
      const record = await ownSubscription(ctx.user!.id, ctx.params.id!);
      return withBillingOutage(BILLING_COPY, async () => {
        const reading = await readSubscription(record);
        if (reading === null) throw notFound();
        return { status: 200, json: { subscription: reading.payload } };
      });
    },
  },
  {
    method: 'POST',
    path: '/api/subscriptions/:id/changes',
    roles: CUSTOMER_ONLY,
    handle: async (ctx) => {
      const record = await ownSubscription(ctx.user!.id, ctx.params.id!);
      const request = readChangeRequest(ctx.body);
      return withBillingOutage(BILLING_COPY, async () => {
        const reading = await readSubscription(record);
        if (reading === null) throw notFound();
        const change = await requestChange(record, reading, request);
        return {
          status: 202,
          json: {
            change: {
              id: change.id,
              kind: change.kind,
              status: change.status,
              effective_date: change.effective_date,
              requested_at: change.requested_at,
            },
          },
        };
      });
    },
  },
  {
    method: 'GET',
    path: '/api/subscriptions/:id/changes/:changeId',
    roles: CUSTOMER_ONLY,
    handle: async (ctx) => {
      await ownSubscription(ctx.user!.id, ctx.params.id!);
      const change = await findChangeRequest(ctx.params.changeId!);
      if (change === null || change.subscription_id !== ctx.params.id) throw notFound();
      return {
        status: 200,
        json: {
          change: {
            id: change.id,
            kind: change.kind,
            status: change.status,
            effective_date: change.effective_date,
            requested_at: change.requested_at,
          },
        },
      };
    },
  },
  {
    method: 'PUT',
    path: '/api/subscriptions/:id/card',
    roles: CUSTOMER_ONLY,
    handle: async (ctx) => {
      const record = await ownSubscription(ctx.user!.id, ctx.params.id!);
      const validation = validateCard(ctx.body, new Date());
      if (!validation.ok) throw validationError(validation.fields);

      return withBillingOutage(BILLING_COPY, async () => {
        const reading = await readSubscription(record);
        if (reading === null) throw notFound();
        if (
          reading.payload.state === 'cancelled' ||
          reading.payload.state === 'cancel_pending' ||
          reading.payload.pending_change?.kind === 'cancel'
        ) {
          throw conflict('illegal_change', apiMessages.illegalChange);
        }

        await updateSubscriptionCard(record.id, validation.card);
        const run = await openDunningRun(record.id);

        // A card update while past due charges the open renewal in this request.
        if (reading.payload.state === 'past_due' && run !== null) {
          const invoice = await getInvoice(run.invoice_id);
          if (invoice.balance > 0) {
            const fresh = (await findSubscription(record.id))!;
            if ((await settleRenewal(fresh, run.invoice_id)) === 'declined') {
              throw new ApiError(402, 'card_declined', apiMessages.cardDeclined);
            }
            await recoverFromDunning(fresh, run);
          }
        }

        const updated = await readSubscription((await findSubscription(record.id))!);
        if (updated === null) throw notFound();
        return { status: 200, json: { subscription: updated.payload } };
      });
    },
  },
];
