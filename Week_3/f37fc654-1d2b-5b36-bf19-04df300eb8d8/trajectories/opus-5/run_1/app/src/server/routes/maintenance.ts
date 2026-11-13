import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { ApiError, ValidationError, illegalState, notFound } from '../http/errors.js';
import { bodyObject, pathParam, route } from '../http/handler.js';
import { requireCaller } from '../http/session.js';
import { commissionFor, ownedCommissionFor } from '../domain/access.js';
import {
  findCommission,
  listMilestones,
  milestoneByKey,
  venueOf,
} from '../domain/commissions.js';
import { payerAccount } from '../domain/billing.js';
import { queueCrmEvent } from '../domain/notifications.js';
import { advanceState } from '../domain/transitions.js';
import * as killbill from '../services/killbill.js';
import { MAINTENANCE_PLANS, type MaintenancePlan } from '../../shared/seed.js';
import { todayIn } from '../../shared/venue-time.js';

export const maintenanceRouter = Router();

const PLANS: readonly MaintenancePlan[] = ['essential', 'priority'];

function readPlan(value: unknown): MaintenancePlan {
  const plan = String(value ?? '');
  if (!PLANS.includes(plan as MaintenancePlan)) {
    throw new ValidationError({ plan: 'Pick the Essential or Priority plan.' });
  }
  return plan as MaintenancePlan;
}

function shapeInvoice(invoice: killbill.Invoice): Record<string, unknown> {
  return {
    killbillInvoiceId: invoice.killbillInvoiceId,
    amountCents: invoice.amountCents,
    items: invoice.items.map((item) => ({
      description: item.description,
      amountCents: item.amountCents,
      startDate: item.startDate,
      endDate: item.endDate,
    })),
  };
}

/** Each maintenance invoice gets one receipt, sent once Kill Bill records it. */
async function noteMaintenanceInvoice(
  commissionId: string,
  invoice: killbill.Invoice,
): Promise<void> {
  await query(
    `INSERT INTO maintenance_invoices (id, commission_id, killbill_invoice_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (killbill_invoice_id) DO NOTHING`,
    [randomUUID(), commissionId, invoice.killbillInvoiceId],
  );
}

maintenanceRouter.post(
  '/api/commissions/:commissionId/maintenance',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    const commission = await ownedCommissionFor(pathParam(req, 'commissionId'), caller);
    const plan = readPlan(bodyObject(req)['plan']);

    if (commission.state !== 'accepted' && commission.state !== 'maintained') {
      throw illegalState();
    }
    const milestones = await listMilestones(commission.id);
    const acceptance = milestoneByKey(milestones, 'signed_acceptance');
    if (!acceptance || acceptance.state !== 'paid') {
      throw new ApiError(409, 'milestone_unpaid', undefined, {
        milestoneId: acceptance?.id ?? null,
      });
    }
    if (commission.maintenance_subscription_id) throw illegalState();

    const payer = await payerAccount(commission.client_id);
    const before = (await killbill.listAccountInvoices(payer.accountId)).map(
      (i) => i.killbillInvoiceId,
    );
    const subscription = await killbill.createSubscription(
      payer.accountId,
      MAINTENANCE_PLANS[plan].planName,
      `maint-${commission.id}`,
    );
    const invoice = await killbill.waitForInvoiceAfter(payer.accountId, before);

    await query(
      `UPDATE commissions
          SET maintenance_plan = $2, maintenance_subscription_id = $3, updated_at = now()
        WHERE id = $1`,
      [commission.id, plan, subscription.killbillSubscriptionId],
    );
    if (invoice) await noteMaintenanceInvoice(commission.id, invoice);

    await withTransaction((tx) =>
      queueCrmEvent(tx, {
        commissionId: commission.id,
        clientId: commission.client_id,
        type: 'maintenance.changed',
        data: {
          fromPlan: null,
          toPlan: plan,
          effectiveDate: todayIn(venueOf(commission).timeZone),
        },
      }),
    );
    await advanceState(commission.id, 'accepted', 'maintained', 'maintenance');

    res.status(201).json({
      plan,
      killbillSubscriptionId: subscription.killbillSubscriptionId,
      startDate: subscription.startDate,
      chargedThroughDate: subscription.chargedThroughDate,
      invoice: invoice ? shapeInvoice(invoice) : null,
    });
  }),
);

maintenanceRouter.put(
  '/api/commissions/:commissionId/maintenance',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    const commission = await ownedCommissionFor(pathParam(req, 'commissionId'), caller);
    const plan = readPlan(bodyObject(req)['plan']);
    if (!commission.maintenance_subscription_id) throw illegalState();
    const previousPlan = commission.maintenance_plan as MaintenancePlan | null;
    if (previousPlan === plan) throw new ApiError(409, 'same_plan');

    const venue = venueOf(commission);
    // The change takes effect immediately, from the venue-local date.
    const prorationDate = todayIn(venue.timeZone);
    const payer = await payerAccount(commission.client_id);
    const before = (await killbill.listAccountInvoices(payer.accountId)).map(
      (i) => i.killbillInvoiceId,
    );
    await killbill.changeSubscriptionPlan(
      commission.maintenance_subscription_id,
      MAINTENANCE_PLANS[plan].planName,
    );
    const invoice = await killbill.waitForInvoiceAfter(payer.accountId, before);

    await query(
      `UPDATE commissions SET maintenance_plan = $2, updated_at = now() WHERE id = $1`,
      [commission.id, plan],
    );
    if (invoice) await noteMaintenanceInvoice(commission.id, invoice);

    await withTransaction((tx) =>
      queueCrmEvent(tx, {
        commissionId: commission.id,
        clientId: commission.client_id,
        type: 'maintenance.changed',
        data: { fromPlan: previousPlan, toPlan: plan, effectiveDate: prorationDate },
      }),
    );

    res.json({
      plan,
      previousPlan,
      prorationDate,
      invoice: invoice ? shapeInvoice(invoice) : null,
    });
  }),
);

maintenanceRouter.get(
  '/api/commissions/:commissionId/maintenance',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    const commission = await commissionFor(pathParam(req, 'commissionId'), caller);
    if (!commission.maintenance_subscription_id) {
      res.json({ plan: null, chargedThroughDate: null, invoices: [] });
      return;
    }
    const payer = await payerAccount(commission.client_id);
    const [subscription, invoices] = await Promise.all([
      killbill.getSubscription(commission.maintenance_subscription_id),
      killbill.listAccountInvoices(payer.accountId),
    ]);
    const tracked = await query<{ killbill_invoice_id: string }>(
      'SELECT killbill_invoice_id FROM maintenance_invoices WHERE commission_id = $1',
      [commission.id],
    );
    const mine = new Set(tracked.rows.map((row) => row.killbill_invoice_id));
    res.json({
      plan: commission.maintenance_plan,
      chargedThroughDate: subscription.chargedThroughDate,
      invoices: invoices.filter((i) => mine.has(i.killbillInvoiceId)).map(shapeInvoice),
    });
  }),
);

export { findCommission, notFound };
