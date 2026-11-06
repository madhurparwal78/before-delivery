import { config } from '../config.ts';
import type { Currency } from '../../domain/markets.ts';
import { currencyDecimals } from '../../domain/money.ts';

export class BillingUnavailable extends Error {
  constructor(cause?: unknown) {
    super('billing unavailable');
    this.name = 'BillingUnavailable';
    this.cause = cause;
  }
}

export interface InvoiceItemInput {
  description: string;
  amountMinor: number;
}

export interface CreatedInvoice {
  invoiceId: string;
  invoiceNumber: string;
}

function headers(): Record<string, string> {
  const basic = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString(
    'base64',
  );
  return {
    authorization: `Basic ${basic}`,
    'x-killbill-apikey': config.killbill.apiKey,
    'x-killbill-apisecret': config.killbill.apiSecret,
    'x-killbill-createdby': 'hourline',
    'content-type': 'application/json',
    accept: 'application/json',
  };
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}${path}`, {
      ...init,
      headers: headers(),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new BillingUnavailable(error);
  }
  if (response.status >= 500) throw new BillingUnavailable(new Error(`status ${response.status}`));
  return response;
}

/** The major-unit amount Kill Bill expects: two decimals, or whole yen for JPY. */
function majorUnits(minor: number, currency: Currency): number {
  const decimals = currencyDecimals(currency);
  return decimals === 0 ? minor : minor / 10 ** decimals;
}

async function findAccountId(externalKey: string): Promise<string | null> {
  const response = await call(`/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new BillingUnavailable(new Error(`status ${response.status}`));
  const body = (await response.json()) as { accountId?: string } | null;
  return body?.accountId ?? null;
}

/** One Kill Bill account per stockist, created at its first confirmation. */
export async function ensureAccount(
  stockistId: string,
  name: string,
  currency: Currency,
): Promise<string> {
  const externalKey = `hourline-${stockistId}`;
  const existing = await findAccountId(externalKey);
  if (existing !== null) return existing;

  const response = await call('/1.0/kb/accounts', {
    method: 'POST',
    body: JSON.stringify({ externalKey, name, currency }),
  });
  if (response.status === 201) {
    const location = response.headers.get('location');
    const id = location === null ? null : (location.split('/').pop() ?? null);
    if (id !== null && id !== '') return id;
  }
  if (response.status === 409) {
    const found = await findAccountId(externalKey);
    if (found !== null) return found;
  }
  throw new BillingUnavailable(new Error(`account create status ${response.status}`));
}

/** One committed invoice on the account, with one external charge item per priced line. */
export async function createCommittedInvoice(
  accountId: string,
  currency: Currency,
  items: readonly InvoiceItemInput[],
): Promise<CreatedInvoice> {
  const body = items.map((item) => ({
    accountId,
    amount: majorUnits(item.amountMinor, currency),
    currency,
    description: item.description,
  }));
  const response = await call(
    `/1.0/kb/invoices/charges/${encodeURIComponent(accountId)}?autoCommit=true`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  if (!response.ok) {
    throw new BillingUnavailable(new Error(`charge status ${response.status}`));
  }
  const created = (await response.json()) as ReadonlyArray<{ invoiceId?: string }>;
  const invoiceId = created[0]?.invoiceId;
  if (invoiceId === undefined) {
    throw new BillingUnavailable(new Error('no invoice returned'));
  }

  const lookup = await call(`/1.0/kb/invoices/${encodeURIComponent(invoiceId)}`);
  if (!lookup.ok) throw new BillingUnavailable(new Error(`invoice status ${lookup.status}`));
  const invoice = (await lookup.json()) as { invoiceNumber?: string };
  if (invoice.invoiceNumber === undefined) {
    throw new BillingUnavailable(new Error('no invoice number'));
  }
  return { invoiceId, invoiceNumber: invoice.invoiceNumber };
}
