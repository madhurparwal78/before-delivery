import { centsToDollars } from '../../shared/money';
import { config } from '../config';

const REQUEST_TIMEOUT_MS = 10_000;
const EXTERNAL_PAYMENT_PLUGIN = '__EXTERNAL_PAYMENT__';
const CURRENCY = 'USD';

/** Kill Bill either confirms a transaction, declines it, or cannot be reached. */
export type PaymentOutcome =
  | {
      readonly kind: 'confirmed';
      readonly killbillPaymentId: string;
      readonly killbillAccountId: string | null;
    }
  | { readonly kind: 'declined' }
  | { readonly kind: 'unreachable' };

class Unreachable extends Error {}
class Declined extends Error {}

interface KillbillResponse {
  readonly status: number;
  readonly location: string | null;
  readonly body: unknown;
}

async function call(path: string, init: { method: string; body?: unknown }): Promise<KillbillResponse> {
  const headers: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64')}`,
    'X-Killbill-ApiKey': config.killbill.apiKey,
    'X-Killbill-ApiSecret': config.killbill.apiSecret,
    'X-Killbill-CreatedBy': 'halyard-seatwise',
    Accept: 'application/json',
  };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Unreachable();
  }
  if (response.status >= 500) throw new Unreachable();
  const text = await response.text();
  let body: unknown = null;
  if (text !== '') {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = null;
    }
  }
  return { status: response.status, location: response.headers.get('location'), body };
}

function idFromLocation(location: string | null): string {
  const segments = (location ?? '').split('/').filter((segment) => segment !== '');
  const id = segments[segments.length - 1];
  if (id === undefined) throw new Unreachable();
  return id;
}

interface AccountBody {
  accountId?: string;
}

interface PaymentMethodBody {
  paymentMethodId?: string;
}

interface TransactionBody {
  transactionType?: string;
  transactionExternalKey?: string;
  status?: string;
  amount?: number;
}

interface PaymentBody {
  paymentId?: string;
  transactions?: TransactionBody[];
}

async function accountIdFor(email: string, name: string): Promise<string> {
  const externalKey = email.toLowerCase();
  const found = await call(`/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`, { method: 'GET' });
  if (found.status === 200) {
    const accountId = (found.body as AccountBody).accountId;
    if (accountId !== undefined) return accountId;
    throw new Unreachable();
  }
  if (found.status !== 404) throw new Unreachable();
  const created = await call('/1.0/kb/accounts', {
    method: 'POST',
    body: { name, externalKey, currency: CURRENCY, email: externalKey },
  });
  if (created.status === 201) return idFromLocation(created.location);
  const retry = await call(`/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`, { method: 'GET' });
  if (retry.status === 200) {
    const accountId = (retry.body as AccountBody).accountId;
    if (accountId !== undefined) return accountId;
  }
  throw new Unreachable();
}

async function ensureDefaultPaymentMethod(accountId: string): Promise<void> {
  const existing = await call(`/1.0/kb/accounts/${accountId}/paymentMethods`, { method: 'GET' });
  if (existing.status === 200 && Array.isArray(existing.body) && (existing.body as PaymentMethodBody[]).length > 0) {
    return;
  }
  const created = await call(`/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`, {
    method: 'POST',
    body: { pluginName: EXTERNAL_PAYMENT_PLUGIN, pluginInfo: {} },
  });
  if (created.status !== 201) throw new Unreachable();
}

async function transactionSucceeded(paymentId: string, transactionExternalKey: string): Promise<boolean> {
  const payment = await call(`/1.0/kb/payments/${paymentId}`, { method: 'GET' });
  if (payment.status !== 200) throw new Unreachable();
  const transactions = (payment.body as PaymentBody).transactions ?? [];
  const transaction = transactions.find((candidate) => candidate.transactionExternalKey === transactionExternalKey);
  return transaction?.status === 'SUCCESS';
}

async function outcome(run: () => Promise<{ paymentId: string; accountId: string | null }>): Promise<PaymentOutcome> {
  try {
    const { paymentId, accountId } = await run();
    return { kind: 'confirmed', killbillPaymentId: paymentId, killbillAccountId: accountId };
  } catch (error) {
    if (error instanceof Declined) return { kind: 'declined' };
    if (error instanceof Unreachable) return { kind: 'unreachable' };
    throw error;
  }
}

export async function recordPurchase(input: {
  readonly email: string;
  readonly name: string;
  readonly paymentExternalKey: string;
  readonly transactionExternalKey: string;
  readonly amountCents: number;
}): Promise<PaymentOutcome> {
  return outcome(async () => {
    const accountId = await accountIdFor(input.email, input.name);
    await ensureDefaultPaymentMethod(accountId);
    const created = await call(`/1.0/kb/accounts/${accountId}/payments`, {
      method: 'POST',
      body: {
        transactionType: 'PURCHASE',
        amount: centsToDollars(input.amountCents),
        currency: CURRENCY,
        paymentExternalKey: input.paymentExternalKey,
        transactionExternalKey: input.transactionExternalKey,
      },
    });
    if (created.status !== 201) throw new Declined();
    const paymentId = idFromLocation(created.location);
    if (!(await transactionSucceeded(paymentId, input.transactionExternalKey))) throw new Declined();
    return { paymentId, accountId };
  });
}

export async function recordRefund(input: {
  readonly killbillPaymentId: string;
  readonly transactionExternalKey: string;
  readonly amountCents: number;
}): Promise<PaymentOutcome> {
  return outcome(async () => {
    const created = await call(`/1.0/kb/payments/${input.killbillPaymentId}/refunds`, {
      method: 'POST',
      body: {
        amount: centsToDollars(input.amountCents),
        currency: CURRENCY,
        transactionExternalKey: input.transactionExternalKey,
      },
    });
    if (created.status !== 201) throw new Declined();
    if (!(await transactionSucceeded(input.killbillPaymentId, input.transactionExternalKey))) throw new Declined();
    return { paymentId: input.killbillPaymentId, accountId: null };
  });
}
