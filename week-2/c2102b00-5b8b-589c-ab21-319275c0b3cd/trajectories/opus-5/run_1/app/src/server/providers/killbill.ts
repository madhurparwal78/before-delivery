import { config } from '../config.ts';
import { plainDollars } from '../../shared/money.ts';

export class PaymentsUnavailableError extends Error {
  constructor() {
    super('Kill Bill is unreachable');
  }
}

const TIMEOUT_MS = 5000;

interface KbResponse {
  status: number;
  text: string;
  location: string | null;
}

function headers(withBody: boolean): Record<string, string> {
  const basic = Buffer.from(`${config.killbill.username}:${config.killbill.password}`, 'utf8').toString('base64');
  const result: Record<string, string> = {
    authorization: `Basic ${basic}`,
    'x-killbill-apikey': config.killbill.apiKey,
    'x-killbill-apisecret': config.killbill.apiSecret,
    'x-killbill-createdby': 'tally-split',
    accept: 'application/json',
  };
  if (withBody) result['content-type'] = 'application/json';
  return result;
}

async function call(method: string, path: string, body?: unknown): Promise<KbResponse> {
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}${path}`, {
      method,
      headers: headers(body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new PaymentsUnavailableError();
  }
  if (response.status >= 500) {
    await response.text().catch(() => '');
    throw new PaymentsUnavailableError();
  }
  const text = await response.text().catch(() => '');
  return { status: response.status, text, location: response.headers.get('location') };
}

/** Converts a provider amount to cents by digit arithmetic on its text form. */
function providerAmountToCents(raw: unknown): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(raw));
  if (!match) return Number.NaN;
  const digits = (text: string): number => {
    let value = 0;
    for (const digit of text) value = value * 10 + (digit.codePointAt(0)! - 48);
    return value;
  };
  return digits(match[1] ?? '0') * 100 + digits((match[2] ?? '').padEnd(2, '0'));
}

export async function ping(timeoutMs = TIMEOUT_MS): Promise<boolean> {
  try {
    const response = await fetch(`${config.killbill.url}/1.0/kb/nodesInfo`, {
      method: 'GET',
      headers: headers(false),
      signal: AbortSignal.timeout(timeoutMs),
    });
    await response.text().catch(() => '');
    return response.status < 500;
  } catch {
    return false;
  }
}

export function accountExternalKey(householdCode: string): string {
  return `${config.kbKeyPrefix}-${householdCode}`;
}

export function topupPaymentKey(householdCode: string, idempotencyKey: string): string {
  return `topup-${householdCode}-${idempotencyKey}`;
}

async function findAccountId(externalKey: string): Promise<string | null> {
  const response = await call('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  if (response.status === 404) return null;
  if (response.status !== 200) throw new PaymentsUnavailableError();
  const account = JSON.parse(response.text) as { accountId?: string };
  return account.accountId ?? null;
}

/** Looks the household's account up by external key, creating it only when Kill Bill has none. */
export async function ensureAccount(household: { code: string; name: string; email: string }): Promise<string> {
  const externalKey = accountExternalKey(household.code);
  const existing = await findAccountId(externalKey);
  if (existing) return existing;
  const created = await call('POST', '/1.0/kb/accounts', {
    externalKey,
    name: household.name,
    email: household.email,
    currency: 'USD',
  });
  if (created.status !== 201 || !created.location) throw new PaymentsUnavailableError();
  const accountId = created.location.split('/').filter(Boolean).pop()!;
  const method = await call('POST', `/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`, {
    pluginName: '__EXTERNAL_PAYMENT__',
    pluginInfo: {},
  });
  if (method.status !== 201) throw new PaymentsUnavailableError();
  return accountId;
}

export interface ExistingPayment {
  amountCents: number;
  succeeded: boolean;
}

export async function findTopupPayment(paymentKey: string): Promise<ExistingPayment | null> {
  const response = await call('GET', `/1.0/kb/payments?externalKey=${encodeURIComponent(paymentKey)}`);
  if (response.status === 404) return null;
  if (response.status !== 200) throw new PaymentsUnavailableError();
  const payment = JSON.parse(response.text) as {
    transactions?: { transactionType: string; status: string; amount: number }[];
  };
  const purchase = (payment.transactions ?? []).find((transaction) => transaction.transactionType === 'PURCHASE');
  if (!purchase) return null;
  return { amountCents: providerAmountToCents(purchase.amount), succeeded: purchase.status === 'SUCCESS' };
}

export async function createTopupPayment(
  accountId: string,
  paymentKey: string,
  amountCents: number,
): Promise<boolean> {
  const response = await call('POST', `/1.0/kb/accounts/${accountId}/payments`, {
    transactionType: 'PURCHASE',
    amount: plainDollars(amountCents),
    currency: 'USD',
    paymentExternalKey: paymentKey,
    transactionExternalKey: paymentKey,
  });
  if (response.status !== 201) return false;
  const payment = await findTopupPayment(paymentKey);
  return payment !== null && payment.succeeded && payment.amountCents === amountCents;
}

export interface ChargeItem {
  description: string;
  amountCents: number;
}

export function chargeDescription(cycleName: string, caseName: string, cycleId: string): string {
  return `${cycleName}: ${caseName} [${cycleId}]`;
}

/** Kill Bill's item storage holds no four-byte characters, so a name carrying them needs this form. */
export function storableDescription(description: string): string {
  return [...description].filter((codePoint) => (codePoint.codePointAt(0) ?? 0) <= 0xffff).join('');
}

export async function listExternalCharges(accountId: string): Promise<ChargeItem[]> {
  const response = await call(
    'GET',
    `/1.0/kb/accounts/${accountId}/invoices?includeInvoiceComponents=true&withItems=true`,
  );
  if (response.status === 404) return [];
  if (response.status !== 200) throw new PaymentsUnavailableError();
  const invoices = JSON.parse(response.text) as {
    items?: { itemType?: string; description?: string; amount?: number }[];
  }[];
  const charges: ChargeItem[] = [];
  for (const invoice of invoices) {
    for (const item of invoice.items ?? []) {
      if (item.itemType !== 'EXTERNAL_CHARGE') continue;
      charges.push({
        description: item.description ?? '',
        amountCents: providerAmountToCents(item.amount),
      });
    }
  }
  return charges;
}

export async function postExternalCharges(accountId: string, items: ChargeItem[]): Promise<void> {
  const body = items.map((item) => ({
    accountId,
    amount: plainDollars(item.amountCents),
    currency: 'USD',
    description: item.description,
  }));
  const response = await call('POST', `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`, body);
  if (response.status !== 200 && response.status !== 201) throw new PaymentsUnavailableError();
}
