import type { Locale } from '../../shared/money.ts';
import { env } from '../env.ts';
import { ApiError } from '../http/errors.ts';
import { setBilling } from '../services.ts';
import { CATALOG_XML, PLAN_NAMES } from './catalog.ts';

const TIMEOUT_MS = 10000;

export type KbInvoiceItem = { type: string; description: string; amount_cents: number };
export type KbInvoice = {
  invoice_id: string;
  amount_cents: number;
  credit_applied_cents: number;
  balance_cents: number;
  items: KbInvoiceItem[];
  invoice_date: string;
};
export type KbTransaction = {
  type: string;
  status: string;
  amount_cents: number;
  effective_date: string;
};
export type KbPayment = { payment_id: string; transactions: KbTransaction[] };

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${env.killbill.username}:${env.killbill.password}`).toString('base64')}`,
    'X-Killbill-ApiKey': env.killbill.apiKey,
    'X-Killbill-ApiSecret': env.killbill.apiSecret,
    'X-Killbill-CreatedBy': 'halide-box-office',
  };
}

function centsOf(value: unknown): number {
  return Math.round(Number(value ?? 0) * 100);
}

function amountOf(cents: number): number {
  return Number(`${Math.trunc(cents / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`);
}

type CallResult = { status: number; location: string | null; body: unknown };

