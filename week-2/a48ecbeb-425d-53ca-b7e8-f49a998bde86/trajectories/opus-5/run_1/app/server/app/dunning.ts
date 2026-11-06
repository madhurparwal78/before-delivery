import {
  DUNNING_SCHEDULE,
  dunningStepDueAt,
  isRetryStep,
  retryNumber,
  type DunningStepName,
} from '../../shared/subscription.js';
import { queueMail } from '../db/outbox.js';
import {
  claimDunningStep,
  finishDunningRun,
  findSubscription,
  listOpenDunningRuns,
  ranDunningSteps,
  releaseDunningStep,
  setShipmentsHeld,
  type DunningRun,
  type SubscriptionRecord,
} from '../db/subscriptions.js';
import { env } from '../env.js';
import {
  blockAccount,
  cancelImmediately,
  getInvoice,
  getSubscription,
} from '../services/killbill.js';
import {
  dunningCancelledMail,
  dunningHoldMail,
  dunningRetryMail,
} from './emails.js';
import { settleRenewal } from './renewals.js';

/** The open invoice this dunning run is chasing, or null once it is paid. */
async function openInvoice(run: DunningRun): Promise<string | null> {
  const invoice = await getInvoice(run.invoice_id);
  return invoice.balance > 0 ? run.invoice_id : null;
}

/** A retry or card update that succeeds ends dunning at once. */
export async function recoverFromDunning(
  subscription: SubscriptionRecord,
  run: DunningRun,
): Promise<void> {
  await blockAccount({ accountId: subscription.killbill_account_id, stateName: 'CEIBO_CLEAR' });
  await setShipmentsHeld(subscription.id, false);
  await finishDunningRun(run.id, 'recovered');
}

async function runStep(
  run: DunningRun,
  subscription: SubscriptionRecord,
  step: DunningStepName,
): Promise<void> {
  if (step === 'held') {
    await blockAccount({
      accountId: subscription.killbill_account_id,
      stateName: 'CEIBO_OVERDUE',
    });
    await setShipmentsHeld(subscription.id, true);
    await queueMail(dunningHoldMail(subscription, run.id));
    return;
  }
  if (step === 'cancelled') {
    await cancelImmediately(subscription.id);
    await finishDunningRun(run.id, 'cancelled');
    await queueMail(dunningCancelledMail(subscription, run.id));
    return;
  }
  if (isRetryStep(step)) {
    const invoiceId = await openInvoice(run);
    if (invoiceId === null) {
      await recoverFromDunning(subscription, run);
      return;
    }
    const fresh = (await findSubscription(subscription.id))!;
    if ((await settleRenewal(fresh, invoiceId)) === 'approved') {
      await recoverFromDunning(fresh, run);
      return;
    }
    await queueMail(dunningRetryMail(subscription, retryNumber(step), run.id));
  }
}

/**
 * Runs each due dunning step once, in order: retries on days 1, 3 and 7, the
 * shipment hold on day 8 and cancellation on day 14. Claiming the step in the
 * database means one process runs it across all processes.
 */
export async function runDueDunningSteps(): Promise<void> {
  const now = Date.now();
  for (const run of await listOpenDunningRuns()) {
    const subscription = await findSubscription(run.subscription_id);
    if (subscription === null) {
      await finishDunningRun(run.id, 'cancelled');
      continue;
    }

    // A cancel request drops every remaining dunning step at once.
    const killBill = await getSubscription(subscription.id);
    if (killBill !== null && killBill.billingEndDate !== null) {
      await finishDunningRun(run.id, 'cancelled');
      continue;
    }

    const ran = new Set(await ranDunningSteps(run.id));
    for (const entry of DUNNING_SCHEDULE) {
      if (ran.has(entry.step)) continue;
      const due = dunningStepDueAt(run.failed_at, entry.step, env.timing.dunningDaySeconds);
      if (due.getTime() > now) break;
      if (!(await claimDunningStep(run.id, entry.step))) break;
      try {
        await runStep(run, subscription, entry.step);
      } catch (error) {
        await releaseDunningStep(run.id, entry.step);
        throw error;
      }
      if (entry.step === 'cancelled') break;
    }
  }
}
