import { env } from '../env.js';

const REQUEST_TIMEOUT_MS = 8_000;
const CREATED_BY = 'crosshand-relay';

export const CURRENCY = 'USD';

export function accountExternalKey(organisationCode: string): string {
  return `crosshand-${organisationCode}`;
}

function headers(): Record<string, string> {
  const basic = Buffer.from(`${env.killbill.username}:${env.killbill.password}`).toString('base64');
  return {
    authorization: `Basic ${basic}`,
    'x-killbill-apikey': env.killbill.apiKey,
    'x-killbill-apisecret': env.killbill.apiSecret,
    'x-killbill-createdby': CREATED_BY,
    'content-type': 'application/json',
    accept: 'application/json',
  };
}

async function request(method: string, path: string, body?: unknown): Promise<Response> {
  const init: RequestInit = {
    method,
    headers: headers(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return fetch(`${env.killbill.url}${path}`, init);
}

interface AccountResponse {
  accountId: string;
}

interface InvoiceItemResponse {
  invoiceId: string;
  description: string | null;
}

interface InvoiceResponse {
  invoiceId: string;
  items: InvoiceItemResponse[] | null;
}

async function findAccountId(externalKey: string): Promise<string | null> {
  const response = await request('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  if (response.status === 404) {
    await response.arrayBuffer();
    return null;
  }
  if (!response.ok) throw new Error(`Kill Bill account lookup failed: ${response.status}`);
  const account = (await response.json()) as AccountResponse;
  return account.accountId;
}

export async function ensureAccount(organisationCode: string, organisationName: string): Promise<string> {
  const externalKey = accountExternalKey(organisationCode);
  const existing = await findAccountId(externalKey);
  if (existing !== null) return existing;
  const created = await request('POST', '/1.0/kb/accounts', {
    externalKey,
    name: organisationName,
    currency: CURRENCY,
  });
  await created.arrayBuffer();
  if (!created.ok && created.status !== 409) {
    throw new Error(`Kill Bill account creation failed: ${created.status}`);
  }
  const accountId = await findAccountId(externalKey);
  if (accountId === null) throw new Error('Kill Bill account missing after creation');
  return accountId;
}

/**
 * Finds an already-posted item with this description, so a charge whose first attempt
 * timed out after Kill Bill accepted it is adopted rather than charged twice. The account
 * invoice list carries no items, so each invoice is read in turn.
 */
export async function findInvoiceIdByDescription(
  accountId: string,
  description: string,
): Promise<string | null> {
  const list = await request('GET', `/1.0/kb/accounts/${accountId}/invoices`);
  if (!list.ok) throw new Error(`Kill Bill invoice lookup failed: ${list.status}`);
  const invoices = (await list.json()) as InvoiceResponse[];
  for (const summary of invoices) {
    const detail = await request('GET', `/1.0/kb/invoices/${summary.invoiceId}?withItems=true`);
    if (!detail.ok) throw new Error(`Kill Bill invoice read failed: ${detail.status}`);
    const invoice = (await detail.json()) as InvoiceResponse;
    for (const item of invoice.items ?? []) {
      if (item.description === description) return invoice.invoiceId;
    }
  }
  return null;
}

export async function postExternalCharge(
  accountId: string,
  amount: string,
  description: string,
): Promise<string> {
  const response = await request('POST', `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`, [
    { accountId, amount, currency: CURRENCY, description },
  ]);
  if (!response.ok) throw new Error(`Kill Bill charge failed: ${response.status}`);
  const items = (await response.json()) as InvoiceItemResponse[];
  const invoiceId = items[0]?.invoiceId;
  if (invoiceId === undefined) throw new Error('Kill Bill returned no invoice item');
  return invoiceId;
}
