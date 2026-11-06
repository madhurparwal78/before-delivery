import { config } from '../config.ts';
import { plainDollars } from '../domain/money.ts';
import type { Funding } from '../domain/funding.ts';

/** Kill Bill was reached but could not be used: the caller answers `billing_unavailable`. */
export class BillingUnavailable extends Error {}

/** The call was sent but no answer arrived inside the budget: the caller answers as pending. */
export class BillingTimeout extends Error {}

/** The budget for calls made while answering a request. */
export const REQUEST_BUDGET_MS = 5_000;
/** The budget for the background settler's own calls. */
export const SETTLER_BUDGET_MS = 30_000;

const BASE_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json',
  'x-killbill-apikey': config.killbill.apiKey,
  'x-killbill-apisecret': config.killbill.apiSecret,
  'x-killbill-createdby': 'kiln-desk',
  authorization: `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64')}`,
};

interface CallOptions {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly body?: string;
  readonly budgetMs: number;
}

interface CallResult {
  readonly status: number;
  readonly text: string;
  readonly location: string | null;
}

async function call(options: CallOptions): Promise<CallResult> {
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}${options.path}`, {
      method: options.method,
      headers: BASE_HEADERS,
      body: options.body,
      signal: AbortSignal.timeout(options.budgetMs),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new BillingTimeout('billing did not answer in time');
    }
    throw new BillingUnavailable('billing could not be reached');
  }
  const text = await response.text().catch(() => '');
  return { status: response.status, text, location: response.headers.get('location') };
}

function parse<T>(result: CallResult): T {
  try {
    return JSON.parse(result.text) as T;
  } catch {
    throw new BillingUnavailable('billing sent an answer the app cannot read');
  }
}

interface AccountJson {
  readonly accountId: string;
}

interface PaymentMethodJson {
  readonly paymentMethodId: string;
  readonly externalKey: string;
}

interface TransactionJson {
  readonly transactionId: string;
  readonly transactionExternalKey: string;
  readonly transactionType: string;
  readonly status: string;
}

export interface KbPayment {
  readonly paymentId: string;
  readonly transactions: readonly TransactionJson[];
}

function idFromLocation(location: string | null): string {
  const trimmed = (location ?? '').replace(/\/$/, '');
  const id = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  if (id === '') throw new BillingUnavailable('billing did not name the record it created');
  return id;
}

export async function findAccount(externalKey: string, budgetMs: number): Promise<string | null> {
  const result = await call({
    method: 'GET',
    path: `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`,
    budgetMs,
  });
  if (result.status === 404) return null;
  if (result.status !== 200) throw new BillingUnavailable(`billing answered ${result.status}`);
  return parse<AccountJson>(result).accountId;
}

export async function createAccount(
  externalKey: string,
  name: string,
  email: string,
  budgetMs: number,
): Promise<string> {
  const body = JSON.stringify({ externalKey, name, email, currency: 'USD' });
  const result = await call({ method: 'POST', path: '/1.0/kb/accounts', body, budgetMs });
  if (result.status === 201) return idFromLocation(result.location);
  if (result.status === 409) {
    const existing = await findAccount(externalKey, budgetMs);
    if (existing) return existing;
  }
  throw new BillingUnavailable(`billing answered ${result.status}`);
}

export async function listPaymentMethods(
  accountId: string,
  budgetMs: number,
): Promise<readonly PaymentMethodJson[]> {
  const result = await call({
    method: 'GET',
    path: `/1.0/kb/accounts/${accountId}/paymentMethods`,
    budgetMs,
  });
  if (result.status !== 200) throw new BillingUnavailable(`billing answered ${result.status}`);
  return parse<PaymentMethodJson[]>(result);
}

/** Kill Bill's own code for "this account already carries an external payment method". */
const EXTERNAL_METHOD_EXISTS = 7023;

/**
 * Adds a payment method on the built-in external payment plugin. Kill Bill keeps at most one
 * such method per account, so a second key answers null and the caller shares the first.
 */
export async function createPaymentMethod(
  accountId: string,
  externalKey: string,
  isDefault: boolean,
  budgetMs: number,
): Promise<string | null> {
  const body = JSON.stringify({
    pluginName: '__EXTERNAL_PAYMENT__',
    externalKey,
    pluginInfo: {},
  });
  const result = await call({
    method: 'POST',
    path: `/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=${isDefault ? 'true' : 'false'}`,
    body,
    budgetMs,
  });
  if (result.status === 201) return idFromLocation(result.location);
  const methods = await listPaymentMethods(accountId, budgetMs);
  const found = methods.find((method) => method.externalKey === externalKey);
  if (found) return found.paymentMethodId;
  if (result.status === 400 && parse<{ code: number }>(result).code === EXTERNAL_METHOD_EXISTS) {
    return null;
  }
  throw new BillingUnavailable(`billing answered ${result.status}`);
}

export async function findPayment(
  paymentExternalKey: string,
  budgetMs: number,
): Promise<KbPayment | null> {
  const result = await call({
    method: 'GET',
    path: `/1.0/kb/payments?externalKey=${encodeURIComponent(paymentExternalKey)}&withPluginInfo=false&withAttempts=false`,
    budgetMs,
  });
  if (result.status === 404) return null;
  if (result.status !== 200) throw new BillingUnavailable(`billing answered ${result.status}`);
  return parse<KbPayment>(result);
}

export function successfulTransaction(
  payment: KbPayment | null,
  transactionExternalKey: string,
  type: 'PURCHASE' | 'REFUND',
): TransactionJson | null {
  if (!payment) return null;
  return (
    payment.transactions.find(
      (transaction) =>
        transaction.transactionExternalKey === transactionExternalKey &&
        transaction.transactionType === type &&
        transaction.status === 'SUCCESS',
    ) ?? null
  );
}

export async function createPurchase(
  accountId: string,
  paymentMethodId: string,
  amountCents: number,
  transactionExternalKey: string,
  budgetMs: number,
): Promise<string> {
  // The amount text is built from integer cents so money never passes through a float here.
  const body = `{"transactionType":"PURCHASE","amount":${plainDollars(amountCents)},"currency":"USD","paymentExternalKey":${JSON.stringify(transactionExternalKey)},"transactionExternalKey":${JSON.stringify(transactionExternalKey)}}`;
  const result = await call({
    method: 'POST',
    path: `/1.0/kb/accounts/${accountId}/payments?paymentMethodId=${paymentMethodId}`,
    body,
    budgetMs,
  });
  if (result.status === 201) return idFromLocation(result.location);
  throw new BillingUnavailable(`billing answered ${result.status}`);
}

export async function createRefund(
  paymentId: string,
  amountCents: number,
  transactionExternalKey: string,
  budgetMs: number,
): Promise<void> {
  const body = `{"amount":${plainDollars(amountCents)},"currency":"USD","transactionExternalKey":${JSON.stringify(transactionExternalKey)}}`;
  const result = await call({
    method: 'POST',
    path: `/1.0/kb/payments/${paymentId}/refunds`,
    body,
    budgetMs,
  });
  if (result.status !== 201 && result.status !== 200) {
    throw new BillingUnavailable(`billing answered ${result.status}`);
  }
}

export function paymentMethodExternalKey(memberId: string, funding: Funding): string {
  return `kd-${memberId}-${funding === 'card' ? 'card' : 'credit'}`;
}

export function accountExternalKey(memberId: string): string {
  return `kd-${memberId}`;
}

export function chargeTransactionKey(chargeId: string): string {
  return `kd-charge-${chargeId}`;
}

export function storageTransactionKey(pieceId: string, storageDay: string): string {
  return `kd-storage-${pieceId}-${storageDay}`;
}

export function packTransactionKey(purchaseId: string): string {
  return `kd-pack-${purchaseId}`;
}

export function refundTransactionKey(chargeId: string): string {
  return `kd-refund-${chargeId}`;
}
