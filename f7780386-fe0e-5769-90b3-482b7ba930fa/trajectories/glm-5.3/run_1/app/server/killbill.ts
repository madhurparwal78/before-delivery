// Kill Bill client: every member is one account in US dollars, keyed by the
// member id. Charges, payments and credits are each made once per business
// event. When Kill Bill is unreachable, callers queue work instead.

import { loadConfig } from './config.js';

export class KillBillUnavailable extends Error {}

// Kill Bill answers under its context path; hosted bundles differ. The
// client probes the known prefixes once and remembers which answers.
const CONTEXT_CANDIDATES = ['', '/killbill'];
let contextPath: string | null = null;

async function detectContext(): Promise<string> {
  if (contextPath !== null) return contextPath;
  const root = loadConfig().killbillUrl.replace(/\/+$/, '');
  for (const candidate of CONTEXT_CANDIDATES) {
    try {
      const res = await fetch(`${root}${candidate}/v1/healthcheck`, {
        headers: authHeaders(),
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok || res.status === 401) {
        contextPath = candidate;
        return candidate;
      }
    } catch {
      // try the next candidate
    }
  }
  throw new KillBillUnavailable('killbill context not found');
}

interface AccountJson {
  accountId: string;
  externalKey?: string;
  name?: string;
  email?: string;
}

interface InvoiceItemJson {
  invoiceItemId?: string;
  description?: string;
  amount?: number;
}

interface InvoiceJson {
  invoiceId: string;
  invoiceNumber?: number;
  invoiceDate?: string;
  amount?: number;
  balance?: number;
  status?: string;
  items?: InvoiceItemJson[];
}

interface PaymentJson {
  paymentId: string;
  transactions?: { transactionId: string; status?: string }[];
}

export interface KbInvoice {
  id: string;
  date: string;
  amount: string;
  balance: string;
  items: { description: string; amount: string }[];
}

function base(): Promise<string> {
  return detectContext().then((ctx) => loadConfig().killbillUrl.replace(/\/+$/, '') + ctx + '/v1');
}

function authHeaders(): Record<string, string> {
  const c = loadConfig();
  const basic = Buffer.from(`${c.killbillUsername}:${c.killbillPassword}`).toString('base64');
  return {
    Authorization: `Basic ${basic}`,
    'X-Killbill-Api-Key': c.killbillApiKey,
    'X-Killbill-Api-Secret': c.killbillApiSecret,
    'X-Killbill-Created-By': 'passboard',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function call(method: string, path: string, body?: string): Promise<Response> {
  const { signal, clearTimeout: clear } = timeout(8000);
  try {
    return await fetch((await base()) + path, { method, headers: authHeaders(), body, signal });
  } catch {
    throw new KillBillUnavailable('killbill unreachable');
  } finally {
    clear();
  }
}

function timeout(ms: number): { signal: AbortSignal; clearTimeout(): void } {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clearTimeout: () => clearTimeout(t) };
}

async function callJson(method: string, path: string, body?: string): Promise<{ status: number; json: unknown }> {
  const res = await call(method, path, body);
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: res.status, json };
}

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

function centsFromKb(amount: number): string {
  return amount.toFixed(2);
}

/** Reuses an existing account with the external key or creates one. */
export async function ensureAccount(memberId: string, businessName: string, contactEmail: string): Promise<string> {
  const found = await callJson('GET', `/accounts?externalKey=${encodeURIComponent(memberId)}`);
  if (found.status === 200) {
    const account = found.json as AccountJson;
    if (account.accountId) return account.accountId;
  }
  const body = JSON.stringify({ name: businessName, externalKey: memberId, email: contactEmail, currency: 'USD' });
  const created = await callJson('POST', '/accounts', body);
  if (created.status === 201) {
    const account = created.json as AccountJson;
    if (account.accountId) return account.accountId;
    throw new Error('killbill account creation returned no accountId');
  }
  if (created.status === 409 || created.status === 400) {
    const again = await callJson('GET', `/accounts?externalKey=${encodeURIComponent(memberId)}`);
    if (again.status === 200) {
      const account = again.json as AccountJson;
      if (account.accountId) return account.accountId;
    }
  }
  throw new Error(`killbill account creation failed: ${created.status}`);
}

/** An external charge on a new invoice; returns the invoice id. */
async function createCharge(accountId: string, description: string, amountCents: number): Promise<string> {
  const body = JSON.stringify([{ amount: Number(dollars(amountCents)), currency: 'USD', description }]);
  const res = await callJson('POST', `/accounts/${accountId}/charges`, body);
  if (res.status === 201) {
    const invoice = res.json as InvoiceJson;
    if (invoice.invoiceId) return invoice.invoiceId;
    throw new Error('killbill charge returned no invoiceId');
  }
  throw new Error(`killbill charge failed: ${res.status}`);
}

/** A successful external PURCHASE payment of the invoice. */
async function payInvoice(accountId: string, invoiceId: string, amountCents: number): Promise<void> {
  const body = JSON.stringify({
    accountId,
    amount: Number(dollars(amountCents)),
    currency: 'USD',
    transactionType: 'PURCHASE',
  });
  const res = await callJson('POST', `/invoices/${invoiceId}/payments?externalPayment=true`, body);
  if (res.status === 201 || res.status === 200) {
    const payment = res.json as PaymentJson;
    const txn = payment.transactions?.[0];
    if (payment.paymentId && (!txn || txn.status === undefined || txn.status === 'SUCCESS')) return;
    throw new Error('killbill payment not successful');
  }
  throw new Error(`killbill payment failed: ${res.status}`);
}

/** Charge then pay, as one business event. Returns the invoice id. */
export async function chargeAndPay(accountId: string, description: string, amountCents: number): Promise<string> {
  const invoiceId = await createCharge(accountId, description, amountCents);
  await payInvoice(accountId, invoiceId, amountCents);
  return invoiceId;
}

/** An external charge with no payment, e.g. a late-cancellation fee. */
export async function chargeOnly(accountId: string, description: string, amountCents: number): Promise<string> {
  return createCharge(accountId, description, amountCents);
}

/** A credit on a new invoice, e.g. a waived or refunded fee. */
export async function createCredit(accountId: string, description: string, amountCents: number): Promise<void> {
  const body = JSON.stringify([
    { accountId, amount: Number(dollars(amountCents)), currency: 'USD', description },
  ]);
  const res = await callJson('POST', '/credits', body);
  if (res.status !== 201) throw new Error(`killbill credit failed: ${res.status}`);
}

export async function listInvoices(accountId: string): Promise<KbInvoice[]> {
  const res = await callJson('GET', `/accounts/${accountId}/invoices?withItems=true`);
  if (res.status !== 200) throw new Error(`killbill invoice read failed: ${res.status}`);
  const invoices = (res.json as InvoiceJson[]) ?? [];
  return invoices.map((inv) => ({
    id: inv.invoiceId,
    date: (inv.invoiceDate ?? '').slice(0, 10),
    amount: centsFromKb(inv.amount ?? 0),
    balance: centsFromKb(inv.balance ?? 0),
    items: (inv.items ?? []).map((item) => ({
      description: item.description ?? '',
      amount: centsFromKb(item.amount ?? 0),
    })),
  }));
}

export async function getInvoice(invoiceId: string): Promise<KbInvoice | null> {
  const res = await callJson('GET', `/invoices/${invoiceId}?withItems=true`);
  if (res.status === 404) return null;
  if (res.status !== 200) throw new Error(`killbill invoice read failed: ${res.status}`);
  const inv = res.json as InvoiceJson;
  return {
    id: inv.invoiceId,
    date: (inv.invoiceDate ?? '').slice(0, 10),
    amount: centsFromKb(inv.amount ?? 0),
    balance: centsFromKb(inv.balance ?? 0),
    items: (inv.items ?? []).map((item) => ({
      description: item.description ?? '',
      amount: centsFromKb(item.amount ?? 0),
    })),
  };
}

/** A cheap reachability probe; throws KillBillUnavailable when down. */
export async function probe(): Promise<void> {
  try {
    await detectContext();
  } catch (err) {
    throw err instanceof KillBillUnavailable ? err : new KillBillUnavailable('killbill unreachable');
  }
  const res = await call('GET', '/healthcheck?system=false').catch(() => {
    throw new KillBillUnavailable('killbill unreachable');
  });
  if (!res.ok) throw new KillBillUnavailable(`killbill health ${res.status}`);
}
