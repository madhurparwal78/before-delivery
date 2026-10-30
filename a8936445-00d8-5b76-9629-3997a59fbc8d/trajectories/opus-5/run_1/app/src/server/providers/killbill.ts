import { config } from '../config.js';

export class BillingUnavailableError extends Error {
  constructor(cause: string) {
    super(`Billing unavailable: ${cause}`);
    this.name = 'BillingUnavailableError';
  }
}

const AUTO_PAY_OFF_TAG = '00000000-0000-0000-0000-000000000001';
const CREATED_BY = 'stationkeeper';

function headers(): Record<string, string> {
  const basic = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64');
  return {
    authorization: `Basic ${basic}`,
    'X-Killbill-ApiKey': config.killbill.apiKey,
    'X-Killbill-ApiSecret': config.killbill.apiSecret,
    'X-Killbill-CreatedBy': CREATED_BY,
    'content-type': 'application/json',
    accept: 'application/json',
  };
}

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  const init: RequestInit = {
    method,
    headers: headers(),
    signal: AbortSignal.timeout(15_000),
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  try {
    return await fetch(`${config.killbill.url}${path}`, init);
  } catch (error) {
    throw new BillingUnavailableError(error instanceof Error ? error.message : 'request failed');
  }
}

function dollars(amountCents: number): number {
  return Number((amountCents / 100).toFixed(2));
}

interface KillbillAccount {
  accountId: string;
}

async function findAccount(externalKey: string): Promise<string | null> {
  const response = await call('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new BillingUnavailableError(`account lookup ${response.status}`);
  const account = (await response.json()) as KillbillAccount;
  return account.accountId;
}

export async function ensureAccount(tenantId: string, businessName: string): Promise<string> {
  const existing = await findAccount(tenantId);
  if (existing) return existing;
  const created = await call('POST', '/1.0/kb/accounts', {
    name: businessName,
    externalKey: tenantId,
    currency: 'USD',
  });
  if (created.status === 409) {
    const found = await findAccount(tenantId);
    if (found) return found;
    throw new BillingUnavailableError('account conflict without account');
  }
  if (!created.ok) throw new BillingUnavailableError(`account create ${created.status}`);
  const location = created.headers.get('location');
  const accountId = location ? location.split('/').filter(Boolean).pop() : null;
  if (!accountId) throw new BillingUnavailableError('account create returned no id');

  const tagged = await call('POST', `/1.0/kb/accounts/${accountId}/tags`, [AUTO_PAY_OFF_TAG]);
  if (!tagged.ok && tagged.status !== 409) {
    throw new BillingUnavailableError(`auto-pay-off tag ${tagged.status}`);
  }
  const method = await call(
    'POST',
    `/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`,
    { pluginName: '__EXTERNAL_PAYMENT__', pluginInfo: {} },
  );
  if (!method.ok) throw new BillingUnavailableError(`payment method ${method.status}`);
  return accountId;
}

export async function externalCharge(
  accountId: string,
  amountCents: number,
  description: string,
): Promise<void> {
  const response = await call('POST', `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`, [
    { accountId, amount: dollars(amountCents), currency: 'USD', description },
  ]);
  if (!response.ok) throw new BillingUnavailableError(`charge ${response.status}`);
}

export async function credit(
  accountId: string,
  amountCents: number,
  description: string,
): Promise<void> {
  const response = await call('POST', '/1.0/kb/credits?autoCommit=true', [
    { accountId, amount: dollars(amountCents), currency: 'USD', description },
  ]);
  if (!response.ok) throw new BillingUnavailableError(`credit ${response.status}`);
}

interface KillbillPayment {
  transactions: { transactionExternalKey: string }[];
}

async function paymentRecorded(accountId: string, transactionExternalKey: string): Promise<boolean> {
  const byKey = await call(
    'GET',
    `/1.0/kb/payments?externalKey=${encodeURIComponent(transactionExternalKey)}`,
  );
  if (byKey.ok) return true;
  const response = await call('GET', `/1.0/kb/accounts/${accountId}/payments`);
  if (!response.ok) return false;
  const payments = (await response.json()) as KillbillPayment[];
  return payments.some((payment) =>
    payment.transactions.some(
      (transaction) => transaction.transactionExternalKey === transactionExternalKey,
    ),
  );
}

export async function purchase(
  accountId: string,
  amountCents: number,
  transactionExternalKey: string,
): Promise<void> {
  const response = await call('POST', `/1.0/kb/accounts/${accountId}/payments`, {
    transactionType: 'PURCHASE',
    amount: dollars(amountCents),
    currency: 'USD',
    paymentExternalKey: transactionExternalKey,
    transactionExternalKey,
  });
  if (response.ok) return;
  // Kill Bill refuses a transaction key it already holds, which means the payment is recorded.
  if (await paymentRecorded(accountId, transactionExternalKey)) return;
  throw new BillingUnavailableError(`payment ${response.status}`);
}
