import { queueCopy, refundCopy } from '../../shared/copy.js';
import { canFulfilmentMove, type FulfilmentTarget } from '../../shared/orderStatus.js';
import { readAttemptKey, runOncePerKey } from '../app/attempt.js';
import { receiptCopyMail } from '../app/emails.js';
import { readRefundRequest, requestRefund } from '../app/refunds.js';
import { readSubscriptions } from '../app/subscriptionView.js';
import { stockFigures } from '../db/ledger.js';
import { findOrder, listQueueOrders, searchOrders, setOrderStatus } from '../db/orders.js';
import { queueMail } from '../db/outbox.js';
import { listSubscriptions } from '../db/subscriptions.js';
import { conflict, filesUnavailable, notFound } from '../http/errors.js';
import type { Route } from '../http/router.js';
import { getObject, objectKeys } from '../services/files.js';
import { allServiceStatuses } from '../services/health.js';
import { findUserByEmail } from '../services/pocketbase.js';
import { withBillingOutage } from '../services/killbill.js';
import {
  FULFILMENT_ROLES,
  REFUND_ROLES,
  TRANSITION_ROLES,
  orderBody,
} from './support.js';

const TARGETS: readonly FulfilmentTarget[] = ['picking', 'packed', 'shipped'];

export const staffRoutes: readonly Route[] = [
  {
    method: 'GET',
    path: '/api/staff/status',
    handle: async () => ({ status: 200, json: { services: allServiceStatuses() } }),
  },
  {
    method: 'GET',
    path: '/api/staff/queue',
    roles: FULFILMENT_ROLES,
    handle: async () => ({
      status: 200,
      json: { orders: (await listQueueOrders()).map(orderBody) },
    }),
  },
  {
    method: 'POST',
    path: '/api/staff/orders/:number/transitions',
    roles: TRANSITION_ROLES,
    handle: async (ctx) => {
      const number = ctx.params.number!.toUpperCase();
      const order = await findOrder(number);
      if (order === null || order.status === 'pending_payment') throw notFound();
      const payload = (ctx.body ?? {}) as Record<string, unknown>;
      const to = payload.to as FulfilmentTarget;
      if (!TARGETS.includes(to)) throw notFound();
      if (!canFulfilmentMove(order.status, to)) {
        throw conflict('illegal_transition', queueCopy.illegal(number, to));
      }
      await setOrderStatus(number, to);
      return { status: 200, json: { order: orderBody((await findOrder(number))!) } };
    },
  },
  {
    method: 'GET',
    path: '/api/staff/orders/:number',
    roles: FULFILMENT_ROLES,
    handle: async (ctx) => {
      const order = await findOrder(ctx.params.number!.toUpperCase());
      if (order === null || order.status === 'pending_payment') throw notFound();
      return {
        status: 200,
        json: {
          order: orderBody(order),
          customer: { name: order.customer_name, email: order.customer_email },
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/api/staff/orders/:number/packing-slip.pdf',
    roles: FULFILMENT_ROLES,
    handle: async (ctx) => {
      const order = await findOrder(ctx.params.number!.toUpperCase());
      if (order === null || order.status === 'pending_payment') throw notFound();
      const stored = await getObject(objectKeys.packingSlip(order.number));
      if (stored === null) throw filesUnavailable();
      return {
        status: 200,
        body: stored.body,
        contentType: 'application/pdf',
        headers: {
          'Content-Disposition': `inline; filename="ceibo-${order.number}-packing-slip.pdf"`,
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/api/staff/stock',
    roles: FULFILMENT_ROLES,
    handle: async () => ({ status: 200, json: { flavours: await stockFigures() } }),
  },
  {
    method: 'GET',
    path: '/api/staff/search',
    roles: FULFILMENT_ROLES,
    handle: async (ctx) => {
      const term = (ctx.query.get('q') ?? '').trim();
      if (term === '') return { status: 200, json: { orders: [], subscriptions: [] } };

      const orders = await searchOrders(term);
      const customer = term.includes('@') ? await findUserByEmail(term) : null;
      const owners = new Set<string>(orders.map((order) => order.user_id));
      if (customer !== null) owners.add(customer.id);

      const records = (
        await Promise.all([...owners].map((userId) => listSubscriptions(userId)))
      ).flat();
      const subscriptions = await readSubscriptions(records);
      return { status: 200, json: { orders: orders.map(orderBody), subscriptions } };
    },
  },
  {
    method: 'POST',
    path: '/api/staff/orders/:number/refunds',
    roles: REFUND_ROLES,
    handle: async (ctx) => {
      const number = ctx.params.number!.toUpperCase();
      const order = await findOrder(number);
      if (order === null || order.status === 'pending_payment') throw notFound();
      const key = readAttemptKey(ctx.headers['idempotency-key']);
      const request = readRefundRequest(ctx.body);

      return runOncePerKey('refund', ctx.user!.id, key, ctx.body, () =>
        withBillingOutage(refundCopy.billingOutage, async () => {
          const recorded = await requestRefund(order, request);
          return {
            status: 202,
            json: {
              refund: {
                id: recorded.refund.id,
                status: recorded.refund.status,
                amount_cents: recorded.refund.amount_cents,
                reason: recorded.refund.reason,
                split: recorded.refund.split,
                created_at: recorded.refund.created_at,
              },
              order: orderBody(recorded.order),
            },
          };
        }),
      );
    },
  },
  {
    method: 'POST',
    path: '/api/staff/orders/:number/resend-receipt',
    roles: REFUND_ROLES,
    body: 'none',
    handle: async (ctx) => {
      const order = await findOrder(ctx.params.number!.toUpperCase());
      if (order === null || order.status === 'pending_payment') throw notFound();
      await queueMail(receiptCopyMail(order));
      return { status: 202, json: { queued: true } };
    },
  },
];
