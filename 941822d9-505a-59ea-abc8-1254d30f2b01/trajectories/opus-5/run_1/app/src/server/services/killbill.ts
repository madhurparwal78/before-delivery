import { config } from '../config.js';
import { formatMoney } from '../domain/money.js';

export class PaymentsUnavailableError extends Error {
  constructor() {
    super('Kill Bill is unreachable');
    this.name = 'PaymentsUnavailableError';
  }
}

const REQUEST_TIMEOUT_MS = 5000;
const EXTERNAL_PAYMENT_PLUGIN = '__EXTERNAL_PAYMENT__';

interface CallOptions {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly body?: unknown;
  readonly actingUserId: string;
  readonly reason?: string;
  readonly comment?: string;
}

interface CallResult {
  readonly status: number;
  readonly location: string | null;
  readonly text: string;
}

function authHeader(): string {
  return `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64')}`;
}

/** Every Kill Bill write names the acting Credwell user, so its audit log attributes the change. */
async function call(options: CallOptions): Promise<CallResult> {
  const headers: Record<string, string> = {
    authorization: authHeader(),
    'x-killbill-apikey': config.killbill.apiKey,
    'x-killbill-apisecret': config.killbill.apiSecret,
    'x-killbill-createdby': `credwell:${options.actingUserId}`,
    accept: 'application/json',
  };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.reason !== undefined) headers['x-killbill-reason'] = options.reason;
  if (options.comment !== undefined) headers['x-killbill-comment'] = options.comment;

  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}${options.path}`, {
      method: options.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new PaymentsUnavailableError();
  }
  const text = await response.text();
  if (response.status >= 500) throw new PaymentsUnavailableError();
  return { status: response.status, location: response.headers.get('location'), text };
}

function idFromLocation(location: string | null): string {
  if (location === null) throw new PaymentsUnavailableError();
  const parts = location.replace(/\/+$/, '').split('/');
  const id = parts[parts.length - 1];
  if (id === undefined || id === '') throw new PaymentsUnavailableError();
  return id;
}

function amountOf(cents: number): number {
  return Number.parseFloat(formatMoney(cents));
}

async function findAccountId(externalKey: string, actingUserId: string): Promise<string | null> {
  const result = await call({
    method: 'GET',
    path: `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`,
    actingUserId,
  });
  if (result.status === 404) return null;
  if (result.status !== 200) throw new PaymentsUnavailableError();
  const parsed: unknown = JSON.parse(result.text);
  if (typeof parsed !== 'object' || parsed === null) throw new PaymentsUnavailableError();
  const accountId = (parsed as { accountId?: unknown }).accountId;
  if (typeof accountId !== 'string') throw new PaymentsUnavailableError();
  return accountId;
}

/** Payer accounts are created on first use, in USD, with the external payment method as default. */
export async function ensureAccount(
  externalKey: string,
  name: string,
  actingUserId: string,
): Promise<string> {
  const existing = await findAccountId(externalKey, actingUserId);
  if (existing !== null) return existing;

  const created = await call({
    method: 'POST',
    path: '/1.0/kb/accounts',
    body: { name, externalKey, currency: 'USD' },
    actingUserId,
  });
  if (created.status !== 201) {
    const raced = await findAccountId(externalKey, actingUserId);
    if (raced !== null) return raced;
    throw new PaymentsUnavailableError();
  }
  const accountId = idFromLocation(created.location);
  const method = await call({
    method: 'POST',
    path: `/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`,
    body: { pluginName: EXTERNAL_PAYMENT_PLUGIN, pluginInfo: {} },
    actingUserId,
  });
  if (method.status !== 201) throw new PaymentsUnavailableError();
  return accountId;
}

export function nurseAccountExternalKey(userId: string): string {
  return `credwell-nurse-${userId}`;
}

export function hospitalAccountExternalKey(slug: string): string {
  return `credwell-hospital-${slug}`;
}

export interface PurchaseInput {
  readonly accountId: string;
  readonly amountCents: number;
  readonly paymentExternalKey: string;
  readonly actingUserId: string;
}

export async function purchase(input: PurchaseInput): Promise<string> {
  const result = await call({
    method: 'POST',
    path: `/1.0/kb/accounts/${input.accountId}/payments`,
    body: {
      transactionType: 'PURCHASE',
      amount: amountOf(input.amountCents),
      currency: 'USD',
      paymentExternalKey: input.paymentExternalKey,
      transactionExternalKey: input.paymentExternalKey,
    },
    actingUserId: input.actingUserId,
  });
  if (result.status !== 201) throw new PaymentsUnavailableError();
  return idFromLocation(result.location);
}

export interface RefundInput {
  readonly paymentId: string;
  readonly amountCents: number;
  readonly transactionExternalKey: string;
  readonly reasonCode: string;
  readonly comment: string;
  readonly actingUserId: string;
}

async function hasTransaction(
  paymentId: string,
  transactionExternalKey: string,
  actingUserId: string,
): Promise<boolean> {
  const result = await call({ method: 'GET', path: `/1.0/kb/payments/${paymentId}`, actingUserId });
  if (result.status !== 200) throw new PaymentsUnavailableError();
  const parsed: unknown = JSON.parse(result.text);
  if (typeof parsed !== 'object' || parsed === null) throw new PaymentsUnavailableError();
  const transactions = (parsed as { transactions?: unknown }).transactions;
  if (!Array.isArray(transactions)) return false;
  return transactions.some(
    (transaction) =>
      typeof transaction === 'object' &&
      transaction !== null &&
      (transaction as { transactionExternalKey?: unknown }).transactionExternalKey === transactionExternalKey,
  );
}

/**
 * Records a refund unless a transaction with this external key already exists on the
 * payment, so a retried approval never refunds twice.
 */
export async function refundOnce(input: RefundInput): Promise<void> {
  if (await hasTransaction(input.paymentId, input.transactionExternalKey, input.actingUserId)) return;
  const result = await call({
    method: 'POST',
    path: `/1.0/kb/payments/${input.paymentId}/refunds`,
    body: {
      amount: amountOf(input.amountCents),
      currency: 'USD',
      transactionExternalKey: input.transactionExternalKey,
    },
    reason: input.reasonCode,
    comment: input.comment,
    actingUserId: input.actingUserId,
  });
  if (result.status !== 201) throw new PaymentsUnavailableError();
}
