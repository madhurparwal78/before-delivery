import { config } from '../config.js';
import { billingUnavailable } from '../http/errors.js';
import { query } from '../db.js';

type ChargeItem = { description: string; amountCents: number };

const TIMEOUT_MS = 5_000;

function headers(): Record<string, string> {
  const basic = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64');
  return {
    Authorization: `Basic ${basic}`,
    'X-Killbill-ApiKey': config.killbill.apiKey,
    'X-Killbill-ApiSecret': config.killbill.apiSecret,
    'X-Killbill-CreatedBy': 'rungboard',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; text: string; location: string | null }> {
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}${path}`, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw billingUnavailable();
  }
  const text = await response.text().catch(() => '');
  if (response.status >= 500) throw billingUnavailable();
  return { status: response.status, text, location: response.headers.get('location') };
}

function dollars(amountCents: number): number {
  return Number((amountCents / 100).toFixed(2));
}

export type BillingClient = {
  id: string;
  slug: string;
  company: string;
  contact_email: string;
  killbill_account_id: string | null;
};

/** One CAD account per client, created on first use. */
export async function ensureAccount(client: BillingClient): Promise<string> {
  if (client.killbill_account_id) return client.killbill_account_id;
  const externalKey = `rungboard-client-${client.slug}`;
  const existing = await call('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  let accountId: string | null = null;
  if (existing.status === 200 && existing.text) {
    const parsed = JSON.parse(existing.text) as { accountId?: string };
    accountId = parsed.accountId ?? null;
  }
  if (!accountId) {
    const created = await call('POST', '/1.0/kb/accounts', {
      name: client.company,
      externalKey,
      currency: 'CAD',
      email: client.contact_email,
    });
    if (created.status !== 201 || !created.location) throw billingUnavailable();
    accountId = created.location.split('/').pop() ?? null;
    if (!accountId) throw billingUnavailable();
  }
  await query('UPDATE clients SET killbill_account_id = $2 WHERE id = $1', [client.id, accountId]);
  return accountId;
}

async function addCharges(accountId: string, items: ChargeItem[], autoCommit: boolean): Promise<string> {
  const payload = items.map((item) => ({
    accountId,
    amount: dollars(item.amountCents),
    currency: 'CAD',
    description: item.description,
  }));
  const response = await call(
    'POST',
    `/1.0/kb/invoices/charges/${accountId}?autoCommit=${autoCommit ? 'true' : 'false'}`,
    payload,
  );
  if (response.status !== 200 && response.status !== 201) throw billingUnavailable();
  const created = JSON.parse(response.text) as Array<{ invoiceId: string }>;
  const invoiceId = created[0]?.invoiceId;
  if (!invoiceId) throw billingUnavailable();
  return invoiceId;
}

/** One DRAFT invoice holding one item per booking fee line. */
export async function createDraftInvoice(accountId: string, items: ChargeItem[]): Promise<string> {
  return addCharges(accountId, items, false);
}

export async function createCommittedCharge(accountId: string, item: ChargeItem): Promise<string> {
  return addCharges(accountId, [item], true);
}

export async function commitInvoice(invoiceId: string): Promise<void> {
  const response = await call('PUT', `/1.0/kb/invoices/${invoiceId}/commitInvoice`);
  if (response.status !== 204 && response.status !== 200) throw billingUnavailable();
}

export async function voidInvoice(invoiceId: string): Promise<void> {
  await call('PUT', `/1.0/kb/invoices/${invoiceId}/voidInvoice`).catch(() => undefined);
}

export async function createCredit(accountId: string, item: ChargeItem): Promise<void> {
  const response = await call('POST', '/1.0/kb/credits?autoCommit=true', [
    {
      accountId,
      amount: dollars(item.amountCents),
      currency: 'CAD',
      description: item.description,
    },
  ]);
  if (response.status !== 200 && response.status !== 201) throw billingUnavailable();
}
