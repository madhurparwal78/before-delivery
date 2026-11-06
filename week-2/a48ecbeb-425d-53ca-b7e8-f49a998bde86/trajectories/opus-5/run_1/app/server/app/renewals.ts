import type { Quote } from '../../shared/quote.js';
import { writeLedgerEvent } from '../db/ledger.js';
import { findOrder, insertOrder, nextOrderNumber, type OrderRecord } from '../db/orders.js';
import { queueMail, queueMailIn } from '../db/outbox.js';
import { transaction } from '../db/pool.js';
import {
  claimDunningStep,
  claimRenewalInvoice,
  countCardCharge,
  findSubscription,
  listAllSubscriptions,
  openDunningRun,
  releaseRenewalClaim,
  setRenewalState,
  startDunningRun,
  unpaidRenewalOrders,
  updateSubscriptionPlan,
  type SubscriptionRecord,
} from '../db/subscriptions.js';
import { chargeApproved } from '../domain/cards.js';
import {
  addExternalCharges,
  commitInvoice,
  findPayment,
  getInvoice,
  listAccountInvoiceIds,
  payInvoice,
  paymentKey,
  type ExternalCharge,
} from '../services/killbill.js';
import { storeOrderDocuments } from './documents.js';
import { dunningFailureMail, renewalPaidMail } from './emails.js';
import { publishStockLevels } from './live.js';
import { quotePlanBox } from './quotes.js';
import { taxLineLabel } from '../../shared/quote.js';

/** A box invoice carries the plan's recurring charge plus these charge items. */
export function boxCharges(quote: Quote): ExternalCharge[] {
  return [
    { description: 'Can deposit', cents: quote.deposit_cents },
    { description: 'Shipping', cents: quote.shipping_cents },
    ...quote.taxes.map((tax) => ({
      description: taxLineLabel(tax.name, tax.rate),
      cents: tax.cents,
    })),
  ];
}

/** Reserves the order number ahead of the charge, because it is the payment key. */
async function reserveOrderNumber(): Promise<string> {
  return transaction((tx) => nextOrderNumber(tx));
}

/** A renewal box takes its cans as sold straight from on-hand stock. */
async function recordRenewalOrder(
  subscription: SubscriptionRecord,
  invoiceId: string,
  quote: Quote,
  orderNumber: string,
): Promise<OrderRecord> {
  await transaction(async (tx) => {
    await insertOrder(tx, {
      number: orderNumber,
      userId: subscription.user_id,
      kind: 'renewal',
      quote,
      shipTo: subscription.ship_to,
      subscriptionId: subscription.id,
      killbillAccountId: subscription.killbill_account_id,
      killbillInvoiceId: invoiceId,
      customerEmail: subscription.customer_email,
      customerName: subscription.customer_name,
    });
    for (const line of quote.lines) {
      await writeLedgerEvent(tx, line.flavour, 'sold', line.quantity);
    }
  });
  await setRenewalState(invoiceId, 'paid', orderNumber);
  void publishStockLevels();
  return (await findOrder(orderNumber))!;
}

/** Stores the PDFs and only then marks the renewal order paid and emails it. */
async function finishRenewalOrder(orderNumber: string): Promise<void> {
  const order = await findOrder(orderNumber);
  if (order === null || order.status !== 'pending_payment') return;
  await storeOrderDocuments(order);
  await transaction(async (tx) => {
    await tx.execute("update orders set status = 'paid', paid_at = now() where number = $1", [
      orderNumber,
    ]);
    const paid = (await findOrder(orderNumber, tx))!;
    await queueMailIn(tx, renewalPaidMail(paid));
  });
}

export async function finishStoredRenewalOrders(): Promise<void> {
  for (const row of await unpaidRenewalOrders()) {
    await finishRenewalOrder(row.order_number);
  }
}

export type ChargeOutcome = 'approved' | 'declined';

/**
 * Charges an open box invoice to the card on file and records the paid renewal
 * order with its PDFs and email. The published test cards decide every charge,
 * and a declined charge records no payment, so the invoice stays unpaid.
 */
export async function settleRenewal(
  subscription: SubscriptionRecord,
  invoiceId: string,
): Promise<ChargeOutcome> {
  const quote = await quotePlanBox(subscription.plan, subscription.province);
  const orderNumber = await reserveOrderNumber();

  const approved = chargeApproved(subscription);
  await countCardCharge(subscription.id);
  if (!approved) return 'declined';

  await payInvoice({
    accountId: subscription.killbill_account_id,
    invoiceId,
    orderNumber,
    totalCents: quote.total_cents,
  });
  if ((await findPayment(paymentKey(orderNumber))) === null) return 'declined';

  await recordRenewalOrder(subscription, invoiceId, quote, orderNumber);
  try {
    await finishRenewalOrder(orderNumber);
  } catch {
    /* file storage is unreachable: a retry finishes this order */
  }
  return 'approved';
}

/**
 * Notices each new renewal invoice Kill Bill raised, charges it, and starts
 * dunning when the charge fails. The claim is the insert, so one process does
 * each invoice exactly once.
 */
export async function chargeNewRenewalInvoices(): Promise<void> {
  for (const subscription of await listAllSubscriptions()) {
    for (const invoiceId of await listAccountInvoiceIds(subscription.killbill_account_id)) {
      const invoice = await getInvoice(invoiceId);
      if (invoice.status !== 'DRAFT') continue;
      const recurring = invoice.items.find(
        (item) => item.subscriptionId === subscription.id && item.itemType === 'RECURRING',
      );
      if (recurring === undefined || recurring.planName === null) continue;
      if (!(await claimRenewalInvoice(invoiceId, subscription.id))) continue;

      try {
        // The invoice names the plan Kill Bill is billing, which is what a
        // future-dated swap changed it to.
        await updateSubscriptionPlan(subscription.id, recurring.planName);
        const quote = await quotePlanBox(recurring.planName, subscription.province);
        await addExternalCharges({
          accountId: subscription.killbill_account_id,
          invoiceId,
          charges: boxCharges(quote),
        });
        await commitInvoice(invoiceId);
        const fresh = (await findSubscription(subscription.id))!;
        if ((await settleRenewal(fresh, invoiceId)) === 'declined') {
          await startDunning(fresh, invoiceId);
        }
      } catch (error) {
        await releaseRenewalClaim(invoiceId);
        throw error;
      }
    }
  }
}

/** Dunning day 0 is the server-clock instant at which the failed charge is recorded. */
async function startDunning(
  subscription: SubscriptionRecord,
  invoiceId: string,
): Promise<void> {
  await setRenewalState(invoiceId, 'failed', null);
  if ((await openDunningRun(subscription.id)) !== null) return;
  const run = await startDunningRun({
    subscriptionId: subscription.id,
    invoiceId,
    failedAt: new Date(),
  });
  if (await claimDunningStep(run.id, 'failed')) {
    await queueMail(dunningFailureMail(subscription));
  }
}
