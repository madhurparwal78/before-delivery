import { env } from '../env.js';
import { markBilling } from './health.js';

export class BillingUnavailableError extends Error {
  constructor(detail: string) {
    super(`billing unavailable: ${detail}`);
    this.name = 'BillingUnavailableError';
  }
}

interface KillbillTransaction {
  transactionType: string;
  transactionExternalKey: string;
  amount: number;
  status: string;
}

interface KillbillPayment {
  paymentId: string;
  paymentExternalKey: string;
  purchasedAmount: number;
  refundedAmount: number;
  transactions: KillbillTransaction[];
}

interface KillbillAccount {
  accountId: string;
  externalKey: string;
}

const REQUEST_TIMEOUT_MS = 6_000;

function headers(): Record<string, string> {
  const basic = Buffer.from(`${env.killbill.username}:${env.killbill.password}`).toString('base64');
  return {
    authorization: `Basic ${basic}`,
    'content-type': 'application/json',
    accept: 'application/json',
    'x-killbill-apikey': env.killbill.apiKey,
    'x-killbill-apisecret': env.killbill.apiSecret,
    'x-killbill-createdby': 'hearthshift',
  };
}

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; text: string }> {
  let response: Response;
  try {
    response = await fetch(`${env.killbill.url}${path}`, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    markBilling(false);
    throw new BillingUnavailableError(`${method} ${path} ${String(error)}`);
  }
  markBilling(true);
  return { status: response.status, text: await response.text() };
}

export async function billingReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${env.killbill.url}/1.0/healthcheck`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function findAccount(externalKey: string): Promise<KillbillAccount | null> {
  const result = await call('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  if (result.status === 404) return null;
  if (result.status !== 200) throw new BillingUnavailableError(`account lookup ${result.status}`);
  return JSON.parse(result.text) as KillbillAccount;
}

export interface RenterAccountInput {
  renterId: string;
  name: string;
  email: string;
}

export async function ensureRenterAccount(renter: RenterAccountInput): Promise<string> {
  const externalKey = `hs-renter-${renter.renterId}`;
  const existing = await findAccount(externalKey);
  if (existing) return existing.accountId;
  const created = await call('POST', '/1.0/kb/accounts', {
    externalKey,
    name: renter.name,
    email: renter.email,
    currency: 'USD',
  });
  if (created.status !== 201 && created.status !== 409) {
    throw new BillingUnavailableError(`account create ${created.status}`);
  }
  const account = await findAccount(externalKey);
  if (!account) throw new BillingUnavailableError('account missing after create');
  const method = await call(
    'POST',
    `/1.0/kb/accounts/${account.accountId}/paymentMethods?isDefault=true`,
    { pluginName: '__EXTERNAL_PAYMENT__', pluginInfo: {} },
  );
  if (method.status !== 201) throw new BillingUnavailableError(`payment method ${method.status}`);
  return account.accountId;
}

export async function findPayment(externalKey: string): Promise<KillbillPayment | null> {
  const result = await call(
    'GET',
    `/1.0/kb/payments?externalKey=${encodeURIComponent(externalKey)}&withPluginInfo=false`,
  );
  if (result.status === 404) return null;
  if (result.status !== 200) throw new BillingUnavailableError(`payment lookup ${result.status}`);
  return JSON.parse(result.text) as KillbillPayment;
}

/** One PURCHASE per external key, whatever the number of attempts. */
export async function recordPurchase(
  renter: RenterAccountInput,
  externalKey: string,
  amountCents: number,
): Promise<void> {
  const existing = await findPayment(externalKey);
  if (existing) return;
  const accountId = await ensureRenterAccount(renter);
  const result = await call('POST', `/1.0/kb/accounts/${accountId}/payments`, {
    transactionType: 'PURCHASE',
    amount: amountCents / 100,
    currency: 'USD',
    paymentExternalKey: externalKey,
    transactionExternalKey: externalKey,
  });
  if (result.status === 201) return;
  if ((await findPayment(externalKey)) !== null) return;
  throw new BillingUnavailableError(`purchase ${result.status} ${result.text.slice(0, 120)}`);
}

/** One full REFUND per payment, whatever the number of attempts. */
export async function refundPurchase(externalKey: string): Promise<number> {
  const payment = await findPayment(externalKey);
  if (!payment) return 0;
  const refundable = Math.round((payment.purchasedAmount - payment.refundedAmount) * 100);
  if (refundable <= 0) return Math.round(payment.purchasedAmount * 100);
  const result = await call('POST', `/1.0/kb/payments/${payment.paymentId}/refunds`, {
    amount: refundable / 100,
    currency: 'USD',
    transactionExternalKey: `${externalKey}-refund`,
  });
  if (result.status !== 201) {
    throw new BillingUnavailableError(`refund ${result.status} ${result.text.slice(0, 120)}`);
  }
  return Math.round(payment.purchasedAmount * 100);
}

export async function ensureTenant(): Promise<void> {
  const probe = await call('GET', '/1.0/kb/accounts/pagination');
  if (probe.status === 200) return;
  await call('POST', '/1.0/kb/tenants', {
    apiKey: env.killbill.apiKey,
    apiSecret: env.killbill.apiSecret,
    externalKey: 'hearthshift',
  });
}
