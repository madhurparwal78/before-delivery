import { config } from '../config.js';

/** Thrown when the billing ledger cannot be reached. */
export class LedgerUnreachable extends Error {}

const headers = {
  Authorization: `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64')}`,
  'X-Killbill-ApiKey': config.killbill.apiKey,
  'X-Killbill-ApiSecret': config.killbill.apiSecret,
  'X-Killbill-CreatedBy': 'svovlstik-press',
  'Content-Type': 'application/json',
};

function kroner(ore: number): number {
  return Number((ore / 100).toFixed(2));
}

function ore(kr: number): number {
  return Math.round(kr * 100);
}

interface LedgerReply {
  status: number;
  location: string | null;
  body: unknown;
}

async function call(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<LedgerReply> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${config.killbill.url}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    if (response.status >= 500) throw new LedgerUnreachable(`ledger ${response.status}`);
    const text = await response.text();
    if (response.status >= 400 && response.status !== 404) {
      throw new LedgerUnreachable(`ledger ${response.status} ${text.slice(0, 200)}`);
    }
    return {
      status: response.status,
      location: response.headers.get('location'),
      body: text === '' ? null : (JSON.parse(text) as unknown),
    };
  } catch (error) {
    if (error instanceof LedgerUnreachable) throw error;
    throw new LedgerUnreachable(String(error));
  } finally {
    clearTimeout(timer);
  }
}

function idFromLocation(location: string | null): string {
  if (location === null) throw new LedgerUnreachable('ledger gave no location');
  const parts = location.replace(/\/$/, '').split('/');
  return parts[parts.length - 1] as string;
}

/** One account per lowercased buyer email, keyed by that email. */
export async function accountFor(email: string, name: string): Promise<string> {
  const externalKey = email.toLowerCase();
  const found = await call('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  if (found.status === 200 && found.body !== null) {
    return String((found.body as { accountId: string }).accountId);
  }
  const created = await call('POST', '/1.0/kb/accounts', { externalKey, name, currency: 'DKK' });
  const accountId = idFromLocation(created.location);
  await call('POST', `/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`, {
    pluginName: '__EXTERNAL_PAYMENT__',
    pluginInfo: {},
  });
  return accountId;
}

export const itemDescriptions = ['maker share', 'charity share', 'VAT', 'courier'] as const;
export type ItemDescription = (typeof itemDescriptions)[number];

export interface InvoiceAmounts {
  'maker share': number;
  'charity share': number;
  VAT: number;
  courier: number;
}

/** One committed invoice per order, with the four external charges. */
export async function createInvoice(accountId: string, amounts: InvoiceAmounts): Promise<string> {
  const charges = itemDescriptions.map((description) => ({
    accountId,
    amount: kroner(amounts[description]),
    currency: 'DKK',
    description,
  }));
  const reply = await call('POST', `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`, charges);
  const items = reply.body as { invoiceId: string }[];
  const first = items[0];
  if (first === undefined) throw new LedgerUnreachable('ledger created no invoice items');
  return first.invoiceId;
}

export async function authorise(
  accountId: string,
  reference: string,
  amountOre: number,
  transactionKey: string,
): Promise<string> {
  const reply = await call('POST', `/1.0/kb/accounts/${accountId}/payments`, {
    transactionType: 'AUTHORIZE',
    amount: kroner(amountOre),
    currency: 'DKK',
    paymentExternalKey: reference,
    transactionExternalKey: transactionKey,
  });
  return idFromLocation(reply.location);
}

export async function purchase(
  accountId: string,
  reference: string,
  amountOre: number,
  transactionKey: string,
): Promise<string> {
  const reply = await call('POST', `/1.0/kb/accounts/${accountId}/payments`, {
    transactionType: 'PURCHASE',
    amount: kroner(amountOre),
    currency: 'DKK',
    paymentExternalKey: reference,
    transactionExternalKey: transactionKey,
  });
  return idFromLocation(reply.location);
}

export async function capture(
  paymentId: string,
  amountOre: number,
  transactionKey: string,
): Promise<void> {
  await call('POST', `/1.0/kb/payments/${paymentId}`, {
    transactionType: 'CAPTURE',
    amount: kroner(amountOre),
    currency: 'DKK',
    transactionExternalKey: transactionKey,
  });
}

export async function refund(
  paymentId: string,
  amountOre: number,
  transactionKey: string,
): Promise<void> {
  await call('POST', `/1.0/kb/payments/${paymentId}/refunds`, {
    amount: kroner(amountOre),
    currency: 'DKK',
    transactionExternalKey: transactionKey,
  });
}

export async function voidPayment(paymentId: string): Promise<void> {
  await call('DELETE', `/1.0/kb/payments/${paymentId}`, {});
}

interface RawItem {
  invoiceItemId: string;
  itemType: string;
  description: string;
  amount: number;
  linkedInvoiceItemId: string | null;
}

/** Charges with their adjustments folded in, so items equal split totals. */
export async function invoiceItems(invoiceId: string): Promise<{ description: string; amountOre: number }[]> {
  const reply = await call('GET', `/1.0/kb/invoices/${invoiceId}`);
  if (reply.status === 404) return [];
  const items = (reply.body as { items: RawItem[] }).items;
  const charges = items.filter((item) => item.itemType === 'EXTERNAL_CHARGE');
  return charges.map((charge) => {
    const adjustments = items
      .filter((item) => item.linkedInvoiceItemId === charge.invoiceItemId)
      .reduce((sum, item) => sum + ore(item.amount), 0);
    return { description: charge.description, amountOre: ore(charge.amount) + adjustments };
  });
}

export async function adjustItem(
  invoiceId: string,
  accountId: string,
  description: ItemDescription,
  amountOre: number,
): Promise<void> {
  const reply = await call('GET', `/1.0/kb/invoices/${invoiceId}`);
  const items = (reply.body as { items: RawItem[] }).items;
  const charge = items.find(
    (item) => item.itemType === 'EXTERNAL_CHARGE' && item.description === description,
  );
  if (charge === undefined) throw new LedgerUnreachable(`ledger has no ${description} item`);
  await call('POST', `/1.0/kb/invoices/${invoiceId}`, {
    accountId,
    invoiceId,
    invoiceItemId: charge.invoiceItemId,
    amount: kroner(amountOre),
    currency: 'DKK',
    description: `${description} refund`,
  });
}

export async function paymentIdFor(reference: string): Promise<string | null> {
  const reply = await call('GET', `/1.0/kb/payments?externalKey=${encodeURIComponent(reference)}`);
  if (reply.status === 404 || reply.body === null) return null;
  return String((reply.body as { paymentId: string }).paymentId);
}

export interface LedgerTransaction {
  type: string;
  amountOre: number;
}

export async function transactionsFor(reference: string): Promise<LedgerTransaction[]> {
  const reply = await call('GET', `/1.0/kb/payments?externalKey=${encodeURIComponent(reference)}`);
  if (reply.status === 404 || reply.body === null) return [];
  const payment = reply.body as { transactions: { transactionType: string; amount: number }[] };
  return payment.transactions.map((transaction) => ({
    type: transaction.transactionType,
    amountOre: ore(transaction.amount),
  }));
}

export async function ledgerUp(): Promise<boolean> {
  try {
    await call('GET', '/1.0/kb/tenants/userKeyValue/press-probe');
    return true;
  } catch {
    return false;
  }
}
