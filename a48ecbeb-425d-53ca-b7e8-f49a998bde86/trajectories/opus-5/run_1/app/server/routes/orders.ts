import { findProvince } from '../../shared/catalogue.js';
import { runOncePerKey, readAttemptKey } from '../app/attempt.js';
import { runCheckout, readCheckoutRequest } from '../app/checkout.js';
import { publishStockLevels } from '../app/live.js';
import { findOrder, listCustomerOrders } from '../db/orders.js';
import { filesUnavailable, notFound } from '../http/errors.js';
import type { Route } from '../http/router.js';
import { getObject, objectKeys } from '../services/files.js';
import { getAddress } from '../services/pocketbase.js';
import { CUSTOMER_ONLY, FULFILMENT_ROLES, openCart, orderBody } from './support.js';

export const orderRoutes: readonly Route[] = [
  {
    method: 'POST',
    path: '/api/checkout',
    roles: CUSTOMER_ONLY,
    handle: async (ctx) => {
      const key = readAttemptKey(ctx.headers['idempotency-key']);
      const request = readCheckoutRequest(ctx.body);
      const cart = await openCart(ctx);

      return runOncePerKey('checkout', ctx.user!.id, key, ctx.body, async () => {
        const address = await getAddress(request.addressId);
        if (address === null || address.user !== ctx.user!.id) throw notFound();
        const province = findProvince(address.province);
        if (province === undefined) throw notFound();

        const result = await runCheckout({
          user: ctx.user!,
          cartId: cart.id,
          request,
          shipTo: {
            name: address.name,
            line1: address.line1,
            line2: address.line2,
            city: address.city,
            province: province.code,
            postal_code: address.postal_code,
          },
        });
        void publishStockLevels();
        return {
          status: 201,
          json: {
            order: orderBody(result.order),
            ...(result.subscriptionId === null
              ? {}
              : { subscription_id: result.subscriptionId }),
          },
          cookies: cart.cookies,
        };
      });
    },
  },
  {
    method: 'GET',
    path: '/api/orders',
    roles: CUSTOMER_ONLY,
    handle: async (ctx) => ({
      status: 200,
      json: { orders: (await listCustomerOrders(ctx.user!.id)).map(orderBody) },
    }),
  },
  {
    method: 'GET',
    path: '/api/orders/:number',
    roles: CUSTOMER_ONLY,
    handle: async (ctx) => {
      const order = await findOrder(ctx.params.number!.toUpperCase());
      if (order === null || order.user_id !== ctx.user!.id || order.status === 'pending_payment') {
        throw notFound();
      }
      return { status: 200, json: { order: orderBody(order) } };
    },
  },
  {
    method: 'GET',
    path: '/api/orders/:number/invoice.pdf',
    roles: [...CUSTOMER_ONLY, ...FULFILMENT_ROLES],
    handle: async (ctx) => {
      const order = await findOrder(ctx.params.number!.toUpperCase());
      if (order === null || order.status === 'pending_payment') throw notFound();
      const owns = order.user_id === ctx.user!.id;
      if (!owns && ctx.user!.role === 'customer') throw notFound();

      const stored = await getObject(objectKeys.invoice(order.number));
      if (stored === null) throw filesUnavailable();
      return {
        status: 200,
        body: stored.body,
        contentType: 'application/pdf',
        headers: {
          'Content-Disposition': `inline; filename="ceibo-${order.number}-invoice.pdf"`,
        },
      };
    },
  },
];
