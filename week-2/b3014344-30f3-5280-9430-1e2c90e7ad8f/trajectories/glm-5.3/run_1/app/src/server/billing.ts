import type { Db } from './db.js';
import type { Amount, Currency } from './money.js';
import { amountFromMinor, formatMoney } from './money.js';
import {
  authorizePayment,
  capturePayment,
  createKbAccount,
  getInvoice,
  getKbAccountPaymentMethod,
  getPaymentByKey,
  killbillHealthy,
  listAccountInvoices,
  settleInvoice,
  voidPayment,
  type KbInvoice,
} from './killbill.js';
import type { PaymentKind } from './cards.js';
import { folderMarkerKey, putObject } from './storage.js';
import { HttpError, newId, sleep } from './util.js';

export const PAY_OUTAGE_COPY = "We can't reach billing right now. Nothing was charged, and your details are still here. Try Pay again in a few minutes.";
export const QUOTE_OUTAGE_COPY = 'Live pricing is offline. Try again in a moment.';
export const PLAN_READ_OUTAGE_COPY = "Billing is unreachable, so we can't show your plan status right now.";
export const PLAN_CHANGE_OUTAGE_COPY = "Billing is unreachable, so we can't change your plan right now.";

export class BillingUnavailable extends HttpError {
  constructor(copy: string = PAY_OUTAGE_COPY) {
    super(503, 'billing_unavailable', copy);
  }
}

export class StorageUnavailable extends HttpError {
  constructor() {
    super(503, 'storage_unavailable', "We couldn't open your project folder, so the payment was cancelled and nothing was charged. Try again in a few minutes.");
  }
}

export async function ensureBillingReachable(): Promise<void> {
  if (!(await killbillHealthy())) {
    throw new BillingUnavailable();
  }
}

export interface ChargeContext {
  accountId: string;
  killbillAccountId: string;
  currency: Currency;
  cardLast4: string;
}

export async function authorizeCharge(ctx: ChargeContext, amount: Amount, paymentExternalKey: string): Promise<{ paymentId: string; paymentMethodId: string }> {
  await ensureBillingReachable();
  let paymentMethodId: string;
  try {
    paymentMethodId = await getKbAccountPaymentMethod(ctx.killbillAccountId);
  } catch {
    throw new BillingUnavailable();
  }
  try {
    await authorizePayment(ctx.killbillAccountId, paymentMethodId, amount, paymentExternalKey, `${paymentExternalKey}-auth`);
    const payment = await getPaymentByKey(paymentExternalKey);
    return { paymentId: payment.paymentId, paymentMethodId };
  } catch {
    throw new BillingUnavailable();
  }
}

export async function captureCharge(ctx: ChargeContext, payment: { paymentId: string; paymentMethodId: string }, invoiceId: string, amount: Amount, paymentExternalKey: string): Promise<void> {
  try {
    await capturePayment(payment.paymentId, payment.paymentMethodId, amount, `${paymentExternalKey}-cap`);
  } catch {
    await voidPayment(payment.paymentId, payment.paymentMethodId, amount, `${paymentExternalKey}-void`).catch(() => undefined);
    throw new BillingUnavailable();
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await settleInvoice(invoiceId, ctx.killbillAccountId, payment.paymentMethodId, amount, `${paymentExternalKey}-settle`, `${paymentExternalKey}-settle-t`);
      return;
    } catch {
      await sleep(500);
    }
  }
}

export async function voidAuthorization(_ctx: ChargeContext, payment: { paymentId: string; paymentMethodId: string }, amount: Amount, paymentExternalKey: string): Promise<void> {
  await voidPayment(payment.paymentId, payment.paymentMethodId, amount, `${paymentExternalKey}-void`).catch(() => undefined);
}

/** Authorize, capture and settle one charge on an invoice in a single pass. */
export async function chargeInvoice(ctx: ChargeContext, invoiceId: string, amount: Amount, paymentExternalKey: string): Promise<{ killbillPaymentId: string }> {
  const auth = await authorizeCharge(ctx, amount, paymentExternalKey);
  await captureCharge(ctx, auth, invoiceId, amount, paymentExternalKey);
  return { killbillPaymentId: auth.paymentId };
}

export async function invoiceOpenAmount(invoiceId: string): Promise<{ invoice: KbInvoice; openAmount: Amount | null }> {
  const invoice = await getInvoice(invoiceId);
  if (invoice.currency !== 'USD' && invoice.currency !== 'ARS') throw new BillingUnavailable();
  const open = Math.round(invoice.balance * 100);
  return { invoice, openAmount: amountFromMinor(invoice.currency as Currency, BigInt(open)) };
}

export async function createFolderMarker(orderId: string): Promise<void> {
  try {
    await putObject(folderMarkerKey(orderId), Buffer.alloc(0), 'application/octet-stream');
  } catch {
    throw new StorageUnavailable();
  }
}

