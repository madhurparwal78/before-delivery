import { config } from '../config.js';

export class BillingUnavailable extends Error {}

export interface ChargeItem {
  description: string;
  amountCents: number;
}

export interface RecordedItem {
  invoiceItemId: string;
  description: string;
  amountCents: number;
}

export interface RecordedCharge {
  invoiceId: string;
  items: RecordedItem[];
}

export type WriteReason = 'order_placed' | 'order_cancelled';

const REQUEST_TIMEOUT_MS = 10000;

function authHeaders(): Record<string, string> {
  const basic = Buffer.from(`${config.killbillUsername}:${config.killbillPassword}`).toString('base64');
  return {
    Authorization: `Basic ${basic}`,
    'X-Killbill-ApiKey': config.killbillApiKey,
    'X-Killbill-ApiSecret': config.killbillApiSecret,
    Accept: 'application/json',
  };
}

function writeHeaders(reason: WriteReason, comment: string): Record<string, string> {
  return {
    ...authHeaders(),
    'Content-Type': 'application/json',
    'X-Killbill-CreatedBy': 'tern-foils',
    'X-Killbill-Reason': reason,
    'X-Killbill-Comment': comment,
  };
}

async function call(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${config.killbillUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new BillingUnavailable('Kill Bill is unreachable');
  }
}

function dollars(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function accountKeyFor(email: string): string {
  return `tern-${email.toLowerCase()}`;
}

async function findAccountId(externalKey: string): Promise<string | null> {
  const response = await call(`/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`, {
    method: 'GET',
    headers: authHeaders(),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new BillingUnavailable('Kill Bill account lookup failed');
  const account = (await response.json()) as { accountId?: string };
  return account.accountId ?? null;
}

/** One Kill Bill account per customer, created during the first successful placement. */
export async function ensureAccount(input: {
  email: string;
  name: string;
  country: string;
  orderNumber: string;
}): Promise<{ accountId: string; externalKey: string }> {
  const externalKey = accountKeyFor(input.email);
  const response = await call('/1.0/kb/accounts', {
    method: 'POST',
    headers: writeHeaders('order_placed', input.orderNumber),
    body: JSON.stringify({
      externalKey,
      name: input.name,
      email: input.email,
      currency: 'USD',
      country: input.country,
    }),
  });

  if (response.status === 201) {
    const location = response.headers.get('location') ?? '';
    const accountId = location.split('/').pop();
    if (accountId) return { accountId, externalKey };
  } else if (response.status !== 409) {
    throw new BillingUnavailable('Kill Bill account creation failed');
  }

  const existing = await findAccountId(externalKey);
  if (!existing) throw new BillingUnavailable('Kill Bill account missing after creation');
  return { accountId: existing, externalKey };
}

/** One call per placed order: all items land on a single committed invoice. */
export async function recordCharge(
  accountId: string,
  orderNumber: string,
  items: ChargeItem[],
): Promise<RecordedCharge> {
  const response = await call(`/1.0/kb/invoices/charges/${accountId}?autoCommit=true`, {
    method: 'POST',
    headers: writeHeaders('order_placed', orderNumber),
    body: JSON.stringify(
      items.map((item) => ({
        accountId,
        amount: dollars(item.amountCents),
        currency: 'USD',
        description: item.description,
      })),
    ),
  });
  if (!response.ok) throw new BillingUnavailable('Kill Bill charge failed');

  const created = (await response.json()) as { invoiceItemId: string; invoiceId: string; description: string }[];
  const first = created[0];
  if (!first) throw new BillingUnavailable('Kill Bill returned no invoice items');
  return {
    invoiceId: first.invoiceId,
    items: created.map((row) => {
      const match = items.find((item) => item.description === row.description);
      return {
        invoiceItemId: row.invoiceItemId,
        description: row.description,
        amountCents: match?.amountCents ?? 0,
      };
    }),
  };
}

export async function adjustItem(
  accountId: string,
  invoiceId: string,
  item: RecordedItem,
  reason: WriteReason,
  orderNumber: string,
): Promise<void> {
  const response = await call(`/1.0/kb/invoices/${invoiceId}`, {
    method: 'POST',
    headers: writeHeaders(reason, orderNumber),
    body: JSON.stringify({
      accountId,
      invoiceId,
      invoiceItemId: item.invoiceItemId,
      amount: dollars(item.amountCents),
      currency: 'USD',
      description: item.description,
    }),
  });
  if (!response.ok) throw new BillingUnavailable('Kill Bill adjustment failed');
}
