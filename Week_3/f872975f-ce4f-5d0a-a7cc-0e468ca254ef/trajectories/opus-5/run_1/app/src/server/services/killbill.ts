import { SERVICE_TIMEOUT_MS, config } from '../config';
import { LOCK_SCOPE_BILLING_ACCOUNT, advisoryLock, one, pool, transaction } from '../db/pool';
import { ApiError } from '../errors';
import { markService, registerProbe } from './health';

const billingUnavailable = (): ApiError => new ApiError('billing_unavailable');

function headers(withBody: boolean): Record<string, string> {
  const base: Record<string, string> = {
    authorization: `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64')}`,
    'x-killbill-apikey': config.killbill.apiKey,
    'x-killbill-apisecret': config.killbill.apiSecret,
    accept: 'application/json'
  };
  if (withBody) {
    base['content-type'] = 'application/json';
    base['x-killbill-createdby'] = 'kerfwell';
  }
  return base;
}

interface BillingResponse {
  status: number;
  location: string | null;
  text: string;
}

async function call(method: string, path: string, body?: unknown): Promise<BillingResponse> {
  const url = path.startsWith('http') ? path : `${config.killbill.url}${path}`;
  try {
    const response = await fetch(url, {
      method,
      headers: headers(body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS)
    });
    const text = await response.text();
    if (response.status >= 500) {
      markService('billing', 'down');
      throw billingUnavailable();
    }
    markService('billing', 'up');
    return { status: response.status, location: response.headers.get('location'), text };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    markService('billing', 'down');
    throw billingUnavailable();
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function accountIdOf(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const id = (value as { accountId?: unknown }).accountId;
  return typeof id === 'string' ? id : null;
}

async function readAccountByExternalKey(email: string): Promise<string | null> {
  const response = await call('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(email)}`);
  if (response.status === 404) return null;
  if (response.status !== 200) throw billingUnavailable();
  return accountIdOf(parseJson(response.text));
}

async function createAccount(name: string, email: string): Promise<string | null> {
  const response = await call('POST', '/1.0/kb/accounts', { name, email, externalKey: email, currency: 'USD' });
  if (response.status === 409) return null;
  if (response.status !== 201 || response.location === null) throw billingUnavailable();
  const tail = response.location.split('/').filter((part) => part !== '');
  return tail[tail.length - 1] ?? null;
}

interface PaymentMethodRow {
  isDefault?: unknown;
}

async function ensureDefaultPaymentMethod(accountId: string): Promise<void> {
  const existing = await call('GET', `/1.0/kb/accounts/${accountId}/paymentMethods`);
  if (existing.status !== 200) throw billingUnavailable();
  const parsed = parseJson(existing.text);
  const methods = Array.isArray(parsed) ? (parsed as PaymentMethodRow[]) : [];
  if (methods.some((method) => method.isDefault === true)) return;
  const created = await call('POST', `/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`, {
    pluginName: '__EXTERNAL_PAYMENT__',
    pluginInfo: {}
  });
  if (created.status !== 201) throw billingUnavailable();
}

export interface BillingMaker {
  id: string;
  name: string;
  email: string;
}

/** Finds or creates the maker's one Kill Bill account, serialised across instances. */
export async function ensureBillingAccount(maker: BillingMaker): Promise<string> {
  const stored = await one<{ killbill_account_id: string | null }>(pool, 'SELECT killbill_account_id FROM users WHERE id = $1', [
    maker.id
  ]);
  if (stored?.killbill_account_id != null) return stored.killbill_account_id;

  return transaction(async (client) => {
    await advisoryLock(client, LOCK_SCOPE_BILLING_ACCOUNT, maker.id);
    const current = await one<{ killbill_account_id: string | null }>(
      client,
      'SELECT killbill_account_id FROM users WHERE id = $1 FOR UPDATE',
      [maker.id]
    );
    if (current?.killbill_account_id != null) return current.killbill_account_id;

    let accountId = await readAccountByExternalKey(maker.email);
    if (accountId === null) accountId = await createAccount(maker.name, maker.email);
    if (accountId === null) accountId = await readAccountByExternalKey(maker.email);
    if (accountId === null) throw billingUnavailable();

    await ensureDefaultPaymentMethod(accountId);
    await client.query('UPDATE users SET killbill_account_id = $2 WHERE id = $1', [maker.id, accountId]);
    return accountId;
  });
}

function dollars(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const rest = Math.abs(cents % 100);
  return `${whole}.${String(rest).padStart(2, '0')}`;
}

interface PaymentTransaction {
  transactionType?: unknown;
  transactionExternalKey?: unknown;
  status?: unknown;
}

interface PaymentBody {
  paymentId?: unknown;
  transactions?: unknown;
}

async function readPayment(location: string): Promise<PaymentBody> {
  const response = await call('GET', location);
  if (response.status !== 200) throw billingUnavailable();
  const parsed = parseJson(response.text);
  if (typeof parsed !== 'object' || parsed === null) throw billingUnavailable();
  return parsed as PaymentBody;
}

function transactionsOf(payment: PaymentBody): PaymentTransaction[] {
  return Array.isArray(payment.transactions) ? (payment.transactions as PaymentTransaction[]) : [];
}

export interface PaymentOutcome {
  paymentId: string;
  success: boolean;
}

/** Takes a PURCHASE on the maker's account. Throws `payment_failed` unless Kill Bill says SUCCESS. */
export async function purchase(accountId: string, amountCents: number, paymentExternalKey: string): Promise<PaymentOutcome> {
  const response = await call('POST', `/1.0/kb/accounts/${accountId}/payments`, {
    transactionType: 'PURCHASE',
    amount: Number(dollars(amountCents)),
    currency: 'USD',
    paymentExternalKey,
    transactionExternalKey: `${paymentExternalKey}-purchase`
  });
  if (response.status !== 201 || response.location === null) throw new ApiError('payment_failed');
  const payment = await readPayment(response.location);
  const paymentId = typeof payment.paymentId === 'string' ? payment.paymentId : null;
  if (paymentId === null) throw new ApiError('payment_failed');
  const purchased = transactionsOf(payment).filter((item) => item.transactionType === 'PURCHASE');
  const success = purchased.some((item) => item.status === 'SUCCESS');
  return { paymentId, success };
}

/** Refunds the deposit on its purchase payment. */
export async function refund(paymentId: string, amountCents: number, transactionExternalKey: string): Promise<boolean> {
  const response = await call('POST', `/1.0/kb/payments/${paymentId}/refunds`, {
    amount: Number(dollars(amountCents)),
    currency: 'USD',
    transactionExternalKey
  });
  if (response.status !== 201 || response.location === null) return false;
  const payment = await readPayment(response.location);
  return transactionsOf(payment).some(
    (item) => item.transactionType === 'REFUND' && item.transactionExternalKey === transactionExternalKey && item.status === 'SUCCESS'
  );
}

async function probeBilling(): Promise<boolean> {
  try {
    const response = await fetch(`${config.killbill.url}/1.0/healthcheck`, {
      signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS)
    });
    await response.text();
    return response.ok;
  } catch {
    return false;
  }
}

registerProbe('billing', probeBilling);
