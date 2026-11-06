import { withClient } from '../db.js';
import { databaseName } from '../env.js';
import * as kb from '../services/killbill.js';
import * as ordersDomain from './orders.js';
import * as subsDomain from './subscriptions.js';
import type { SubscriptionRow } from './subscriptions.js';
import * as emails from './emails.js';
import { quoteFor } from './quote.js';
import { chargeApproved, markCardUsed, type StoredCard } from './card.js';
import { subscriptionEmail } from './dunning.js';

/** Charges the open box invoice and creates the paid renewal order for it. */
export async function chargeBoxInvoice(
  row: SubscriptionRow,
  invoiceId: string,
  card: StoredCard
): Promise<{ approved: boolean; orderNumber: string | null }> {
  const approved = chargeApproved(card);
  markCardUsed(card);
  await withClient(async (client) => {
    await client.query('update subscriptions set card = $2 where id = $1', [row.id, JSON.stringify(card)]);
  });
  if (!approved) return { approved: false, orderNumber: null };
  const boxQuote = await boxQuoteFor(row);
  const orderNumber = await withClient(async (client) => ordersDomain.nextOrderNumber(client));
  if (invoiceId) {
    const invoice = await kb.getInvoice(invoiceId);
    if (invoice.balance > 0) {
      const paymentMethodId = await kb.ensurePaymentMethod(row.kb_account_id);
      await kb.invoicePurchase(row.kb_account_id, paymentMethodId, invoiceId, boxQuote.total_cents, `${databaseName()}/${orderNumber}`);
    }
  }
  await createRenewalOrder(row, boxQuote, invoiceId, card, orderNumber);
  return { approved: true, orderNumber };
}

export async function boxQuoteFor(row: { plan: string; address: { province: string } }) {
  const plan = subsDomain.getPlan(row.plan);
  if (!plan) throw new Error('unknown plan');
  return withClient((client) =>
    quoteFor(client, {
      province: row.address.province,
      subscribe: true,
      cans: Object.entries(plan.flavourBox).map(([flavour, quantity]) => ({ flavour, quantity })),
    })
  );
}

async function createRenewalOrder(
  row: SubscriptionRow,
  boxQuote: Awaited<ReturnType<typeof boxQuoteFor>>,
  invoiceId: string,
  card: StoredCard,
  orderNumber: string
): Promise<void> {
  const email = (await subscriptionEmail(row.id)) ?? '';
  const order = await withClient(async (client) => {
    const orderRow = await ordersDomain.insertOrder(client, {
      number: orderNumber,
      user_id: row.user_id,
      province: row.address.province,
      subscription_id: row.id,
      lines: boxQuote.lines,
      goods_cents: boxQuote.goods_cents,
      discount_cents: boxQuote.discount_cents,
      discounted_goods_cents: boxQuote.discounted_goods_cents,
      shipping_cents: boxQuote.shipping_cents,
      deposit_cents: boxQuote.deposit_cents,
      taxes: boxQuote.taxes,
      total_cents: boxQuote.total_cents,
      ship_to: row.address,
      card: { brand: card.brand, last4: card.last4 },
      kb_account_id: row.kb_account_id,
      kb_invoice_id: invoiceId,
      email,
    });
    await client.query("update orders set status = 'paid' where number = $1", [orderNumber]);
    return orderRow;
  });
  await ordersDomain.writeOrderPdfs(order);
  await emails.queueRenewalPaid({ number: orderNumber, email: order.email, total_cents: order.total_cents });
}

/**
 * Builds the box invoice for a cycle: completes a draft cycle invoice with the
 * missing deposit, shipping and tax items, or creates a standalone charges invoice
 * carrying the whole box. Returns the invoice id to charge.
 */
export async function buildBoxInvoice(
  row: SubscriptionRow,
  cycleDate: string
): Promise<string> {
  const boxQuote = await boxQuoteFor(row);
  const boxTotal = boxQuote.total_cents;
  const invoices = await kb.getInvoices(row.kb_account_id);
  const cycleInvoice = invoices.find((i) => i.targetDate === cycleDate);
  if (cycleInvoice && cycleInvoice.status === 'DRAFT') {
    const refreshed = await kb.getInvoice(cycleInvoice.invoiceId);
    const invoiceCents = Math.round(refreshed.amount * 100);
    const missing = boxTotal - invoiceCents;
    if (missing > 0) {
      const chargeItems: { amount: number; description: string }[] = [];
      const planCharge = boxQuote.discounted_goods_cents - invoiceCents;
      if (planCharge > 0) {
        chargeItems.push({ amount: planCharge, description: `${subsDomain.getPlan(row.plan)!.label} (plan charge)` });
      }
      chargeItems.push({ amount: boxQuote.deposit_cents, description: 'Deposit for 12 cans' });
      if (boxQuote.shipping_cents > 0) {
        chargeItems.push({ amount: boxQuote.shipping_cents, description: 'Shipping' });
      }
      for (const tax of boxQuote.taxes) {
        chargeItems.push({ amount: tax.cents, description: `${tax.name} (${tax.rate}%)` });
      }
      await kb.addCharges(row.kb_account_id, chargeItems, cycleInvoice.invoiceId);
    }
    await kb.commitInvoice(cycleInvoice.invoiceId);
    return cycleInvoice.invoiceId;
  }
  if (cycleInvoice && cycleInvoice.status !== 'DRAFT' && Math.round(cycleInvoice.amount * 100) >= boxTotal) {
    return cycleInvoice.invoiceId;
  }
  // Standalone charges invoice carrying the whole box.
  const chargeItems: { amount: number; description: string }[] = [
    { amount: boxQuote.discounted_goods_cents, description: `${subsDomain.getPlan(row.plan)!.label} (plan charge)` },
    { amount: boxQuote.deposit_cents, description: 'Deposit for 12 cans' },
  ];
  if (boxQuote.shipping_cents > 0) {
    chargeItems.push({ amount: boxQuote.shipping_cents, description: 'Shipping' });
  }
  for (const tax of boxQuote.taxes) {
    chargeItems.push({ amount: tax.cents, description: `${tax.name} (${tax.rate}%)` });
  }
  const items = await kb.addCharges(row.kb_account_id, chargeItems);
  const invoiceId = items[0]?.invoiceId ?? null;
  if (!invoiceId) throw new Error('charges invoice missing');
  await kb.commitInvoice(invoiceId);
  return invoiceId;
}
