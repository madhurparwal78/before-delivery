/**
 * Desk routes. These need a fitter session; a rider gets 403.
 */

import type { Router } from 'express';

import type { DeskPayment, StageName } from '../../../shared/types.js';
import { amsterdamDate, isIsoDate } from '../../domain/clock.js';
import { poolQueryable, query } from '../../db/pool.js';
import { assembleOrder, loadAllOrders, loadOrder } from '../../store/orders.js';
import { deskTransition, recordDelivery, recordInspection } from '../../services/orderFlow.js';
import { requestRefund } from '../../services/refunds.js';
import { requireIdempotencyKey, runIdempotent } from '../../services/idempotency.js';
import { deskRidesOn, markOutcome, openRideDay } from '../../services/rides.js';
import { notFound, ValidationError } from '../errors.js';
import { asyncRoute, requireFitter } from '../context.js';

async function deskPayments(orderId: string): Promise<DeskPayment[]> {
  const rows = await query<{
    stage: StageName;
    amount_cents: number;
    status: string;
    killbill_payment_id: string | null;
    killbill_transaction_id: string | null;
  }>(
    `SELECT stage, amount_cents, status, killbill_payment_id, killbill_transaction_id
     FROM payments WHERE order_id = $1 ORDER BY created_at`,
    [orderId],
  );
  return rows.rows.map((row) => ({
    stage: row.stage,
    amountCents: row.amount_cents,
    status: row.status,
    killbillPaymentId: row.killbill_payment_id,
    killbillTransactionId: row.killbill_transaction_id,
  }));
}

export function registerDeskRoutes(api: Router): void {
  api.get(
    '/desk/orders',
    asyncRoute(async (req, res) => {
      await requireFitter(req);
      const loaded = await loadAllOrders(poolQueryable);
      res.status(200).json({ orders: loaded.map(assembleOrder) });
    }),
  );

  api.get(
    '/desk/orders/:id',
    asyncRoute<{ id: string }>(async (req, res) => {
      await requireFitter(req);
      const loaded = await loadOrder(poolQueryable, req.params.id);
      if (!loaded) throw notFound();
      res.status(200).json({
        ...assembleOrder(loaded),
        payments: await deskPayments(req.params.id),
      });
    }),
  );

  api.post(
    '/desk/orders/:id/refunds',
    asyncRoute<{ id: string }>(async (req, res) => {
      const fitter = await requireFitter(req);
      const key = requireIdempotencyKey(req.headers['idempotency-key']);
      const body = (req.body ?? {}) as Record<string, unknown>;

      const loaded = await loadOrder(poolQueryable, req.params.id);
      if (!loaded) throw notFound();

      const lineId = typeof body.lineId === 'string' ? body.lineId : '';
      if (!loaded.lines.some((line) => line.id === lineId)) throw notFound();

      const amountCents = Number(body.amountCents);
      if (!Number.isFinite(amountCents)) {
        throw new ValidationError({ amountCents: 'Enter an amount like 12.50.' });
      }

      const answer = await runIdempotent(
        fitter.id,
        key,
        `POST /api/desk/orders/${req.params.id}/refunds`,
        { lineId, amountCents },
        (markProviderCalled) =>
          requestRefund(
            {
              orderId: req.params.id,
              lineId,
              amountCents: Math.trunc(amountCents),
              externalKeyPrefix: `${fitter.id}:${key}`,
            },
            markProviderCalled,
          ),
      );
      res.status(answer.status).json(answer.body);
    }),
  );

  api.post(
    '/desk/orders/:id/transitions',
    asyncRoute<{ id: string }>(async (req, res) => {
      await requireFitter(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const loaded = await loadOrder(poolQueryable, req.params.id);
      if (!loaded) throw notFound();
      res.status(200).json(await deskTransition(req.params.id, body.to));
    }),
  );

  api.post(
    '/desk/orders/:id/delivered',
    asyncRoute<{ id: string }>(async (req, res) => {
      await requireFitter(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const loaded = await loadOrder(poolQueryable, req.params.id);
      if (!loaded) throw notFound();
      res.status(200).json(await recordDelivery(req.params.id, body.deliveredOn));
    }),
  );

  api.post(
    '/desk/orders/:id/inspection',
    asyncRoute<{ id: string }>(async (req, res) => {
      await requireFitter(req);
      const loaded = await loadOrder(poolQueryable, req.params.id);
      if (!loaded) throw notFound();
      const result = await recordInspection(req.params.id);
      res.status(200).json(result.order);
    }),
  );

  api.post(
    '/desk/ride-days',
    asyncRoute(async (req, res) => {
      await requireFitter(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const slots = await openRideDay({
        bikeId: body.bikeId,
        date: body.date,
        times: body.times,
      });
      res.status(201).json({ slots });
    }),
  );

  api.get(
    '/desk/rides',
    asyncRoute(async (req, res) => {
      await requireFitter(req);
      const raw = req.query.date;
      const date = typeof raw === 'string' && isIsoDate(raw) ? raw : amsterdamDate();
      res.status(200).json({ rides: await deskRidesOn(date) });
    }),
  );

  api.post(
    '/desk/rides/:id/outcome',
    asyncRoute<{ id: string }>(async (req, res) => {
      await requireFitter(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      res.status(200).json(await markOutcome(req.params.id, body.outcome));
    }),
  );
}
