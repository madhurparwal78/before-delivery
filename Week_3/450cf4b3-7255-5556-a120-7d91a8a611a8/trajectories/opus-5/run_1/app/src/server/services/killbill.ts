import { config } from '../config';
import { formatMoney } from '../../shared/format';

export class BillingUnavailableError extends Error {
  constructor() {
    super('billing unavailable');
    this.name = 'BillingUnavailableError';
  }
}

interface KillBillResponse {
  status: number;
  location: string | null;
  text: string;
}

function headers(): Record<string, string> {
  const basic = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64');
  return {
    authorization: `Basic ${basic}`,
    'x-killbill-apikey': config.killbill.apiKey,
    'x-killbill-apisecret': config.killbill.apiSecret,
    'x-killbill-createdby': 'stationhouse',
    'content-type': 'application/json',
    accept: 'application/json',
  };
}

async function call(method: string, path: string, body?: unknown): Promise<KillBillResponse> {
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}${path}`, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new BillingUnavailableError();
  }
  const text = await response.text().catch(() => '');
  if (response.status >= 400 && response.status !== 404) {
    process.stderr.write(`kill bill ${method} ${path} answered ${response.status}: ${text.slice(0, 200)}\n`);
  }
  return { status: response.status, location: response.headers.get('location'), text };
}

/** Reads tolerate one hiccup; nothing that could charge twice is ever retried. */
async function read(path: string): Promise<KillBillResponse> {
  try {
    return await call('GET', path);
  } catch (error) {
    if (!(error instanceof BillingUnavailableError)) throw error;
    return call('GET', path);
  }
}

function parse<T>(response: KillBillResponse): T {
  try {
    return JSON.parse(response.text) as T;
  } catch {
    throw new BillingUnavailableError();
  }
}

function idFromLocation(location: string | null): string {
  if (location === null) throw new BillingUnavailableError();
  const parts = location.replace(/\/+$/, '').split('/');
  const id = parts[parts.length - 1];
  if (id === undefined || id === '') throw new BillingUnavailableError();
  return id;
}

export interface KillBillAccount {
  accountId: string;
}

export function accountExternalKey(tenantId: string): string {
  return `stationhouse-${tenantId}`;
}

export async function findAccount(tenantId: string): Promise<KillBillAccount | null> {
  const response = await read(
    `/1.0/kb/accounts?externalKey=${encodeURIComponent(accountExternalKey(tenantId))}`,
  );
  if (response.status === 404) return null;
  if (response.status !== 200) throw new BillingUnavailableError();
  const account = parse<{ accountId?: string }>(response);
  return account.accountId === undefined ? null : { accountId: account.accountId };
}

export async function createAccount(
  tenantId: string,
  businessName: string,
  email: string,
): Promise<KillBillAccount> {
  const response = await call('POST', '/1.0/kb/accounts', {
    externalKey: accountExternalKey(tenantId),
    name: businessName,
    email,
    currency: 'USD',
  });
  if (response.status !== 201) throw new BillingUnavailableError();
  const accountId = idFromLocation(response.location);
  const method = await call(
    'POST',
    `/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`,
    {
      pluginName: '__EXTERNAL_PAYMENT__',
      pluginInfo: {},
      externalKey: `${accountExternalKey(tenantId)}-external`,
    },
  );
  if (method.status !== 201) throw new BillingUnavailableError();
  return { accountId };
}

export async function createPackInvoice(
  accountId: string,
  hours: number,
  priceCents: number,
): Promise<string> {
  const response = await call('POST', `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`, [
    {
      accountId,
      amount: Number(formatMoney(priceCents)),
      currency: 'USD',
      description: `Stationhouse ${hours}-hour pack`,
    },
  ]);
  if (response.status !== 200 && response.status !== 201) throw new BillingUnavailableError();
  const items = parse<Array<{ invoiceId?: string }>>(response);
  const invoiceId = items[0]?.invoiceId;
  if (invoiceId === undefined) throw new BillingUnavailableError();
  return invoiceId;
}

export interface KillBillPayment {
  paymentId: string;
  purchasedCents: number;
  refundedCents: number;
}

function paymentOf(payment: {
  paymentId?: string;
  purchasedAmount?: number;
  refundedAmount?: number;
}): KillBillPayment {
  if (payment.paymentId === undefined) throw new BillingUnavailableError();
  return {
    paymentId: payment.paymentId,
    purchasedCents: Math.round((payment.purchasedAmount ?? 0) * 100),
    refundedCents: Math.round((payment.refundedAmount ?? 0) * 100),
  };
}

export async function findPayment(paymentExternalKey: string): Promise<KillBillPayment | null> {
  const response = await read(`/1.0/kb/payments?externalKey=${encodeURIComponent(paymentExternalKey)}`);
  if (response.status === 404) return null;
  if (response.status !== 200) throw new BillingUnavailableError();
  return paymentOf(parse(response));
}

export async function payInvoice(
  accountId: string,
  invoiceId: string,
  priceCents: number,
  paymentExternalKey: string,
): Promise<KillBillPayment> {
  const amount = Number(formatMoney(priceCents));
  const response = await call(
    'POST',
    `/1.0/kb/invoices/${invoiceId}/payments?externalPayment=true`,
    {
      accountId,
      targetInvoiceId: invoiceId,
      purchasedAmount: amount,
      currency: 'USD',
      paymentExternalKey,
      transactions: [
        { transactionExternalKey: paymentExternalKey, transactionType: 'PURCHASE', amount, currency: 'USD' },
      ],
    },
  );
  if (response.status !== 201) throw new BillingUnavailableError();
  const payment = await findPayment(paymentExternalKey);
  if (payment === null) throw new BillingUnavailableError();
  return payment;
}

export async function voidInvoice(invoiceId: string): Promise<void> {
  await call('PUT', `/1.0/kb/invoices/${invoiceId}/voidInvoice`).catch(() => undefined);
}

interface PaymentTransaction {
  transactionExternalKey?: string;
  transactionType?: string;
  status?: string;
}

async function hasSuccessfulRefund(paymentId: string, transactionExternalKey: string): Promise<boolean> {
  const response = await read(`/1.0/kb/payments/${paymentId}`);
  if (response.status !== 200) return false;
  const payment = parse<{ transactions?: PaymentTransaction[] }>(response);
  return (payment.transactions ?? []).some(
    (transaction) =>
      transaction.transactionType === 'REFUND' &&
      transaction.transactionExternalKey === transactionExternalKey &&
      transaction.status === 'SUCCESS',
  );
}

/** One REFUND transaction keyed to the pack, so a retry never refunds twice. */
export async function refundPayment(
  paymentId: string,
  amountCents: number,
  transactionExternalKey: string,
): Promise<void> {
  const response = await call('POST', `/1.0/kb/payments/${paymentId}/refunds`, {
    paymentId,
    amount: Number(formatMoney(amountCents)),
    currency: 'USD',
    transactionExternalKey,
  });
  if (response.status === 201) return;
  if (await hasSuccessfulRefund(paymentId, transactionExternalKey)) return;
  throw new BillingUnavailableError();
}
