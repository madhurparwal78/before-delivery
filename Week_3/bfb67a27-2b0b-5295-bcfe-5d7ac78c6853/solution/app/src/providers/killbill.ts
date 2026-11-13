import { config, LIMITS } from '../server/config.js';
import { centsToKillBillAmount } from '../shared/money.js';

/** Thrown when Kill Bill cannot be reached or does not answer in time. */
export class PaymentsUnreachableError extends Error {}

/** Thrown when Kill Bill answers but refuses the call. */
export class PaymentsRefusedError extends Error {}

interface KillBillTransaction {
  transactionExternalKey: string;
  transactionType: string;
  status: string;
  amount: number;
}

interface KillBillPayment {
  paymentId: string;
  paymentExternalKey: string;
  purchasedAmount: number;
  refundedAmount: number;
  transactions: KillBillTransaction[];
}

interface KillBillAccount {
  accountId: string;
  externalKey: string;
}

function headers(withBody: boolean): Record<string, string> {
  const basic = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString(
    'base64',
  );
  const base: Record<string, string> = {
    Authorization: `Basic ${basic}`,
    'X-Killbill-ApiKey': config.killbill.apiKey,
    'X-Killbill-ApiSecret': config.killbill.apiSecret,
    'X-Killbill-CreatedBy': 'tallyslate',
    Accept: 'application/json',
  };
  if (withBody) base['Content-Type'] = 'application/json';
  return base;
}

interface KillBillResponse {
  status: number;
  location: string | null;
  text: string;
}