export async function ensureKillbillAccount(db: Db, accountId: string, businessName: string, ownerEmail: string, currency: Currency): Promise<string> {
  const result = await db.query('SELECT killbill_account_id FROM accounts WHERE id = $1', [accountId]);
  const existing = (result.rows[0] as { killbill_account_id: string | null } | undefined)?.killbill_account_id ?? null;
  if (existing) return existing;
  const killbillAccountId = await createKbAccount({
    name: businessName,
    email: ownerEmail,
    currency,
    externalKey: `pampero-${accountId}`,
  });
  await db.query('UPDATE accounts SET killbill_account_id = $1 WHERE id = $2', [killbillAccountId, accountId]);
  return killbillAccountId;
}

/** Wait until Kill Bill holds an invoice for a fresh subscription (first period). */
export async function waitForFirstInvoice(killbillAccountId: string, subscriptionId: string, timeoutMs: number): Promise<KbInvoice> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const invoices = await listAccountInvoices(killbillAccountId);
    const found = invoices.find((inv) => inv.items.some((item) => item.subscriptionId === subscriptionId));
    if (found) return found;
    await sleep(500);
  }
  throw new BillingUnavailable();
}

export async function findChangeInvoice(killbillAccountId: string, subscriptionId: string, since: Date): Promise<KbInvoice | null> {
  const invoices = await listAccountInvoices(killbillAccountId);
  return (
    invoices.find(
      (inv) =>
        new Date(`${inv.targetDate}T00:00:00Z`).getTime() >= since.getTime() - 86_400_000 &&
        inv.items.some((item) => item.itemType === 'REPAIR_ADJ') &&
        inv.items.some((item) => item.itemType === 'RECURRING' && item.subscriptionId === subscriptionId),
    ) ?? null
  );
}

export function invoiceAmounts(invoice: KbInvoice): { amount: Amount; balance: Amount; credit: Amount | null } {
  const currency = invoice.currency as Currency;
  const amount = amountFromMinor(currency, BigInt(Math.round(invoice.amount * 100)));
  const balance = amountFromMinor(currency, BigInt(Math.round(invoice.balance * 100)));
  const repair = invoice.items.find((item) => item.itemType === 'REPAIR_ADJ');
  const recurring = invoice.items.find((item) => item.itemType === 'RECURRING');
  if (repair && recurring) {
    return {
      amount,
      balance,
      credit: amountFromMinor(currency, BigInt(Math.round(repair.amount * 100))),
    };
  }
  return { amount, balance, credit: null };
}

export interface QueuedEmail {
  to: string;
  subject: string;
  body: string;
}

export async function queueEmail(db: Db, email: QueuedEmail): Promise<void> {
  await db.query('INSERT INTO mail_queue (id, to_email, subject, body, created_at) VALUES ($1, $2, $3, $4, now())', [
    newId(),
    email.to,
    email.subject,
    email.body,
  ]);
}

export function receiptEmail(orderNumber: string, kind: PaymentKind, amount: Amount, receiptPath: string): QueuedEmail {
  return {
    to: '',
    subject: `Receipt ${orderNumber}: ${formatMoney(amount)}`,
    body: [
      `Receipt for ${orderNumber}`,
      ``,
      `Payment kind: ${kind === 'deposit' ? 'Deposit' : kind === 'balance' ? 'Launch balance' : kind === 'care' ? 'Care plan' : kind === 'change' ? 'Plan change' : 'Renewal'}`,
      `Amount: ${formatMoney(amount)}`,
      ``,
      `View your receipt: ${receiptPath}`,
    ].join('\n'),
  };
}

export function orderReceiptPath(orderId: string): string {
  return `/orders/${orderId}/receipt`;
}

export async function recordInvoice(db: Db, input: {
  invoiceId: string;
  accountId: string;
  orderId: string | null;
  kind: 'deposit' | 'balance' | 'care' | 'change' | 'renewal';
}): Promise<void> {
  await db.query(
    `INSERT INTO invoice_records (invoice_id, account_id, order_id, kind, created_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (invoice_id) DO NOTHING`,
    [input.invoiceId, input.accountId, input.orderId, input.kind],
  );
}

export function openAmountOf(invoice: KbInvoice): Amount | null {
  const open = Math.round(invoice.balance * 100);
  if (open <= 0) return null;
  return amountFromMinor(invoice.currency as Currency, BigInt(open));
}

export async function listAccountInvoicesSafe(killbillAccountId: string): Promise<KbInvoice[]> {
  try {
    return await listAccountInvoices(killbillAccountId);
  } catch {
    throw new BillingUnavailable();
  }
}

export async function invoiceHasBeenNoticed(db: Db, invoiceId: string): Promise<boolean> {
  const result = await db.query('SELECT noticed_at FROM invoice_records WHERE invoice_id = $1', [invoiceId]);
  const row = result.rows[0] as { noticed_at: Date | null } | undefined;
  return row?.noticed_at != null;
}

export async function markInvoiceNoticed(db: Db, invoiceId: string): Promise<void> {
  await db.query('UPDATE invoice_records SET noticed_at = now() WHERE invoice_id = $1', [invoiceId]);
}

