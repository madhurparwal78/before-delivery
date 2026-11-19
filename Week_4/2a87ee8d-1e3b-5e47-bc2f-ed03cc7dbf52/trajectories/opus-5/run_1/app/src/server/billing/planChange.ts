import { pool, withClient } from '../db/pool.js';
import { AppError, FIELD_MESSAGES } from '../errors.js';
import {
  killbillPlanName,
  planChangePolicy,
  priceFor,
  type BillingTerm,
  type PlanCode,
} from '../domain/plans.js';
import { decimalToCents } from '../domain/money.js';
import * as killbill from '../services/killbill.js';
import { BillingUnavailable } from '../services/killbill.js';
import {
  buildBillingObject,
  findFacilitator,
  listMirroredInvoices,
  readMirror,
  refreshMirror,
  type BillingObject,
  type InvoiceRecord,
} from './mirror.js';
import { recordActivity } from '../activity.js';

const PRORATION_WAIT_MS = 6_000;

/** Plan changes for one facilitator are serialised across instances. */
async function withPlanLock<T>(facilitatorId: string, run: () => Promise<T>): Promise<T> {
  return withClient(async (client) => {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [`plan:${facilitatorId}`]);
    try {
      return await run();
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [`plan:${facilitatorId}`]);
    }
  });
}

export interface PlanChangeResult {
  readonly billing: BillingObject;
  readonly invoice: InvoiceRecord | null;
}

export function assertTermExists(plan: PlanCode, term: BillingTerm): void {
  if (priceFor(plan, term) === null) {
    throw new AppError('validation', { fields: { term: FIELD_MESSAGES.freeAnnual } });
  }
}

/**
 * Applies a plan change through Kill Bill and mirrors the outcome.
 *
 * An immediate change records Kill Bill's prorated invoice with the same number and amount.
 * Every other change is scheduled for the charged-through date. When Kill Bill is unreachable
 * or rejects the change, nothing changes in either system.
 */
export async function changePlan(
  facilitatorId: string,
  timeZone: string,
  target: { plan: PlanCode; term: BillingTerm },
  nowMs: number,
): Promise<PlanChangeResult> {
  assertTermExists(target.plan, target.term);
  return withPlanLock(facilitatorId, async () => {
    // Decide against what Kill Bill reports right now, not a possibly stale mirror.
    try {
      await refreshMirror(facilitatorId, nowMs);
    } catch (error) {
      if (error instanceof BillingUnavailable) throw new AppError('billing_unavailable');
      throw error;
    }

    const mirror = await readMirror(pool, facilitatorId);
    const subscriptionId = mirror.killbillSubscriptionId;
    const accountId = mirror.killbillAccountId;
    if (subscriptionId === null || accountId === null) throw new AppError('billing_unavailable');

    const policy = planChangePolicy(
      { plan: mirror.plan, term: mirror.term },
      target,
      mirror.pendingChange !== null,
    );
    if (policy === 'unchanged') throw new AppError('plan_unchanged');

    const knownInvoiceIds = new Set((await listMirroredInvoices(pool, facilitatorId)).map((invoice) => invoice.id));

    try {
      if (policy === 'cancel_pending') {
        await killbill.undoPendingChange(subscriptionId);
      } else {
        await killbill.changeSubscriptionPlan(subscriptionId, killbillPlanName(target.plan, target.term));
      }
    } catch (error) {
      if (error instanceof BillingUnavailable) throw new AppError('billing_unavailable');
      throw error;
    }

    let invoice: killbill.Invoice | null = null;
    if (policy === 'immediate') {
      try {
        invoice = await killbill.awaitNewInvoice(accountId, knownInvoiceIds, PRORATION_WAIT_MS);
      } catch (error) {
        if (!(error instanceof BillingUnavailable)) throw error;
      }
    }

    // The mirror refresh records the invoice and the new entitlements.
    const refreshed = await tryRefresh(facilitatorId, nowMs);
    await recordActivity(pool, {
      facilitatorId,
      actor: 'facilitator',
      action: policy === 'immediate' ? 'plan.changed' : 'plan.change_scheduled',
      workshopId: null,
    });

    const billing = await buildBillingObject(facilitatorId, timeZone, nowMs, !refreshed);
    const recorded =
      invoice === null
        ? null
        : (await listMirroredInvoices(pool, facilitatorId)).find((candidate) => candidate.id === invoice?.id) ?? null;
    return { billing, invoice: recorded };
  });
}

async function tryRefresh(facilitatorId: string, nowMs: number): Promise<boolean> {
  try {
    await refreshMirror(facilitatorId, nowMs);
    return true;
  } catch (error) {
    if (error instanceof BillingUnavailable) return false;
    throw error;
  }
}

/**
 * Asks Kill Bill to pay each unpaid invoice with the account's default payment method, then
 * refreshes the mirror. The automatic-payment-off tag, if present, is left in place.
 */
export async function retryPayment(
  facilitatorId: string,
  timeZone: string,
  nowMs: number,
): Promise<BillingObject> {
  return withPlanLock(facilitatorId, async () => {
    try {
      await refreshMirror(facilitatorId, nowMs);
    } catch (error) {
      if (error instanceof BillingUnavailable) throw new AppError('billing_unavailable');
      throw error;
    }

    const mirror = await readMirror(pool, facilitatorId);
    const accountId = mirror.killbillAccountId;
    if (accountId === null) throw new AppError('billing_unavailable');

    const unpaid = (await listMirroredInvoices(pool, facilitatorId)).filter(
      (invoice) => decimalToCents(invoice.balance) > 0,
    );
    if (unpaid.length === 0) throw new AppError('nothing_due');

    try {
      for (const invoice of unpaid) await killbill.payInvoice(accountId, invoice.id, invoice.balance);
    } catch (error) {
      if (error instanceof BillingUnavailable) throw new AppError('billing_unavailable');
      throw error;
    }

    const refreshed = await tryRefresh(facilitatorId, nowMs);
    await recordActivity(pool, {
      facilitatorId,
      actor: 'facilitator',
      action: 'payment.retried',
      workshopId: null,
    });
    return buildBillingObject(facilitatorId, timeZone, nowMs, !refreshed);
  });
}

export async function facilitatorTimeZone(facilitatorId: string): Promise<string> {
  return (await findFacilitator(pool, facilitatorId)).timeZone;
}
