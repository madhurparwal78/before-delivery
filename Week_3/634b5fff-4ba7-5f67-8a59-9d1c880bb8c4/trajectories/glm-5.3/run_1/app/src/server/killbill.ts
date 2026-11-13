import { config } from './config.js';

export class LedgerDown extends Error {}

function headers(): Record<string, string> {
  return {
    'content-type': 'application/json',
    'X-Killbill-ApiKey': config.killbill.apiKey,
    'X-Killbill-ApiSecret': config.killbill.apiSecret,
    'X-Killbill-CreatedBy': 'svovlstik-press',
    'authorization': 'Basic ' + Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64'),
  };
}

async function call<T>(path: string, method: string, body?: unknown): Promise<{ status: number; body: T }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${config.killbill.url}${path}`, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    if (res.status >= 500) throw new LedgerDown(`killbill ${res.status}: ${text.slice(0, 160)}`);
    return { status: res.status, body: parsed as T };
  } catch (err) {
    if (err instanceof LedgerDown) throw err;
    throw new LedgerDown(String(err));
  } finally {
    clearTimeout(timer);
  }
}

/** One account per lowercased buyer email. */
export async function ensureAccount(email: string, name: string): Promise<string> {
  const lower = email.toLowerCase();
  const existing = await call<{ accountId: string }>(`/1.0/kb/accounts?externalKey=${encodeURIComponent(lower)}`, 'GET');
  if (existing.status === 200) return existing.body.accountId;
  const created = await call<unknown>(`/1.0/kb/accounts`, 'POST', {
    name,
    externalKey: lower,
    currency: 'DKK',
    email: lower,
  });
  if (created.status !== 201 && created.status !== 200) throw new LedgerDown(`account create ${created.status}`);
  const fetched = await call<{ accountId: string }>(`/1.0/kb/accounts?externalKey=${encodeURIComponent(lower)}`, 'GET');
  if (fetched.status !== 200) throw new LedgerDown('account not created');
  return fetched.body.accountId;
}

export async function ensurePaymentMethod(accountId: string): Promise<string> {
  const acc = await call<{ paymentMethodId: string | null }>(`/1.0/kb/accounts/${accountId}`, 'GET');
  if (acc.status === 200 && acc.body.paymentMethodId) return acc.body.paymentMethodId;
  const made = await call<unknown>(`/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`, 'POST', { pluginName: '__EXTERNAL_PAYMENT__' });
  void made;
  const again = await call<{ paymentMethodId: string | null }>(`/1.0/kb/accounts/${accountId}`, 'GET');
  if (again.status !== 200 || !again.body.paymentMethodId) throw new LedgerDown('payment method not created');
  return again.body.paymentMethodId;
}

export async function createCommittedInvoice(accountId: string, items: { description: string; amount: number }[]): Promise<string> {
  const res = await call<{ invoiceItemId: string; invoiceId: string }[]>(
    `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`,
    'POST',
    items.map((it) => ({ accountId, description: it.description, amount: it.amount, currency: 'DKK' })),
  );
  if (res.status !== 200 || !res.body?.length) throw new LedgerDown('invoice not created');
  return res.body[0].invoiceId;
}

export async function authoriseTransaction(accountId: string, amount: number, paymentExternalKey: string, transactionExternalKey: string): Promise<string> {
  // Authorise against the linked invoice so the payment records against it.
  const res = await call<{ paymentId: string }>(`/1.0/kb/accounts/${accountId}/payments`, 'POST', {
    transactionType: 'AUTHORIZE',
    transactionExternalKey,
    paymentExternalKey,
    amount,
    currency: 'DKK',
  });
  if (res.status !== 201 && res.status !== 200) throw new LedgerDown(`authorise failed ${res.status}`);
  const paymentId = res.body?.paymentId;
  if (paymentId) return paymentId;
  // Fall back to a lookup by external key.
  const found = await call<{ paymentId: string }>(`/1.0/kb/payments?externalKey=${encodeURIComponent(paymentExternalKey)}`, 'GET');
  if (found.status !== 200) throw new LedgerDown('payment not found');
  return found.body.paymentId;
}

export async function purchaseTransaction(accountId: string, amount: number, paymentExternalKey: string, transactionExternalKey: string): Promise<string> {
  const res = await call<{ paymentId: string }>(`/1.0/kb/accounts/${accountId}/payments`, 'POST', {
    transactionType: 'PURCHASE',
    transactionExternalKey,
    paymentExternalKey,
    amount,
    currency: 'DKK',
  });
  if (res.status !== 201 && res.status !== 200) throw new LedgerDown(`purchase failed ${res.status}`);
  return res.body?.paymentId ?? '';
}

export async function captureTransaction(paymentId: string, amount: number, transactionExternalKey: string): Promise<boolean> {
  const res = await call<unknown>(`/1.0/kb/payments/${paymentId}`, 'POST', {
    transactionType: 'CAPTURE',
    transactionExternalKey,
    amount,
    currency: 'DKK',
  });
  return res.status === 201 || res.status === 200;
}

export async function refundTransaction(paymentId: string, amount: number, transactionExternalKey: string): Promise<boolean> {
  const res = await call<unknown>(`/1.0/kb/invoicePayments/${paymentId}/refunds`, 'POST', {
    transactionExternalKey,
    amount,
    currency: 'DKK',
  });
  return res.status === 201 || res.status === 200;
}

export async function voidTransaction(paymentId: string, transactionExternalKey: string): Promise<boolean> {
  const res = await call<unknown>(`/1.0/kb/payments/${paymentId}`, 'DELETE', {
    transactionExternalKey,
  });
  return res.status === 204 || res.status === 201 || res.status === 200;
}

export async function getInvoice(invoiceId: string): Promise<{
  invoiceId: string;
  status: string;
  balance: number;
  items: { invoiceItemId: string; description: string | null; amount: number; linkedInvoiceItemId: string | null; itemType: string }[];
} | null> {
  const res = await call<{ invoiceId: string; status: string; balance: number; items: { invoiceItemId: string; description: string | null; amount: number; linkedInvoiceItemId: string | null; itemType: string }[] }>(`/1.0/kb/invoices/${invoiceId}`, 'GET');
  return res.status === 200 ? res.body : null;
}

export async function getPayment(paymentId: string): Promise<{
  authAmount: number;
  capturedAmount: number;
  refundedAmount: number;
  transactions: { transactionType: string; status: string; amount: number | null }[];
} | null> {
  const res = await call<{ authAmount: number; capturedAmount: number; refundedAmount: number; transactions: { transactionType: string; status: string; amount: number | null }[] }>(`/1.0/kb/payments/${paymentId}`, 'GET');
  return res.status === 200 ? res.body : null;
}

/** Each settled refund adjusts the maker, charity and VAT items by that
 * refund's parts, so adjusted items equal split totals. Uses item
 * adjustments against the committed invoice. */
export async function adjustInvoiceItems(invoiceId: string, itemIds: { maker: string; charity: string; vat: string }, parts: { makerOre: number; charityOre: number; vatOre: number }): Promise<boolean> {
  const adjustments: { invoiceItemId: string; amount: number; currency: string }[] = [];
  if (parts.charityOre > 0) adjustments.push({ invoiceItemId: itemIds.charity, amount: parts.charityOre / 100, currency: 'DKK' });
  if (parts.vatOre > 0) adjustments.push({ invoiceItemId: itemIds.vat, amount: parts.vatOre / 100, currency: 'DKK' });
  if (parts.makerOre > 0) adjustments.push({ invoiceItemId: itemIds.maker, amount: parts.makerOre / 100, currency: 'DKK' });
  for (const adj of adjustments) {
    const res = await call<unknown>(`/1.0/kb/invoices/${invoiceId}`, 'POST', adj);
    if (res.status !== 201) return false;
  }
  return true;
}

export interface InvoiceItemIds { maker: string; charity: string; vat: string; courier: string }

/** Find the ids of the four items on a committed invoice by description. */
export async function invoiceItemIds(invoiceId: string): Promise<InvoiceItemIds | null> {
  const inv = await getInvoice(invoiceId);
  if (!inv) return null;
  const find = (desc: string) => inv.items.find((i) => i.description === desc && i.itemType === 'EXTERNAL_CHARGE' && i.linkedInvoiceItemId === null);
  const maker = find('maker share');
  const charity = find('charity share');
  const vat = find('VAT');
  const courier = find('courier');
  if (!maker || !charity || !vat || !courier) return null;
  return { maker: maker.invoiceItemId, charity: charity.invoiceItemId, vat: vat.invoiceItemId, courier: courier.invoiceItemId };
}
