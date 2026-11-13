import { env } from '../env.js';

export class BillingUnavailable extends Error {
  constructor(cause?: unknown) {
    super('Kill Bill is unreachable');
    this.name = 'BillingUnavailable';
    this.cause = cause;
  }
}

export interface KillbillItem {
  invoiceItemId: string;
  itemType: string;
  amount: number;
  description: string | null;
  linkedInvoiceItemId: string | null;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const basic = Buffer.from(`${env.killbillUsername}:${env.killbillPassword}`).toString('base64');
  return {
    authorization: `Basic ${basic}`,
    'x-killbill-apikey': env.killbillApiKey,
    'x-killbill-apisecret': env.killbillApiSecret,
    'x-killbill-createdby': 'relayline',
    accept: 'application/json',
    ...extra,
  };
}

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; location: string | null; text: string }> {
  const init: RequestInit = {
    method,
    headers: body === undefined ? headers() : headers({ 'content-type': 'application/json' }),
    signal: AbortSignal.timeout(8_000),
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  let response: Response;
  try {
    response = await fetch(`${env.killbillUrl}${path}`, init);
  } catch (cause) {
    throw new BillingUnavailable(cause);
  }
  const text = await response.text();
  if (response.status >= 500) throw new BillingUnavailable();
  return { status: response.status, location: response.headers.get('location'), text };
}

function parse<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new BillingUnavailable(cause);
  }
}

export async function findAccountId(orgId: string): Promise<string | null> {
  const found = await call('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(orgId)}`);
  if (found.status === 404) return null;
  if (found.status !== 200) throw new BillingUnavailable();
  const account = parse<{ accountId?: string }>(found.text);
  return account.accountId ?? null;
}

export async function createAccount(orgId: string, orgName: string): Promise<string> {
  const created = await call('POST', '/1.0/kb/accounts', {
    externalKey: orgId,
    name: orgName,
    currency: 'USD',
  });
  if (created.status === 201 && created.location) {
    const accountId = created.location.split('/').pop();
    if (accountId) return accountId;
  }
  const existing = await findAccountId(orgId);
  if (existing) return existing;
  throw new BillingUnavailable();
}

export async function accountItems(accountId: string): Promise<KillbillItem[]> {
  const response = await call(
    'GET',
    `/1.0/kb/accounts/${accountId}/invoices?withItems=true&includeInvoiceComponents=true`,
  );
  if (response.status !== 200) throw new BillingUnavailable();
  const invoices = parse<{ items?: KillbillItem[] }[]>(response.text);
  return invoices.flatMap((invoice) => invoice.items ?? []);
}

export async function postExternalCharge(
  accountId: string,
  amountCents: number,
  description: string,
): Promise<void> {
  const response = await call(
    'POST',
    `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`,
    [
      {
        accountId,
        amount: Number((amountCents / 100).toFixed(2)),
        currency: 'USD',
        description,
      },
    ],
  );
  if (response.status !== 200 && response.status !== 201) throw new BillingUnavailable();
}

export function itemAmountCents(items: readonly KillbillItem[], invoiceItemId: string): number {
  const charge = items.find((item) => item.invoiceItemId === invoiceItemId);
  if (!charge) throw new BillingUnavailable();
  const adjustments = items
    .filter((item) => item.linkedInvoiceItemId === invoiceItemId)
    .reduce((total, item) => total + Math.round(item.amount * 100), 0);
  return Math.round(charge.amount * 100) + adjustments;
}
