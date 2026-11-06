import { config } from '../config.js';

export class BillingUnreachable extends Error {
  constructor(detail: string) {
    super(`billing unreachable: ${detail}`);
    this.name = 'BillingUnreachable';
  }
}

export class BillingRefused extends Error {
  constructor(detail: string) {
    super(`billing refused: ${detail}`);
    this.name = 'BillingRefused';
  }
}

const ATTEMPT_BUDGET_MS = 5000;

function headers(): Record<string, string> {
  const basic = Buffer.from(`${config.killbill.username}:${config.killbill.password}`, 'utf8').toString('base64');
  return {
    authorization: `Basic ${basic}`,
    'x-killbill-apikey': config.killbill.apiKey,
    'x-killbill-apisecret': config.killbill.apiSecret,
    'x-killbill-createdby': 'saltprint-desk',
    'content-type': 'application/json',
    accept: 'application/json',
  };
}

interface Attempt {
  startedAt: number;
}

function remaining(attempt: Attempt): number {
  const left = ATTEMPT_BUDGET_MS - (Date.now() - attempt.startedAt);
  if (left <= 0) throw new BillingUnreachable('attempt budget spent');
  return left;
}

async function call(
  attempt: Attempt,
  method: string,
  path: string,
  body?: string,
): Promise<{ status: number; text: string; location: string | null }> {
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}${path}`, {
      method,
      headers: headers(),
      body: body ?? null,
      signal: AbortSignal.timeout(remaining(attempt)),
    });
  } catch (error) {
    throw new BillingUnreachable(error instanceof Error ? error.message : 'request failed');
  }
  if (response.status >= 500) throw new BillingUnreachable(`status ${response.status}`);
  const text = await response.text();
  return { status: response.status, text, location: response.headers.get('location') };
}

function accountIdFromLocation(location: string | null): string {
  const match = location ? /\/accounts\/([0-9a-f-]+)/.exec(location) : null;
  if (!match) throw new BillingUnreachable('account id missing from response');
  return match[1] as string;
}

async function findAccount(attempt: Attempt, externalKey: string): Promise<string | null> {
  const found = await call(attempt, 'GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  if (found.status === 404) return null;
  if (found.status !== 200) throw new BillingRefused(`account lookup ${found.status}`);
  const parsed = JSON.parse(found.text) as { accountId?: string };
  return parsed.accountId ?? null;
}

async function ensureAccount(
  attempt: Attempt,
  externalKey: string,
  name: string,
  withExternalPaymentMethod: boolean,
): Promise<string> {
  const existing = await findAccount(attempt, externalKey);
  if (existing) return existing;
  const created = await call(
    attempt,
    'POST',
    '/1.0/kb/accounts',
    JSON.stringify({ name, externalKey, currency: 'USD' }),
  );
  if (created.status === 409) {
    const found = await findAccount(attempt, externalKey);
    if (found) return found;
    throw new BillingRefused('account conflict');
  }
  if (created.status !== 201) throw new BillingRefused(`account create ${created.status}`);
  const accountId = accountIdFromLocation(created.location);
  if (withExternalPaymentMethod) {
    const method = await call(
      attempt,
      'POST',
      `/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`,
      JSON.stringify({ pluginName: '__EXTERNAL_PAYMENT__', pluginInfo: {} }),
    );
    if (method.status !== 201) throw new BillingRefused(`payment method ${method.status}`);
  }
  return accountId;
}

const DEDUPE_INVOICE_SCAN = 50;

/** Looks for the licence's charge among the account's most recent invoices. */
async function hasChargeWithDescription(
  attempt: Attempt,
  accountId: string,
  description: string,
): Promise<boolean> {
  const invoices = await call(attempt, 'GET', `/1.0/kb/accounts/${accountId}/invoices`);
  if (invoices.status !== 200) throw new BillingRefused(`invoice list ${invoices.status}`);
  const list = JSON.parse(invoices.text) as Array<{ invoiceId: string; invoiceDate: string }>;
  const recent = [...list]
    .sort((left, right) => (left.invoiceDate < right.invoiceDate ? 1 : -1))
    .slice(0, DEDUPE_INVOICE_SCAN);
  const details = await Promise.all(
    recent.map((invoice) => call(attempt, 'GET', `/1.0/kb/invoices/${invoice.invoiceId}`)),
  );
  for (const detail of details) {
    if (detail.status !== 200) throw new BillingRefused(`invoice read ${detail.status}`);
    const parsed = JSON.parse(detail.text) as { items?: Array<{ description?: string }> };
    if ((parsed.items ?? []).some((item) => item.description === description)) return true;
  }
  return false;
}

export interface LicenceChargeRequest {
  newsroomSlug: string;
  newsroomName: string;
  licenceId: string;
  kind: 'exclusive' | 'standard';
  /** Exact cents written with two decimals. */
  amount: string;
  /** A retried attempt looks for the charge before raising it again. */
  retry: boolean;
}

/** Raises the one committed external charge for a licence, skipping it when it already exists. */
export async function raiseLicenceCharge(request: LicenceChargeRequest): Promise<void> {
  const attempt: Attempt = { startedAt: Date.now() };
  const description = `Saltprint licence ${request.licenceId} · ${request.kind}`;
  const accountId = await ensureAccount(
    attempt,
    `newsroom-${request.newsroomSlug}`,
    request.newsroomName,
    false,
  );
  if (request.retry && (await hasChargeWithDescription(attempt, accountId, description))) return;
  const body = `[{"accountId":"${accountId}","amount":${request.amount},"currency":"USD","description":${JSON.stringify(description)}}]`;
  const charge = await call(
    attempt,
    'POST',
    `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`,
    body,
  );
  if (charge.status !== 200 && charge.status !== 201) {
    throw new BillingRefused(`charge ${charge.status} ${charge.text.slice(0, 200)}`);
  }
}

export interface PayoutRequest {
  handle: string;
  name: string;
  month: string;
  /** Exact cents written with two decimals. */
  amount: string;
}

/** Records one CREDIT payment per contributor and month, exactly once. */
export async function recordPayout(request: PayoutRequest): Promise<void> {
  const attempt: Attempt = { startedAt: Date.now() };
  const accountId = await ensureAccount(attempt, `contributor-${request.handle}`, request.name, true);
  const externalKey = `payout-${request.month}-${request.handle}`;
  const body = `{"transactionType":"CREDIT","amount":${request.amount},"currency":"USD","paymentExternalKey":${JSON.stringify(externalKey)},"transactionExternalKey":${JSON.stringify(externalKey)}}`;
  const payment = await call(attempt, 'POST', `/1.0/kb/accounts/${accountId}/payments`, body);
  if (payment.status === 201) return;
  if (payment.status === 400 && payment.text.includes('already exists')) return;
  throw new BillingRefused(`payout ${payment.status} ${payment.text.slice(0, 200)}`);
}
