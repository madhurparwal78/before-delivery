import { env } from '../env.js';

const CREATED_BY = 'pilotlight';
const CURRENCY = 'USD';

function headers(): Record<string, string> {
  const basic = Buffer.from(`${env.killbill.username}:${env.killbill.password}`).toString('base64');
  return {
    Authorization: `Basic ${basic}`,
    'X-Killbill-ApiKey': env.killbill.apiKey,
    'X-Killbill-ApiSecret': env.killbill.apiSecret,
    'X-Killbill-CreatedBy': CREATED_BY,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  const response = await fetch(`${env.killbill.url}${path}`, {
    method,
    headers: headers(),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  if (response.status >= 500 || response.status === 0) {
    throw new Error(`Kill Bill answered ${response.status}`);
  }
  return response;
}

function toAmount(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export interface BillingAccountDetails {
  memberId: string;
  business: string;
  contactEmail: string;
}

export interface PostedCharge {
  description: string;
  amount_cents: number;
}

export async function ensureBillingAccount(details: BillingAccountDetails): Promise<string> {
  const lookup = await call(
    'GET',
    `/1.0/kb/accounts?externalKey=${encodeURIComponent(details.memberId)}`,
  );
  if (lookup.ok) {
    const account = (await lookup.json()) as { accountId?: string };
    if (account.accountId) return account.accountId;
  }
  const created = await call('POST', '/1.0/kb/accounts', {
    externalKey: details.memberId,
    name: details.business,
    email: details.contactEmail,
    currency: CURRENCY,
  });
  const location = created.headers.get('location');
  if (!location) throw new Error('Kill Bill did not return the new account location');
  const accountId = location.split('/').pop();
  if (!accountId) throw new Error('Kill Bill returned an unusable account location');
  return accountId;
}

export interface PostedInvoice {
  killbillInvoiceId: string;
  items: { invoiceItemId: string; amount: number }[];
}

/** One billing invoice carrying one external charge per cash line. */
export async function postCharges(
  accountId: string,
  charges: PostedCharge[],
): Promise<PostedInvoice> {
  const response = await call(
    'POST',
    `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`,
    charges.map((charge) => ({
      accountId,
      amount: toAmount(charge.amount_cents),
      currency: CURRENCY,
      description: charge.description,
    })),
  );
  if (!response.ok) throw new Error(`Kill Bill refused the charges with ${response.status}`);
  const items = (await response.json()) as {
    invoiceItemId: string;
    invoiceId: string;
    amount: number;
  }[];
  const invoiceId = items[0]?.invoiceId;
  if (!invoiceId) throw new Error('Kill Bill returned no invoice for the charges');
  return {
    killbillInvoiceId: invoiceId,
    items: items.map((item) => ({ invoiceItemId: item.invoiceItemId, amount: item.amount })),
  };
}

export async function postCredit(
  accountId: string,
  amountCents: number,
  description: string,
): Promise<void> {
  const response = await call('POST', '/1.0/kb/credits?autoCommit=true', [
    { accountId, amount: toAmount(amountCents), currency: CURRENCY, description },
  ]);
  if (!response.ok) throw new Error(`Kill Bill refused the credit with ${response.status}`);
}

/** Adjusts every item of a just-posted invoice to zero, so its balance reads $0.00. */
export async function reverseInvoice(accountId: string, posted: PostedInvoice): Promise<void> {
  for (const item of posted.items) {
    await call('POST', `/1.0/kb/invoices/${posted.killbillInvoiceId}`, {
      accountId,
      invoiceId: posted.killbillInvoiceId,
      invoiceItemId: item.invoiceItemId,
      amount: item.amount,
      currency: CURRENCY,
    });
  }
}

export async function readInvoiceAmountCents(killbillInvoiceId: string): Promise<number | null> {
  const response = await call('GET', `/1.0/kb/invoices/${killbillInvoiceId}`);
  if (!response.ok) return null;
  const invoice = (await response.json()) as { amount?: number };
  return typeof invoice.amount === 'number' ? toCents(invoice.amount) : null;
}

export async function probeBilling(): Promise<void> {
  const response = await fetch(`${env.killbill.url}/1.0/kb/tenants/userKeyValue/pilotlight-probe`, {
    method: 'GET',
    headers: headers(),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Kill Bill answered ${response.status}`);
}
