import { config } from '../config.js';
import { penceToDecimal } from '../../shared/money.js';
import { markService, ServiceDownError } from './health.js';

const CURRENCY = 'GBP';
const EXTERNAL_PLUGIN = '__EXTERNAL_PAYMENT__';
const CALL_TIMEOUT_MS = 10_000;
const PROBE_TIMEOUT_MS = 4_000;

function headers(): Record<string, string> {
  const basic = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString(
    'base64',
  );
  return {
    authorization: `Basic ${basic}`,
    'x-killbill-apikey': config.killbill.apiKey,
    'x-killbill-apisecret': config.killbill.apiSecret,
    'x-killbill-createdby': 'dotgain',
    'content-type': 'application/json',
    accept: 'application/json',
  };
}

function down(detail: string): ServiceDownError {
  markService('payments', 'down');
  return new ServiceDownError('payments', `Kill Bill unreachable: ${detail}`);
}

interface KillBillReply {
  readonly status: number;
  readonly location: string | null;
  readonly text: string;
}

async function call(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = CALL_TIMEOUT_MS,
): Promise<KillBillReply> {
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}${path}`, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw down(error instanceof Error ? error.message : 'network error');
  }
  const text = await response.text();
  if (response.status >= 500) throw down(`status ${response.status}`);
  markService('payments', 'up');
  return { status: response.status, location: response.headers.get('location'), text };
}

function idFromLocation(location: string | null, segment: string): string {
  const match = location === null ? null : new RegExp(`/${segment}/([^/?]+)`).exec(location);
  if (match === null) throw down('no resource id in Location header');
  return match[1] as string;
}

export interface KillBillPerson {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

/** One account per backer, keyed externally by the person id, created on their first pledge. */
export async function ensureAccount(person: KillBillPerson): Promise<string> {
  const found = await call('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(person.id)}`);
  if (found.status === 200 && found.text.trim() !== '') {
    const account = JSON.parse(found.text) as { accountId?: string };
    if (typeof account.accountId === 'string') return account.accountId;
  }
  const created = await call('POST', '/1.0/kb/accounts', {
    externalKey: person.id,
    currency: CURRENCY,
    name: person.name,
    email: person.email,
  });
  return idFromLocation(created.location, 'accounts');
}

/** Each card entry adds a payment method on the account using the external payment plugin. */
export async function addPaymentMethod(accountId: string): Promise<void> {
  await call('POST', `/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`, {
    pluginName: EXTERNAL_PLUGIN,
    pluginInfo: {},
  });
}

/** Places the hold. Returns the Kill Bill payment id. */
export async function authorize(
  accountId: string,
  paymentExternalKey: string,
  transactionExternalKey: string,
  amountPence: number,
): Promise<string> {
  const reply = await call('POST', `/1.0/kb/accounts/${accountId}/payments`, {
    transactionType: 'AUTHORIZE',
    amount: penceToDecimal(amountPence),
    currency: CURRENCY,
    paymentExternalKey,
    transactionExternalKey,
  });
  if (reply.status !== 201) throw down(`authorize answered ${reply.status}`);
  return idFromLocation(reply.location, 'payments');
}

export async function capture(
  paymentId: string,
  transactionExternalKey: string,
  amountPence: number,
): Promise<void> {
  const reply = await call('POST', `/1.0/kb/payments/${paymentId}`, {
    amount: penceToDecimal(amountPence),
    currency: CURRENCY,
    transactionExternalKey,
  });
  if (reply.status !== 201) throw down(`capture answered ${reply.status}`);
}

export async function voidHold(
  paymentId: string,
  transactionExternalKey: string,
): Promise<void> {
  const reply = await call('DELETE', `/1.0/kb/payments/${paymentId}`, { transactionExternalKey });
  if (reply.status !== 204) throw down(`void answered ${reply.status}`);
}

export async function probePayments(): Promise<void> {
  try {
    const response = await fetch(`${config.killbill.url}/1.0/healthcheck`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    markService('payments', response.ok ? 'up' : 'down');
  } catch {
    markService('payments', 'down');
  }
}