async function call(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<KillBillResponse> {
  try {
    const response = await fetch(`${config.killbill.url}${path}`, {
      method,
      headers: headers(body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(LIMITS.providerTimeoutMs),
    });
    return {
      status: response.status,
      location: response.headers.get('location'),
      text: await response.text(),
    };
  } catch (cause) {
    throw new PaymentsUnreachableError(`Kill Bill ${method} ${path} did not answer`, { cause });
  }
}

function expectOk(response: KillBillResponse, path: string): KillBillResponse {
  if (response.status >= 500) {
    throw new PaymentsUnreachableError(`Kill Bill ${path} answered ${response.status}`);
  }
  if (response.status >= 400) {
    throw new PaymentsRefusedError(`Kill Bill ${path} answered ${response.status}`);
  }
  return response;
}

function parseJson<T>(response: KillBillResponse, path: string): T {
  try {
    return JSON.parse(response.text) as T;
  } catch (cause) {
    throw new PaymentsUnreachableError(`Kill Bill ${path} sent an unreadable body`, { cause });
  }
}

function idFromLocation(location: string | null, path: string): string {
  const parts = (location ?? '').replace(/\/+$/, '').split('/');
  const id = parts[parts.length - 1];
  if (id === undefined || id === '') {
    throw new PaymentsUnreachableError(`Kill Bill ${path} sent no resource location`);
  }
  return id;
}

export async function probe(timeoutMs: number): Promise<boolean> {
  try {
    const response = await fetch(`${config.killbill.url}/1.0/kb/nodesInfo`, {
      method: 'GET',
      headers: headers(false),
      signal: AbortSignal.timeout(timeoutMs),
    });
    await response.text();
    return response.status < 500;
  } catch {
    return false;
  }
}

/** One account per renter, keyed by the renter's email in lower case. */
export async function ensureRenterAccount(email: string, name: string): Promise<string> {
  const externalKey = email.toLowerCase();
  const lookupPath = `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`;
  const found = await call('GET', lookupPath);
  if (found.status === 200 && found.text.trim() !== '') {
    const account = parseJson<KillBillAccount>(found, lookupPath);
    return account.accountId;
  }
  if (found.status !== 404) expectOk(found, lookupPath);

  const createPath = '/1.0/kb/accounts';
  const created = expectOk(
    await call('POST', createPath, { name, externalKey, currency: 'USD' }),
    createPath,
  );
  const accountId = idFromLocation(created.location, createPath);

  const methodPath = `/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`;
  expectOk(
    await call('POST', methodPath, { pluginName: '__EXTERNAL_PAYMENT__', pluginInfo: {} }),
    methodPath,
  );
  return accountId;
}

function parsePayment(response: KillBillResponse, path: string): KillBillPayment {
  const payment = parseJson<KillBillPayment>(response, path);
  if (payment === null || typeof payment !== 'object' ||
      typeof payment.paymentId !== 'string' || typeof payment.purchasedAmount !== 'number' ||
      typeof payment.refundedAmount !== 'number' || !Array.isArray(payment.transactions) ||
      !payment.transactions.every(transaction => transaction !== null && typeof transaction === 'object' &&
        typeof transaction.transactionExternalKey === 'string' && typeof transaction.status === 'string')) {
    throw new PaymentsUnreachableError(`Kill Bill ${path} sent an unreadable payment`);
  }
  return payment;
}

async function readPayment(paymentId: string): Promise<KillBillPayment> {
  const path = `/1.0/kb/payments/${paymentId}`;
  const response = expectOk(await call('GET', path), path);
  return parsePayment(response, path);
}

async function findPaymentByExternalKey(
  paymentExternalKey: string,
): Promise<KillBillPayment | null> {
  const path = `/1.0/kb/payments?externalKey=${encodeURIComponent(paymentExternalKey)}`;
  const response = await call('GET', path);
  if (response.status === 404) return null;
  return parsePayment(expectOk(response, path), path);
}

function transactionStatus(
  payment: KillBillPayment,
  transactionExternalKey: string,
): string | null {
  return (
    payment.transactions.find(
      (candidate) => candidate.transactionExternalKey === transactionExternalKey,
    )?.status ?? null
  );
}

function purchaseIsCollected(payment: KillBillPayment, key: string, amountCents: number): boolean {
  return transactionStatus(payment, key) === 'SUCCESS' &&
    Math.round((Number(payment.purchasedAmount) - Number(payment.refundedAmount)) * 100) >= amountCents;
}

export interface PurchaseResult {
  paymentId: string;
  succeeded: boolean;
}

/**
 * Records a PURCHASE and reports the outcome Kill Bill itself gives for the
 * transaction. A missing or non-SUCCESS transaction counts as a decline.
 */
export async function recordPurchase(
  accountId: string,
  paymentExternalKey: string,
  transactionExternalKey: string,
  amountCents: number,
): Promise<PurchaseResult> {
  const path = `/1.0/kb/accounts/${accountId}/payments`;
  try {
    const response = await call('POST', path, {
      transactionType: 'PURCHASE',
      amount: Number(centsToKillBillAmount(amountCents)),
      currency: 'USD',
      paymentExternalKey,
      transactionExternalKey,
    });
    if (response.status >= 500) expectOk(response, path);
    if (response.status >= 400) {
      const existing = await findPaymentByExternalKey(paymentExternalKey);
      if (existing === null) throw new PaymentsRefusedError(`Kill Bill ${path} answered ${response.status}`);
      return {
        paymentId: existing.paymentId,
        succeeded: purchaseIsCollected(existing, transactionExternalKey, amountCents),
      };
    }
    const paymentId = response.location === null
      ? parseJson<KillBillPayment>(response, path).paymentId
      : idFromLocation(response.location, path);
    if (typeof paymentId !== 'string' || paymentId === '') {
      throw new PaymentsUnreachableError('Kill Bill sent no payment identifier');
    }
    const payment = await readPayment(paymentId);
    return { paymentId, succeeded: purchaseIsCollected(payment, transactionExternalKey, amountCents) };
  } catch (error) {
    if (error instanceof PaymentsUnreachableError) {
      // A lost answer can follow a committed purchase. Reconcile its permanent key
      // and compensate before returning an outage, including unreadable POST bodies.
      const existing = await findPaymentByExternalKey(paymentExternalKey);
      if (existing !== null && purchaseIsCollected(existing, transactionExternalKey, amountCents)) {
        await recordRefund(existing.paymentId, `${paymentExternalKey}-confirm-rollback`, amountCents);
      }
    }
    throw error;
  }
}

export async function recordRefund(
  paymentId: string,
  transactionExternalKey: string,
  amountCents: number,
): Promise<void> {
  const path = `/1.0/kb/payments/${paymentId}/refunds`;
  const response = await call('POST', path, {
    amount: Number(centsToKillBillAmount(amountCents)),
    currency: 'USD',
    transactionExternalKey,
  });
  if (response.status >= 500) {
    throw new PaymentsUnreachableError(`Kill Bill ${path} answered ${response.status}`);
  }
  const payment = await readPayment(paymentId);
  if (transactionStatus(payment, transactionExternalKey) !== 'SUCCESS') {
    throw new PaymentsRefusedError(`Kill Bill refused refund ${transactionExternalKey}`);
  }
}

interface DamageInvoice {
  invoiceId: string;
  status: string;
  items: { description: string; amount: number }[];
}

/** Reconcile a draft by its booking description before creating a charge. */
export async function recordDamageInvoice(
  accountId: string,
  amountCents: number,
  description: string,
): Promise<string> {
  const lookup = `/1.0/kb/accounts/${accountId}/invoices?includeInvoiceComponents=true`;
  const invoices = parseJson<DamageInvoice[]>(expectOk(await call('GET', lookup), lookup), lookup);
  const existing = invoices.find((invoice) => invoice.status !== 'VOID' && invoice.items.some(
    (item) => item.description === description && Math.round(Number(item.amount) * 100) === amountCents,
  ));
  if (existing !== undefined) return existing.invoiceId;
  const path = `/1.0/kb/invoices/charges/${accountId}?autoCommit=false`;
  const response = expectOk(await call('POST', path, [{
    accountId,
    amount: Number(centsToKillBillAmount(amountCents)),
    currency: 'USD',
    description,
  }]), path);
  const items = parseJson<{ invoiceId: string }[]>(response, path);
  const invoiceId = items[0]?.invoiceId;
  if (invoiceId === undefined) throw new PaymentsUnreachableError('Kill Bill sent no damage invoice');
  return invoiceId;
}

/** A draft carries no account balance until the refund has also succeeded. */
export async function commitDamageInvoice(invoiceId: string): Promise<void> {
  const path = `/1.0/kb/invoices/${invoiceId}`;
  const invoice = parseJson<DamageInvoice>(expectOk(await call('GET', path), path), path);
  if (invoice.status === 'COMMITTED') return;
  expectOk(await call('PUT', `${path}/commitInvoice`), path);
}
