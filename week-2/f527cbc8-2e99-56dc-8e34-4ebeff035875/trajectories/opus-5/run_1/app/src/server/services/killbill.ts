import { config, limits } from '../config.js';
import { withTimeout } from '../util.js';

/**
 * Kill Bill holds one billing account per horse owner. Every step here first reads
 * Kill Bill and adopts what already exists — invoices by the marker in their item
 * descriptions, payments by their external key — so a retry after a crash or an
 * outage never doubles a charge.
 */
export class KillBillUnavailable extends Error {
  constructor(cause?: unknown) {
    super('billing is unreachable');
    this.name = 'KillBillUnavailable';
    this.cause = cause;
  }
}

function headers(): Record<string, string> {
  const basic = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64');
  return {
    authorization: `Basic ${basic}`,
    'X-Killbill-ApiKey': config.killbill.apiKey,
    'X-Killbill-ApiSecret': config.killbill.apiSecret,
    'X-Killbill-CreatedBy': 'clinchline',
    'content-type': 'application/json',
    accept: 'application/json',
  };
}

interface KillBillResponse {
  status: number;
  location: string | null;
  body: unknown;
}

/** A call that fails to connect, takes longer than 5 seconds or answers 5xx means unreachable. */
async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<KillBillResponse> {
  let response: Response;
  try {
    response = await withTimeout(limits.providerTimeoutMs, (signal) =>
      fetch(`${config.killbill.url}${path}`, {
        method,
        headers: headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      }),
    );
  } catch (error) {
    throw new KillBillUnavailable(error);
  }
  if (response.status >= 500) {
    await response.text();
    throw new KillBillUnavailable(`${method} ${path} answered ${response.status}`);
  }
  const text = await response.text();
  let parsed: unknown = null;
  if (text !== '') {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: response.status, location: response.headers.get('location'), body: parsed };
}

function cents(amount: number): number {
  return Math.round(amount * 100);
}

function dollarsOf(amountCents: number): number {
  return Number((amountCents / 100).toFixed(2));
}

function idFromLocation(location: string | null): string | null {
  if (location === null) return null;
  const parts = location.replace(/\/$/, '').split('/');
  return parts[parts.length - 1] ?? null;
}

export interface KillBillTransaction {
  type: string;
  externalKey: string;
  amountCents: number;
  status: string;
}

export interface KillBillPayment {
  paymentId: string;
  externalKey: string;
  purchasedCents: number;
  creditedCents: number;
  transactions: KillBillTransaction[];
}

export interface KillBillInvoice {
  invoiceId: string;
  amountCents: number;
  balanceCents: number;
  items: { invoiceItemId: string; description: string; amountCents: number }[];
}

interface RawTransaction {
  transactionType?: string;
  transactionExternalKey?: string;
  amount?: number;
  status?: string;
}

interface RawPayment {
  paymentId?: string;
  paymentExternalKey?: string;
  purchasedAmount?: number;
  creditedAmount?: number;
  transactions?: RawTransaction[];
}

interface RawInvoice {
  invoiceId?: string;
  amount?: number;
  balance?: number;
  items?: { invoiceItemId?: string; description?: string; amount?: number }[];
}

function toPayment(raw: RawPayment): KillBillPayment {
  return {
    paymentId: raw.paymentId ?? '',
    externalKey: raw.paymentExternalKey ?? '',
    purchasedCents: cents(raw.purchasedAmount ?? 0),
    creditedCents: cents(raw.creditedAmount ?? 0),
    transactions: (raw.transactions ?? []).map((transaction) => ({
      type: transaction.transactionType ?? '',
      externalKey: transaction.transactionExternalKey ?? '',
      amountCents: cents(transaction.amount ?? 0),
      status: transaction.status ?? '',
    })),
  };
}

function toInvoice(raw: RawInvoice): KillBillInvoice {
  return {
    invoiceId: raw.invoiceId ?? '',
    amountCents: cents(raw.amount ?? 0),
    balanceCents: cents(raw.balance ?? 0),
    items: (raw.items ?? []).map((item) => ({
      invoiceItemId: item.invoiceItemId ?? '',
      description: item.description ?? '',
      amountCents: cents(item.amount ?? 0),
    })),
  };
}

/** One account per owner, with external key equal to the owner's email. Created once. */
export async function ensureAccount(email: string, name: string): Promise<string> {
  const found = await findAccount(email);
  if (found !== null) return found;
  const created = await call('POST', '/1.0/kb/accounts', {
    externalKey: email,
    name,
    currency: 'USD',
  });
  const id = idFromLocation(created.location);
  if (created.status === 201 && id !== null) return id;
  // Another instance created it first.
  const second = await findAccount(email);
  if (second !== null) return second;
  throw new KillBillUnavailable(`account for ${email} could not be created`);
}

