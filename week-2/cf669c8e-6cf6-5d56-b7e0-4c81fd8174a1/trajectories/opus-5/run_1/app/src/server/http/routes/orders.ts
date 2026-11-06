/**
 * Rider order routes.
 *
 * A rider can open only their own orders, and another rider's id behaves
 * exactly like a missing one.
 */

import type { Router } from 'express';

import { assembleOrder, loadOrdersForUser } from '../../store/orders.js';
import { poolQueryable } from '../../db/pool.js';
import {
  createOrder,
  loadOwned,
  patchOrder,
  switchToWorkshop,
  withdrawOrder,
} from '../../services/orderFlow.js';
import { isStageName, requestPayment } from '../../services/payments.js';
import { requireIdempotencyKey, runIdempotent } from '../../services/idempotency.js';
import { ValidationError } from '../errors.js';
import { asyncRoute, requireUser } from '../context.js';

export function registerOrderRoutes(api: Router): void {
  api.post(
    '/orders',
    asyncRoute(async (req, res) => {
      const user = await requireUser(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const order = await createOrder({
        user,
        kind: body.kind,
        config: body.config,
        bikeId: body.bikeId,
        plan: body.plan,
        expectedTotalCents: body.expectedTotalCents,
      });
      res.status(201).json(order);
    }),
  );

  api.get(
    '/orders',
    asyncRoute(async (req, res) => {
      const user = await requireUser(req);
      const loaded = await loadOrdersForUser(poolQueryable, user.id);
      res.status(200).json({ orders: loaded.map(assembleOrder) });
    }),
  );

  api.get(
    '/orders/:id',
    asyncRoute<{ id: string }>(async (req, res) => {
      const user = await requireUser(req);
      const loaded = await loadOwned(user.id, req.params.id);
      res.status(200).json(assembleOrder(loaded));
    }),
  );

  api.patch(
    '/orders/:id',
    asyncRoute<{ id: string }>(async (req, res) => {
      const user = await requireUser(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      // Ownership is checked before any state conflict.
      await loadOwned(user.id, req.params.id);
      const order = await patchOrder({
        userId: user.id,
        orderId: req.params.id,
        planVersion: body.planVersion,
        ...(body.plan !== undefined ? { plan: body.plan } : {}),
        ...(body.config !== undefined ? { config: body.config } : {}),
      });
      res.status(200).json(order);
    }),
  );

  api.post(
    '/orders/:id/payments',
    asyncRoute<{ id: string }>(async (req, res) => {
      const user = await requireUser(req);
      const key = requireIdempotencyKey(req.headers['idempotency-key']);
      const body = (req.body ?? {}) as Record<string, unknown>;

      await loadOwned(user.id, req.params.id);
      if (!isStageName(body.stage)) {
        throw new ValidationError({ stage: 'Enter deposit, instalment-1, instalment-2 or instalment-3.' });
      }
      const stage = body.stage;

      const answer = await runIdempotent(
        user.id,
        key,
        `POST /api/orders/${req.params.id}/payments`,
        { stage },
        (markProviderCalled) =>
          requestPayment(
            { user, orderId: req.params.id, stage, externalKey: `${user.id}:${key}` },
            markProviderCalled,
          ),
      );
      res.status(answer.status).json(answer.body);
    }),
  );

  api.post(
    '/orders/:id/withdraw',
    asyncRoute<{ id: string }>(async (req, res) => {
      const user = await requireUser(req);
      const key = requireIdempotencyKey(req.headers['idempotency-key']);
      await loadOwned(user.id, req.params.id);

      const answer = await runIdempotent(
        user.id,
        key,
        `POST /api/orders/${req.params.id}/withdraw`,
        {},
        (markProviderCalled) =>
          withdrawOrder(user.id, req.params.id, `${user.id}:${key}`, markProviderCalled),
      );
      res.status(answer.status).json(answer.body);
    }),
  );

  api.post(
    '/orders/:id/switch-to-workshop',
    asyncRoute<{ id: string }>(async (req, res) => {
      const user = await requireUser(req);
      const key = requireIdempotencyKey(req.headers['idempotency-key']);
      await loadOwned(user.id, req.params.id);

      // The switch makes no Kill Bill transaction, so it never marks a
      // provider call and a refusal always leaves the key usable.
      const answer = await runIdempotent(
        user.id,
        key,
        `POST /api/orders/${req.params.id}/switch-to-workshop`,
        {},
        async () => ({ status: 200, body: await switchToWorkshop(user.id, req.params.id) }),
      );
      res.status(answer.status).json(answer.body);
    }),
  );
}
