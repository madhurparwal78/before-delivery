import { config } from '../config.js';
import { isJsonObject, type JsonObject } from '../http/json.js';
import { apiError, type ApiError } from '../http/errors.js';

const TIMEOUT_MS = 10_000;
const EXTERNAL_PAYMENT_PLUGIN = '__EXTERNAL_PAYMENT__';

export class BillingUnavailableError extends Error {}

export function billingOutage(): ApiError {
  return apiError(503, 'billing_unavailable');
}

export type TransactionStatus = string;

export interface PaymentTransaction {
  readonly transactionType: string;
  readonly status: TransactionStatus;
  readonly amount: number;
  readonly transactionExternalKey: string;
}

export interface Payment {
  readonly paymentId: string;
  readonly transactions: readonly PaymentTransaction[];
}

interface KillBillReply {
  readonly status: number;
  readonly location: string | null;
  readonly body: unknown;
}

function authHeaders(): Record<string, string> {
  const basic = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString(
    'base64',
  );
  return {
    Authorization: `Basic ${basic}`,
    'X-Killbill-ApiKey': config.killbill.apiKey,
    'X-Killbill-ApiSecret': config.killbill.apiSecret,
    'X-Killbill-CreatedBy': 'lanternfish',
    Accept: 'application/json',
  };
}

async function call(
  method: 'GET' | 'POST',
  path: string,
  body?: JsonObject,
): Promise<KillBillReply> {
  const headers = authHeaders();
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new BillingUnavailableError('Kill Bill is unreachable');
  }
  if (response.status >= 500) {
    await response.text().catch(() => '');
    throw new BillingUnavailableError(`Kill Bill answered ${response.status}`);
  }
  const text = await response.text().catch(() => '');
  let parsed: unknown = null;
  if (text !== '') {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  return { status: response.status, location: response.headers.get('location'), body: parsed };
}

function readTransactions(body: unknown): Payment | null {
  if (!isJsonObject(body)) return null;
  const paymentId = body['paymentId'];
  const list = body['transactions'];
  if (typeof paymentId !== 'string' || !Array.isArray(list)) return null;
  const transactions: PaymentTransaction[] = [];
  for (const item of list) {
    if (!isJsonObject(item)) continue;
    const transactionType = item['transactionType'];
    const status = item['status'];
    const amount = item['amount'];
    const key = item['transactionExternalKey'];
    if (
      typeof transactionType !== 'string' ||
      typeof status !== 'string' ||
      typeof key !== 'string'
    ) {
      continue;
    }
    transactions.push({
      transactionType,
      status,
      amount: typeof amount === 'number' ? amount : 0,
      transactionExternalKey: key,
    });
  }
  return { paymentId, transactions };
}

function idFromLocation(location: string | null): string | null {
  if (location === null) return null;
  const parts = location.split('/').filter((part) => part !== '');
  return parts[parts.length - 1] ?? null;
}

async function findAccountId(enrollmentId: string): Promise<string | null> {
  const reply = await call(
    'GET',
    `/1.0/kb/accounts?externalKey=${encodeURIComponent(enrollmentId)}`,
  );
  if (reply.status === 404) return null;
  if (!isJsonObject(reply.body)) return null;
  const accountId = reply.body['accountId'];
  return typeof accountId === 'string' ? accountId : null;
}

async function hasDefaultPaymentMethod(accountId: string): Promise<boolean> {
  const reply = await call('GET', `/1.0/kb/accounts/${accountId}/paymentMethods`);
  if (!Array.isArray(reply.body)) return false;
  return reply.body.some(
    (method) => isJsonObject(method) && method['isDefault'] === true,
  );
}

export async function ensureAccount(
  enrollmentId: string,
  name: string,
  email: string,
): Promise<string> {
  let accountId = await findAccountId(enrollmentId);
  if (accountId === null) {
    const created = await call('POST', '/1.0/kb/accounts', {
      externalKey: enrollmentId,
      name,
      email,
      currency: 'USD',
    });
    accountId = idFromLocation(created.location) ?? (await findAccountId(enrollmentId));
    if (accountId === null) throw new BillingUnavailableError('Account creation gave no id');
  }
  if (!(await hasDefaultPaymentMethod(accountId))) {
    await call('POST', `/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`, {
      pluginName: EXTERNAL_PAYMENT_PLUGIN,
      pluginInfo: {},
    });
  }
  return accountId;
}

export async function findPayment(enrollmentId: string): Promise<Payment | null> {
  const reply = await call(
    'GET',
    `/1.0/kb/payments?externalKey=${encodeURIComponent(enrollmentId)}&withPluginInfo=false&withAttempts=false`,
  );
  if (reply.status === 404) return null;
  return readTransactions(reply.body);
}

export function successfulPurchase(payment: Payment | null): PaymentTransaction | null {
  if (payment === null) return null;
  return (
    payment.transactions.find(
      (transaction) => transaction.transactionType === 'PURCHASE' && transaction.status === 'SUCCESS',
    ) ?? null
  );
}

export function successfulRefund(
  payment: Payment | null,
  enrollmentId: string,
): PaymentTransaction | null {
  if (payment === null) return null;
  return (
    payment.transactions.find(
      (transaction) =>
        transaction.transactionType === 'REFUND' &&
        transaction.status === 'SUCCESS' &&
        transaction.transactionExternalKey === `${enrollmentId}-refund`,
    ) ?? null
  );
}

export async function makePurchase(
  accountId: string,
  enrollmentId: string,
  priceCents: number,
): Promise<Payment | null> {
  await call('POST', `/1.0/kb/accounts/${accountId}/payments`, {
    transactionType: 'PURCHASE',
    amount: priceCents / 100,
    currency: 'USD',
    paymentExternalKey: enrollmentId,
    transactionExternalKey: `${enrollmentId}-purchase`,
  });
  return findPayment(enrollmentId);
}

export async function makeRefund(
  paymentId: string,
  enrollmentId: string,
  priceCents: number,
): Promise<Payment | null> {
  await call('POST', `/1.0/kb/payments/${paymentId}/refunds`, {
    amount: priceCents / 100,
    currency: 'USD',
    transactionExternalKey: `${enrollmentId}-refund`,
  });
  return findPayment(enrollmentId);
}