export async function findAccount(email: string): Promise<string | null> {
  const response = await call('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(email)}`);
  if (response.status === 404) return null;
  const raw = response.body as { accountId?: string } | null;
  return raw?.accountId ?? null;
}

export async function accountInvoices(accountId: string): Promise<KillBillInvoice[]> {
  const response = await call('GET', `/1.0/kb/accounts/${accountId}/invoices`);
  if (response.status === 404) return [];
  const raw = (response.body ?? []) as RawInvoice[];
  return raw.map(toInvoice);
}

export async function readInvoice(invoiceId: string): Promise<KillBillInvoice | null> {
  const response = await call('GET', `/1.0/kb/invoices/${invoiceId}`);
  if (response.status === 404) return null;
  return toInvoice(response.body as RawInvoice);
}

/**
 * The app's invoice id travels in every charge description as ` [<invoice id>]`, so a
 * retry finds the invoice its charges already made.
 */
export async function findInvoiceByMarker(accountId: string, marker: string): Promise<KillBillInvoice | null> {
  const invoices = await accountInvoices(accountId);
  for (const invoice of invoices) {
    if (invoice.items.some((item) => item.description.includes(marker))) {
      return (await readInvoice(invoice.invoiceId)) ?? invoice;
    }
  }
  return null;
}

export interface ChargeItem {
  description: string;
  amountCents: number;
}

export async function createCharges(
  accountId: string,
  items: readonly ChargeItem[],
): Promise<KillBillInvoice> {
  const response = await call('POST', `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`, items.map(
    (item) => ({
      accountId,
      amount: dollarsOf(item.amountCents),
      currency: 'USD',
      description: item.description,
    }),
  ));
  if (response.status !== 200 && response.status !== 201) {
    throw new KillBillUnavailable(`charges answered ${response.status}`);
  }
  const created = (response.body ?? []) as { invoiceId?: string }[];
  const invoiceId = created[0]?.invoiceId;
  if (invoiceId === undefined) throw new KillBillUnavailable('charges returned no invoice');
  const invoice = await readInvoice(invoiceId);
  if (invoice === null) throw new KillBillUnavailable('charged invoice could not be read');
  return invoice;
}

export async function findPaymentByExternalKey(externalKey: string): Promise<KillBillPayment | null> {
  const response = await call('GET', `/1.0/kb/payments?externalKey=${encodeURIComponent(externalKey)}`);
  if (response.status === 404) return null;
  const raw = response.body as RawPayment | null;
  if (raw === null || raw.paymentId === undefined) return null;
  return toPayment(raw);
}

export async function accountPayments(accountId: string): Promise<KillBillPayment[]> {
  const response = await call('GET', `/1.0/kb/accounts/${accountId}/payments`);
  if (response.status === 404) return [];
  const raw = (response.body ?? []) as RawPayment[];
  return raw.map(toPayment);
}

export async function invoicePayments(invoiceId: string): Promise<KillBillPayment[]> {
  const response = await call('GET', `/1.0/kb/invoices/${invoiceId}/payments`);
  if (response.status === 404) return [];
  const raw = (response.body ?? []) as RawPayment[];
  return raw.map(toPayment);
}

/**
 * An external payment against a Kill Bill invoice, carrying the published external key
 * so a retry adopts it instead of paying twice.
 */
export async function createExternalPayment(
  accountId: string,
  invoiceId: string,
  amountCents: number,
  externalKey: string,
): Promise<KillBillPayment> {
  const existing = await findPaymentByExternalKey(externalKey);
  if (existing !== null) return existing;
  const response = await call(
    'POST',
    `/1.0/kb/invoices/${invoiceId}/payments?externalPayment=true`,
    {
      targetInvoiceId: invoiceId,
      accountId,
      purchasedAmount: dollarsOf(amountCents),
      currency: 'USD',
      paymentExternalKey: externalKey,
    },
  );
  if (response.status !== 201 && response.status !== 200) {
    const adopted = await findPaymentByExternalKey(externalKey);
    if (adopted !== null) return adopted;
    throw new KillBillUnavailable(`invoice payment answered ${response.status}`);
  }
  const payment = await findPaymentByExternalKey(externalKey);
  if (payment === null) throw new KillBillUnavailable('invoice payment could not be read back');
  return payment;
}

/** A refund is one CREDIT transaction carrying the app's refund id as its external key. */
export async function findRefundTransaction(
  accountId: string,
  transactionExternalKey: string,
): Promise<KillBillTransaction | null> {
  const payments = await accountPayments(accountId);
  for (const payment of payments) {
    const found = payment.transactions.find(
      (transaction) => transaction.externalKey === transactionExternalKey,
    );
    if (found !== undefined) return found;
  }
  return null;
}

export async function createRefund(
  accountId: string,
  killbillPaymentId: string,
  amountCents: number,
  transactionExternalKey: string,
  adjustments: readonly { invoiceItemId: string; amountCents: number }[],
): Promise<void> {
  const existing = await findRefundTransaction(accountId, transactionExternalKey);
  if (existing !== null) return;
  const response = await call(
    'POST',
    `/1.0/kb/invoicePayments/${killbillPaymentId}/refunds?externalPayment=true`,
    {
      paymentId: killbillPaymentId,
      amount: dollarsOf(amountCents),
      currency: 'USD',
      transactionExternalKey,
      isAdjusted: adjustments.length > 0,
      adjustments: adjustments.map((adjustment) => ({
        invoiceItemId: adjustment.invoiceItemId,
        amount: dollarsOf(adjustment.amountCents),
      })),
    },
  );
  if (response.status !== 201 && response.status !== 200) {
    const adopted = await findRefundTransaction(accountId, transactionExternalKey);
    if (adopted !== null) return;
    throw new KillBillUnavailable(`refund answered ${response.status}`);
  }
}

export async function billingHealthy(timeoutMs: number): Promise<boolean> {
  try {
    const response = await withTimeout(timeoutMs, (signal) =>
      fetch(`${config.killbill.url}/1.0/healthcheck`, { signal }),
    );
    await response.text();
    return response.ok;
  } catch {
    return false;
  }
}
