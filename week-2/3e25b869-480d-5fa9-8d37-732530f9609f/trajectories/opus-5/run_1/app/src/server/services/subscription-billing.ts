import { trioPrice } from '../../shared/money.js';
import type { ProvinceCode } from '../../shared/types.js';
import { LIMITS } from '../config.js';
import { db, type Queryable } from '../db/pool.js';
import { killbill, killbillAmountToCents, type KillBillInvoice } from './killbill.js';

export type SettledInvoice = {
  invoiceId: string;
  invoiceDate: string;
  totalCents: number;
  chargedCents: number;
  paymentKey: string;
};

function isDraftFor(invoice: KillBillInvoice, subscriptionId: string): boolean {
  return (
    invoice.status === 'DRAFT' &&
    invoice.items.some(
      (item) => item.itemType === 'RECURRING' && item.subscriptionId === subscriptionId,
    )
  );
}

/**
 * Adds the province's tax items to a draft Trio invoice, commits it so Kill Bill can spend any
 * account credit, and pays whatever is left under the subscription's own dated payment key.
 */
export async function settleSubscriptionInvoice(input: {
  accountId: string;
  subscriptionNumber: string;
  invoice: KillBillInvoice;
  province: ProvinceCode;
  actor: string;
}): Promise<SettledInvoice> {
  const price = trioPrice(input.province);
  await killbill.addTaxItems(
    input.accountId,
    input.invoice.invoiceId,
    price.taxes.map((line) => ({ description: line.code, amountCents: line.amount.cents })),
    input.actor,
  );
  await killbill.commitInvoice(input.invoice.invoiceId, input.actor);
  const committed = await killbill.getInvoice(input.invoice.invoiceId, input.actor);
  const balanceCents = killbillAmountToCents(committed.balance);
  const paymentKey = `${input.subscriptionNumber}-${committed.invoiceDate}`;
  if (balanceCents > 0) {
    await killbill.payInvoice({
      accountId: input.accountId,
      invoiceId: committed.invoiceId,
      amountCents: balanceCents,
      externalKey: paymentKey,
      actor: input.actor,
    });
  }
  return {
    invoiceId: committed.invoiceId,
    invoiceDate: committed.invoiceDate,
    totalCents: killbillAmountToCents(committed.amount),
    chargedCents: balanceCents,
    paymentKey,
  };
}

export async function findDraftInvoice(
  accountId: string,
  subscriptionId: string,
  actor: string,
): Promise<KillBillInvoice | null> {
  const invoices = await killbill.accountInvoices(accountId, actor);
  return invoices.find((invoice) => isDraftFor(invoice, subscriptionId)) ?? null;
}

/**
 * Kill Bill raises the first invoice on its bus just after the subscription, so the start waits for
 * it. A real outage still fails fast, because the poll itself throws as soon as a call is refused.
 */
export async function waitForDraftInvoice(
  accountId: string,
  subscriptionId: string,
  actor: string,
): Promise<KillBillInvoice | null> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const invoice = await findDraftInvoice(accountId, subscriptionId, actor);
    if (invoice) return invoice;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

export async function recordSubscriptionInvoice(
  client: Queryable,
  subscriptionNumber: string,
  settled: SettledInvoice,
): Promise<void> {
  await client.query(
    `INSERT INTO subscription_invoices (subscription_number, killbill_invoice_id, invoice_date, total_cents, payment_key)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (subscription_number, killbill_invoice_id) DO NOTHING`,
    [subscriptionNumber, settled.invoiceId, settled.invoiceDate, settled.totalCents, settled.paymentKey],
  );
}

type PendingRow = {
  number: string;
  killbill_subscription_id: string;
  killbill_account_id: string;
  shipping: { province: ProvinceCode };
};

/** Renewals and resumes land as draft invoices; this keeps them taxed, committed and paid. */
async function settleOutstanding(): Promise<void> {
  const pending = await db.query<PendingRow>(
    `SELECT s.number, s.killbill_subscription_id, c.killbill_account_id, s.shipping
       FROM subscriptions s
       JOIN customers c ON c.id = s.customer_id
      WHERE s.state IN ('active', 'paused') AND c.killbill_account_id IS NOT NULL`,
  );
  for (const row of pending.rows) {
    try {
      const invoice = await findDraftInvoice(
        row.killbill_account_id,
        row.killbill_subscription_id,
        'loafline',
      );
      if (!invoice) continue;
      const settled = await settleSubscriptionInvoice({
        accountId: row.killbill_account_id,
        subscriptionNumber: row.number,
        invoice,
        province: row.shipping.province,
        actor: 'loafline',
      });
      await recordSubscriptionInvoice(db, row.number, settled);
    } catch {
      // Kill Bill is unreachable or the invoice moved on; the next pass tries again.
    }
  }
}

export function startSubscriptionBilling(): void {
  setInterval(() => void settleOutstanding(), LIMITS.monitorIntervalMs);
}
