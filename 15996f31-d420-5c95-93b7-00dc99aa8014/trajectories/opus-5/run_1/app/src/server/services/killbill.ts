import { config } from '../config';
import { ProviderUnavailable } from '../http/errors';

const REQUEST_TIMEOUT_MS = 8_000;
const CREATED_BY = 'Swarmline Bloom Desk';

interface KillbillResponse {
  status: number;
  location: string | null;
  json: unknown;
}

function authHeaders(): Record<string, string> {
  const basic = Buffer.from(
    `${config.killbill.username}:${config.killbill.password}`,
    'utf8',
  ).toString('base64');
  return {
    Authorization: `Basic ${basic}`,
    'X-Killbill-ApiKey': config.killbill.apiKey,
    'X-Killbill-ApiSecret': config.killbill.apiSecret,
    'X-Killbill-CreatedBy': CREATED_BY,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function call(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<KillbillResponse> {
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}${path}`, {
      method,
      headers: authHeaders(),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new ProviderUnavailable('billing', `Kill Bill is unreachable for ${method} ${path}`);
  }
  if (response.status >= 500) {
    throw new ProviderUnavailable('billing', `Kill Bill answered ${response.status}`);
  }
  const raw = await response.text();
  let json: unknown = null;
  if (raw.length > 0) {
    try {
      json = JSON.parse(raw) as unknown;
    } catch {
      json = null;
    }
  }
  return { status: response.status, location: response.headers.get('location'), json };
}

function amount(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

function idFromLocation(location: string | null): string | null {
  if (location === null) return null;
  const parts = location.split('/').filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? null;
}

export interface GrowerAccountInput {
  growerId: string;
  businessName: string;
  email: string;
}

/**
 * The grower's Kill Bill account, keyed externally by the grower id. The
 * account carries no default payment method, so an invoice stays unpaid until
 * the broker settles the orchard.
 */
export async function ensureGrowerAccount(input: GrowerAccountInput): Promise<string> {
  const found = await call(
    'GET',
    `/1.0/kb/accounts?externalKey=${encodeURIComponent(input.growerId)}`,
  );
  if (found.status === 200) {
    const accountId = readAccountId(found.json);
    if (accountId !== null) return accountId;
  }
  const created = await call('POST', '/1.0/kb/accounts', {
    externalKey: input.growerId,
    name: input.businessName,
    currency: 'USD',
    email: input.email,
  });
  const accountId = idFromLocation(created.location);
  if (accountId !== null) return accountId;
  const retry = await call(
    'GET',
    `/1.0/kb/accounts?externalKey=${encodeURIComponent(input.growerId)}`,
  );
  const existing = readAccountId(retry.json);
  if (existing === null) throw new ProviderUnavailable('billing', 'Kill Bill account not created');
  return existing;
}

function readAccountId(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) return null;
  const value = (json as Record<string, unknown>).accountId;
  return typeof value === 'string' ? value : null;
}

export interface ChargeLine {
  description: string;
  cents: number;
}

/** One committed invoice holding the given external charges; returns its id. */
export async function recordExternalCharges(
  accountId: string,
  lines: readonly ChargeLine[],
): Promise<string> {
  const response = await call(
    'POST',
    `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`,
    lines.map((line) => ({
      accountId,
      amount: amount(line.cents),
      currency: 'USD',
      description: line.description,
    })),
  );
  if (!Array.isArray(response.json) || response.json.length === 0) {
    throw new ProviderUnavailable('billing', 'Kill Bill did not return an invoice');
  }
  const first = response.json[0] as Record<string, unknown>;
  const invoiceId = first.invoiceId;
  if (typeof invoiceId !== 'string') {
    throw new ProviderUnavailable('billing', 'Kill Bill did not return an invoice id');
  }
  return invoiceId;
}

export async function recordAccountCredit(
  accountId: string,
  cents: number,
  description: string,
): Promise<void> {
  await call('POST', '/1.0/kb/credits?autoCommit=true', [
    { accountId, amount: amount(cents), currency: 'USD', description },
  ]);
}

export async function voidInvoice(invoiceId: string): Promise<void> {
  await call('PUT', `/1.0/kb/invoices/${invoiceId}/voidInvoice`);
}

/** One external payment, idempotent on its external key. */
export async function recordExternalPayment(input: {
  accountId: string;
  invoiceId: string;
  cents: number;
  externalKey: string;
}): Promise<void> {
  await call(
    'POST',
    `/1.0/kb/invoices/${input.invoiceId}/payments?externalPayment=true`,
    {
      targetInvoiceId: input.invoiceId,
      accountId: input.accountId,
      purchasedAmount: amount(input.cents),
      currency: 'USD',
      paymentExternalKey: input.externalKey,
    },
  );
}

export async function unpaidInvoiceId(accountId: string): Promise<string | null> {
  const response = await call('GET', `/1.0/kb/accounts/${accountId}/invoices?unpaidInvoicesOnly=true`);
  if (!Array.isArray(response.json)) return null;
  for (const entry of response.json) {
    const invoice = entry as Record<string, unknown>;
    if (typeof invoice.invoiceId === 'string') return invoice.invoiceId;
  }
  return null;
}