async function call(
  method: string,
  path: string,
  body?: unknown,
  contentType = 'application/json',
): Promise<CallResult> {
  let response: Response;
  try {
    response = await fetch(`${env.killbill.url}${path}`, {
      method,
      headers: { ...authHeaders(), 'Content-Type': contentType },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    setBilling('down');
    throw new ApiError('billing_unavailable');
  }
  const text = await response.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (response.status >= 500) {
    setBilling('down');
    throw new ApiError('billing_unavailable');
  }
  setBilling('up');
  return { status: response.status, location: response.headers.get('location'), body: parsed };
}

async function expect(method: string, path: string, body?: unknown): Promise<CallResult> {
  const result = await call(method, path, body);
  if (result.status >= 400) throw new ApiError('billing_unavailable');
  return result;
}

function idFromLocation(location: string | null): string {
  const parts = (location ?? '').split('/').filter((part) => part !== '');
  return parts[parts.length - 1] ?? '';
}

export async function probeBilling(): Promise<void> {
  try {
    const response = await fetch(`${env.killbill.url}/1.0/kb/healthcheck`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    setBilling(response.status < 500 ? 'up' : 'down');
  } catch {
    setBilling('down');
  }
}

export async function ensureCatalogUploaded(): Promise<boolean> {
  const current = await call('GET', '/1.0/kb/catalog');
  const names = JSON.stringify(current.body ?? '');
  if (PLAN_NAMES.every((plan) => names.includes(`"${plan}"`))) return true;
  const upload = await call('POST', '/1.0/kb/catalog/xml', CATALOG_XML, 'text/xml');
  return upload.status < 300;
}

export async function findAccountByExternalKey(externalKey: string): Promise<string | null> {
  const result = await call('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  if (result.status === 404) return null;
  if (result.status >= 400) throw new ApiError('billing_unavailable');
  const account = result.body as { accountId?: string } | null;
  return account?.accountId ?? null;
}

export async function createAccount(input: {
  externalKey: string;
  name: string;
  email: string;
  locale: Locale;
}): Promise<string> {
  const existing = await findAccountByExternalKey(input.externalKey);
  if (existing !== null) return existing;
  const created = await expect('POST', '/1.0/kb/accounts', {
    externalKey: input.externalKey,
    name: input.name,
    email: input.email,
    currency: 'CAD',
    locale: input.locale === 'fr' ? 'fr_CA' : 'en_CA',
    timeZone: 'America/Toronto',
  });
  const accountId = idFromLocation(created.location);
  await expect('POST', `/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`, {
    pluginName: '__EXTERNAL_PAYMENT__',
    pluginInfo: {},
  });
  return accountId;
}

function readInvoice(body: unknown): KbInvoice {
  const invoice = body as {
    invoiceId: string;
    amount: number;
    balance: number;
    invoiceDate: string;
    items: Array<{ itemType: string; description: string | null; amount: number }>;
  };
  const items = invoice.items.map((item) => ({
    type: item.itemType,
    description: item.description ?? '',
    amount_cents: centsOf(item.amount),
  }));
  const creditApplied = items
    .filter((item) => item.type === 'CBA_ADJ' && item.amount_cents < 0)
    .reduce((sum, item) => sum - item.amount_cents, 0);
  return {
    invoice_id: invoice.invoiceId,
    amount_cents: centsOf(invoice.amount),
    credit_applied_cents: creditApplied,
    balance_cents: centsOf(invoice.balance),
    items,
    invoice_date: invoice.invoiceDate,
  };
}

export async function getInvoice(invoiceId: string): Promise<KbInvoice> {
  const result = await expect('GET', `/1.0/kb/invoices/${invoiceId}?withItems=true`);
  return readInvoice(result.body);
}

export async function listInvoiceIds(kbAccountId: string): Promise<string[]> {
  const result = await expect('GET', `/1.0/kb/accounts/${kbAccountId}/invoices`);
  return (result.body as Array<{ invoiceId: string }>).map((invoice) => invoice.invoiceId);
}


export type ChargeInput = { description: string; amount_cents: number };

export async function createChargeInvoice(
  kbAccountId: string,
  charges: ChargeInput[],
  taxes: ChargeInput[],
): Promise<KbInvoice> {
  const created = await expect('POST', `/1.0/kb/invoices/charges/${kbAccountId}?autoCommit=false`, 
    charges.map((charge) => ({
      accountId: kbAccountId,
      amount: amountOf(charge.amount_cents),
      currency: 'CAD',
      description: charge.description,
    })),
  );
  const items = created.body as Array<{ invoiceId: string }>;
  const invoiceId = items[0]?.invoiceId;
  if (invoiceId === undefined) throw new ApiError('billing_unavailable');
  if (taxes.length > 0) {
    await expect('POST', `/1.0/kb/invoices/taxes/${kbAccountId}?autoCommit=false`, 
      taxes.map((tax) => ({
        accountId: kbAccountId,
        invoiceId,
        amount: amountOf(tax.amount_cents),
        currency: 'CAD',
        description: tax.description,
      })),
    );
  }
  await expect('PUT', `/1.0/kb/invoices/${invoiceId}/commitInvoice`, {});
  return getInvoice(invoiceId);
}

export async function voidInvoice(invoiceId: string): Promise<void> {
  await call('PUT', `/1.0/kb/invoices/${invoiceId}/voidInvoice`, {});
}

export async function payInvoice(kbAccountId: string, invoiceId: string, cents: number): Promise<string> {
  await expect('POST', `/1.0/kb/invoices/${invoiceId}/payments?externalPayment=false`, {
    accountId: kbAccountId,
    targetInvoiceId: invoiceId,
    purchasedAmount: amountOf(cents),
  });
  const payments = await listPayments(kbAccountId);
  const match = payments.find((payment) =>
    payment.transactions.some(
      (transaction) =>
        transaction.type === 'PURCHASE' && transaction.status === 'SUCCESS' && transaction.amount_cents === cents,
    ),
  );
  const paymentId = match?.payment_id;
  if (paymentId === undefined) throw new ApiError('billing_unavailable');
  return paymentId;
}

export async function listPayments(kbAccountId: string): Promise<KbPayment[]> {
  const result = await expect('GET', `/1.0/kb/accounts/${kbAccountId}/payments`);
  return (result.body as Array<{
    paymentId: string;
    transactions: Array<{ transactionType: string; status: string; amount: number; effectiveDate: string }>;
  }>).map((payment) => ({
    payment_id: payment.paymentId,
    transactions: payment.transactions.map((transaction) => ({
      type: transaction.transactionType,
      status: transaction.status,
      amount_cents: centsOf(transaction.amount),
      effective_date: transaction.effectiveDate,
    })),
  }));
}

export async function refundPayment(paymentId: string, cents: number): Promise<void> {
  await expect('POST', `/1.0/kb/payments/${paymentId}/refunds`, {
    paymentId,
    amount: amountOf(cents),
  });
}

export async function addAccountCredit(kbAccountId: string, cents: number, description: string): Promise<void> {
  await expect('POST', '/1.0/kb/credits?autoCommit=true', [
    { accountId: kbAccountId, amount: amountOf(cents), currency: 'CAD', description },
  ]);
}


export type KbSubscription = {
  subscription_id: string;
  plan_name: string;
  start_date: string;
  charged_through: string | null;
  events: Array<{ type: string; effective_date: string; plan: string | null }>;
};

function readSubscription(body: unknown): KbSubscription {
  const subscription = body as {
    subscriptionId: string;
    planName: string;
    startDate: string;
    chargedThroughDate: string | null;
    events?: Array<{ eventType: string; effectiveDate: string; plan: string | null }>;
  };
  return {
    subscription_id: subscription.subscriptionId,
    plan_name: subscription.planName,
    start_date: subscription.startDate,
    charged_through: subscription.chargedThroughDate,
    events: (subscription.events ?? []).map((event) => ({
      type: event.eventType,
      effective_date: event.effectiveDate,
      plan: event.plan,
    })),
  };
}

export async function getSubscription(subscriptionId: string): Promise<KbSubscription> {
  const result = await expect('GET', `/1.0/kb/subscriptions/${subscriptionId}`);
  return readSubscription(result.body);
}

export async function createSubscription(kbAccountId: string, planName: string): Promise<string> {
  const created = await expect('POST', '/1.0/kb/subscriptions?callCompletion=true&callTimeoutSec=8', {
    accountId: kbAccountId,
    planName,
  });
  return idFromLocation(created.location);
}

export async function changeSubscription(
  subscriptionId: string,
  planName: string,
  policy: 'IMMEDIATE' | 'END_OF_TERM',
): Promise<void> {
  await expect(
    'PUT',
    `/1.0/kb/subscriptions/${subscriptionId}?billingPolicy=${policy}&callCompletion=true&callTimeoutSec=8`,
    { subscriptionId, planName },
  );
}

/** Waits for Kill Bill's asynchronous invoicing to produce an invoice not already known. */
export async function waitForNewInvoice(kbAccountId: string, known: Set<string>): Promise<KbInvoice | null> {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const ids = await listInvoiceIds(kbAccountId);
    const fresh = ids.find((id) => !known.has(id));
    if (fresh !== undefined) return getInvoice(fresh);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

export async function payOpenBalance(kbAccountId: string, invoice: KbInvoice): Promise<string | null> {
  if (invoice.balance_cents <= 0) return null;
  return payInvoice(kbAccountId, invoice.invoice_id, invoice.balance_cents);
}
