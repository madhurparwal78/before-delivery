import { config } from '../config';
import { euros } from '../domain/rules';

const TIMEOUT_MS = 10000;
const CREATED_BY = 'saffron-slate-tables';

export class KillBillUnreachable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KillBillUnreachable';
  }
}

export class KillBillFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KillBillFailure';
  }
}

let reachable = false;

export function killBillReachable(): boolean {
  return reachable;
}

interface KillBillResponse {
  status: number;
  location: string | null;
  body: unknown;
}

async function call(
  method: string,
  path: string,
  body?: unknown,
  tenantHeaders = true,
): Promise<KillBillResponse> {
  const headers: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(
      `${config.killbillUsername}:${config.killbillPassword}`,
    ).toString('base64')}`,
    Accept: 'application/json',
    'X-Killbill-CreatedBy': CREATED_BY,
  };
  if (tenantHeaders) {
    headers['X-Killbill-ApiKey'] = config.killbillApiKey;
    headers['X-Killbill-ApiSecret'] = config.killbillApiSecret;
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`${config.killbillUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    reachable = false;
    throw new KillBillUnreachable((error as Error).message);
  }
  if (response.status >= 500) {
    reachable = false;
    throw new KillBillUnreachable(`Kill Bill answered ${response.status}`);
  }
  reachable = true;
  const text = await response.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return {
    status: response.status,
    location: response.headers.get('location'),
    body: parsed,
  };
}

/** Checks Kill Bill for real before a deposit is refused, so a stale probe never pauses them. */
export async function killBillAnswering(): Promise<boolean> {
  return reachable ? true : probeKillBill();
}

export async function probeKillBill(): Promise<boolean> {
  try {
    const response = await call('GET', '/1.0/kb/healthcheck', undefined, false);
    reachable = response.status < 500;
    return reachable;
  } catch {
    return false;
  }
}

function idFromLocation(location: string | null): string | null {
  if (!location) return null;
  const trimmed = location.replace(/\/+$/, '');
  const id = trimmed.split('/').pop();
  return id && id.length > 0 ? id : null;
}

interface AccountBody {
  accountId: string;
}

interface PaymentMethodBody {
  paymentMethodId: string;
}

interface TransactionBody {
  transactionId: string;
  transactionType: string;
  status: string;
  transactionExternalKey: string;
}

interface PaymentBody {
  paymentId: string;
  paymentExternalKey: string;
  transactions: TransactionBody[];
}

async function findAccount(email: string): Promise<string | null> {
  const response = await call('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(email)}`);
  if (response.status === 404) return null;
  if (response.status !== 200)
    throw new KillBillFailure(`Account lookup answered ${response.status}`);
  return (response.body as AccountBody).accountId;
}

async function createAccount(email: string, name: string): Promise<string> {
  const response = await call('POST', '/1.0/kb/accounts', {
    externalKey: email,
    name,
    currency: 'EUR',
  });
  if (response.status === 409) {
    const existing = await findAccount(email);
    if (existing) return existing;
  }
  if (response.status !== 201)
    throw new KillBillFailure(`Account create answered ${response.status}`);
  const accountId = idFromLocation(response.location);
  if (!accountId) throw new KillBillFailure('Account create returned no id');
  return accountId;
}

async function ensureExternalPaymentMethod(accountId: string): Promise<void> {
  const existing = await call('GET', `/1.0/kb/accounts/${accountId}/paymentMethods`);
  if (existing.status === 200 && Array.isArray(existing.body) && existing.body.length > 0) return;
  const created = await call(
    'POST',
    `/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`,
    { pluginName: '__EXTERNAL_PAYMENT__', pluginInfo: {} },
  );
  if (created.status !== 201) {
    throw new KillBillFailure(`Payment method create answered ${created.status}`);
  }
  const body = created.body as PaymentMethodBody | null;
  if (body && !body.paymentMethodId && !created.location) {
    throw new KillBillFailure('Payment method create returned no id');
  }
}

/** One Kill Bill account per guest email, with the built-in external payment method. */
export async function ensureAccount(email: string, name: string): Promise<string> {
  const existing = await findAccount(email);
  const accountId = existing ?? (await createAccount(email, name));
  await ensureExternalPaymentMethod(accountId);
  return accountId;
}

async function findPayment(reference: string): Promise<PaymentBody | null> {
  const response = await call(
    'GET',
    `/1.0/kb/payments?externalKey=${encodeURIComponent(reference)}&withPluginInfo=false`,
  );
  if (response.status === 404) return null;
  if (response.status !== 200) return null;
  return response.body as PaymentBody;
}

export interface DepositCharge {
  paymentId: string;
  transactionId: string;
}

function successfulPurchase(payment: PaymentBody): TransactionBody | undefined {
  return payment.transactions.find(
    (transaction) => transaction.transactionType === 'PURCHASE' && transaction.status === 'SUCCESS',
  );
}

/** Takes the deposit as one PURCHASE for the reference. At most one succeeds per reference. */
export async function chargeDeposit(
  email: string,
  name: string,
  reference: string,
  amountCents: number,
): Promise<DepositCharge> {
  const accountId = await ensureAccount(email, name);
  const existing = await findPayment(reference);
  if (existing) {
    const paid = successfulPurchase(existing);
    if (paid)
      return {
        paymentId: existing.paymentId,
        transactionId: paid.transactionId,
      };
  }
  const response = await call('POST', `/1.0/kb/accounts/${accountId}/payments`, {
    transactionType: 'PURCHASE',
    amount: Number(euros(amountCents)),
    currency: 'EUR',
    paymentExternalKey: reference,
    transactionExternalKey: `${reference}-deposit`,
  });
  if (response.status !== 201) {
    throw new KillBillFailure(`Purchase answered ${response.status}`);
  }
  const paymentId = idFromLocation(response.location);
  if (!paymentId) throw new KillBillFailure('Purchase returned no payment id');
  const payment = await call('GET', `/1.0/kb/payments/${paymentId}`);
  if (payment.status !== 200)
    throw new KillBillFailure(`Payment lookup answered ${payment.status}`);
  const paid = successfulPurchase(payment.body as PaymentBody);
  if (!paid) throw new KillBillFailure('Purchase was not successful');
  return { paymentId, transactionId: paid.transactionId };
}

/** Refunds the whole deposit as one REFUND on its payment. */
export async function refundDeposit(
  paymentId: string,
  reference: string,
  amountCents: number,
): Promise<string> {
  const payment = await call('GET', `/1.0/kb/payments/${paymentId}`);
  if (payment.status === 200) {
    const existing = (payment.body as PaymentBody).transactions.find(
      (transaction) => transaction.transactionType === 'REFUND' && transaction.status === 'SUCCESS',
    );
    if (existing) return existing.transactionId;
  }
  const response = await call('POST', `/1.0/kb/payments/${paymentId}/refunds`, {
    amount: Number(euros(amountCents)),
    currency: 'EUR',
    transactionExternalKey: `${reference}-refund`,
  });
  if (response.status !== 201) throw new KillBillFailure(`Refund answered ${response.status}`);
  const refreshed = await call('GET', `/1.0/kb/payments/${paymentId}`);
  if (refreshed.status !== 200)
    throw new KillBillFailure(`Payment lookup answered ${refreshed.status}`);
  const refund = (refreshed.body as PaymentBody).transactions.find(
    (transaction) => transaction.transactionType === 'REFUND' && transaction.status === 'SUCCESS',
  );
  if (!refund) throw new KillBillFailure('Refund was not successful');
  return refund.transactionId;
}
