/** Kill Bill accounts, draft invoice items and commits. */
import { config } from '../config.js';

export class BillingUnavailable extends Error {}

function headers(): Record<string, string> {
  const basic = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString(
    'base64',
  );
  return {
    authorization: `Basic ${basic}`,
    'x-killbill-apikey': config.killbill.apiKey,
    'x-killbill-apisecret': config.killbill.apiSecret,
    'x-killbill-createdby': 'lineboard',
    'content-type': 'application/json',
    accept: 'application/json',
  };
}

async function call(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<{ status: number; text: string; location: string | null }> {
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}${path}`, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new BillingUnavailable();
  }
  const text = await response.text();
  if (response.status >= 500) throw new BillingUnavailable();
  return { status: response.status, text, location: response.headers.get('location') };
}

export async function billingReachable(): Promise<boolean> {
  try {
    const response = await call('GET', '/1.0/kb/test/clock');
    return response.status < 500;
  } catch {
    return false;
  }
}

/** The member's account id, created on demand with the member id as external key. */
export async function ensureAccount(memberId: string, businessName: string): Promise<string> {
  const existing = await call(
    'GET',
    `/1.0/kb/accounts?externalKey=${encodeURIComponent(memberId)}`,
  );
  if (existing.status === 200 && existing.text.length > 0) {
    const parsed = JSON.parse(existing.text) as { accountId?: string };
    if (parsed.accountId) return parsed.accountId;
  }
  const created = await call('POST', '/1.0/kb/accounts', {
    name: toBmp(businessName),
    externalKey: memberId,
    currency: 'USD',
  });
  if (created.status === 201 && created.location) {
    const id = created.location.split('/').pop();
    if (id) return id;
  }
  const retry = await call('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(memberId)}`);
  if (retry.status === 200 && retry.text.length > 0) {
    const parsed = JSON.parse(retry.text) as { accountId?: string };
    if (parsed.accountId) return parsed.accountId;
  }
  throw new BillingUnavailable();
}

/** Kill Bill stores only the Basic Multilingual Plane. */
export function toBmp(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    out += code > 0xffff ? '\uFFFD' : char;
  }
  return out;
}

export async function setAccountName(accountId: string, name: string): Promise<void> {
  const response = await call('PUT', `/1.0/kb/accounts/${accountId}?treatNullAsReset=false`, {
    accountId,
    name: toBmp(name),
  });
  if (response.status >= 400) throw new BillingUnavailable();
}

function dollars(cents: number): number {
  return Math.round(cents) / 100;
}

export type PostedItem = { invoiceId: string; itemId: string };

export async function postCharge(
  accountId: string,
  invoiceId: string | null,
  amountCents: number,
  description: string,
  startDate: string,
): Promise<PostedItem> {
  const item: Record<string, unknown> = {
    accountId,
    amount: dollars(amountCents),
    currency: 'USD',
    description,
    startDate,
  };
  if (invoiceId) item['invoiceId'] = invoiceId;
  const response = await call(
    'POST',
    `/1.0/kb/invoices/charges/${accountId}?autoCommit=false`,
    [item],
  );
  if (response.status >= 400) throw new BillingUnavailable();
  const parsed = JSON.parse(response.text) as Array<{ invoiceId: string; invoiceItemId: string }>;
  const first = parsed[0];
  if (!first) throw new BillingUnavailable();
  return { invoiceId: first.invoiceId, itemId: first.invoiceItemId };
}

export async function postCredit(
  accountId: string,
  invoiceId: string | null,
  amountCents: number,
  description: string,
): Promise<PostedItem> {
  const item: Record<string, unknown> = {
    accountId,
    amount: dollars(Math.abs(amountCents)),
    currency: 'USD',
    description,
  };
  if (invoiceId) item['invoiceId'] = invoiceId;
  const response = await call('POST', '/1.0/kb/credits?autoCommit=false', [item]);
  if (response.status >= 400) throw new BillingUnavailable();
  const parsed = JSON.parse(response.text) as Array<{ invoiceId: string; invoiceItemId: string }>;
  const first = parsed[0];
  if (!first) throw new BillingUnavailable();
  return { invoiceId: first.invoiceId, itemId: first.invoiceItemId };
}

type InvoiceItem = { itemType: string; amount: number };

export type InvoiceState = { status: string; amountCents: number };

/** An invoice's status and its Kill Bill amount: every item except CBA_ADJ. */
export async function invoiceState(invoiceId: string): Promise<InvoiceState | null> {
  const response = await call('GET', `/1.0/kb/invoices/${invoiceId}?withItems=true`);
  if (response.status === 404) return null;
  if (response.status >= 400) throw new BillingUnavailable();
  const parsed = JSON.parse(response.text) as { items?: InvoiceItem[]; status?: string };
  let amountCents = 0;
  for (const item of parsed.items ?? []) {
    if (item.itemType === 'CBA_ADJ') continue;
    amountCents += Math.round(item.amount * 100);
  }
  return { status: parsed.status ?? 'DRAFT', amountCents };
}

export async function commitInvoice(invoiceId: string): Promise<void> {
  const response = await call('PUT', `/1.0/kb/invoices/${invoiceId}/commitInvoice`);
  if (response.status >= 400) throw new BillingUnavailable();
}
