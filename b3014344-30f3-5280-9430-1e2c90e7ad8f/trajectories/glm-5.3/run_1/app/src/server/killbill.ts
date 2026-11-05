import type { Amount } from './money.js';
import { amountFromString, amountToString } from './money.js';
import { config } from './util.js';

export interface KbInvoiceItem {
  invoiceItemId: string;
  invoiceId: string;
  linkedInvoiceItemId: string | null;
  bundleId: string | null;
  subscriptionId: string | null;
  productName: string | null;
  planName: string | null;
  phaseName: string | null;
  itemType: string;
  description: string;
  startDate: string;
  endDate: string | null;
  amount: number;
  rate: number | null;
  currency: string;
}

export interface KbInvoice {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  targetDate: string;
  amount: number;
  balance: number;
  creditAdj: number;
  status: string;
  currency: string;
  accountId: string;
  items: KbInvoiceItem[];
}

export interface KbSubscription {
  subscriptionId: string;
  bundleId: string;
  bundleExternalKey: string | null;
  accountId: string;
  productName: string;
  planName: string;
  phaseType: string;
  state: string;
  startDate: string;
  cancelledDate: string | null;
  chargedThroughDate: string | null;
  billingEndDate: string | null;
  prices: { planName: string; phaseName: string; phaseType: string; recurringPrice: number | null }[];
}

export interface KbPayment {
  paymentId: string;
  paymentExternalKey: string;
  accountId: string;
  transactions: {
    transactionId: string;
    transactionExternalKey: string;
    transactionType: string;
    amount: number;
    currency: string;
    status: string;
    effectiveDate: string;
  }[];
}

export interface KbBundleEvent {
  eventId: string;
  effectiveDate: string;
  eventType: string;
  isBlockedBilling: boolean;
  isBlockedEntitlement: boolean;
}

export class KillBillError extends Error {
  constructor(message: string) {
    super(message);
  }
}

async function kbFetch(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'X-Killbill-ApiKey': config.killbill.apiKey,
    'X-Killbill-ApiSecret': config.killbill.apiSecret,
    'X-Killbill-CreatedBy': 'pampero-ledger',
  };
  if (init.body !== undefined && init.body !== null) {
    headers['Content-Type'] = 'application/json';
  }
  const auth = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64');
  headers['Authorization'] = `Basic ${auth}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 15_000);
  try {
    return await fetch(`${config.killbill.url}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function kbJson<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const res = await kbFetch(path, init);
  const text = await res.text();
  if (!res.ok) {
    throw new KillBillError(`Kill Bill ${path} answered ${res.status}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text || 'null') as T;
}

async function kbVoid(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<void> {
  const res = await kbFetch(path, init);
  if (!res.ok) {
    const text = await res.text();
    throw new KillBillError(`Kill Bill ${path} answered ${res.status}: ${text.slice(0, 200)}`);
  }
}


/** Upload the per-tenant billing catalog as XML. */
export async function kbUploadXml(xml: string): Promise<void> {
  const auth = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64');
  const res = await fetch(`${config.killbill.url}/1.0/kb/catalog/xml`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml',
      'X-Killbill-ApiKey': config.killbill.apiKey,
      'X-Killbill-ApiSecret': config.killbill.apiSecret,
      'X-Killbill-CreatedBy': 'pampero-ledger',
      Authorization: `Basic ${auth}`,
    },
    body: xml,
  });
  if (res.status !== 201 && res.status !== 200) {
    const text = await res.text();
    const already = /already exists|Invalid catalog/i.test(text);
    if (!already) {
      throw new KillBillError(`Catalog upload failed: ${res.status} ${text.slice(0, 200)}`);
    }
  }
}

export async function killbillHealthy(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1_500);
    try {
      const res = await fetch(`${config.killbill.url}/1.0/healthcheck`, {
        headers: { Authorization: `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64')}` },
        signal: controller.signal,
      });
      if (res.status >= 400) {
        await res.arrayBuffer().catch(() => undefined);
      }
      return res.status === 200 || res.status === 500;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

export async function createKbAccount(input: {
  name: string;
  email: string;
  currency: string;
  externalKey: string;
}): Promise<string> {
  const res = await kbFetch('/1.0/kb/accounts', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      email: input.email,
      currency: input.currency,
      externalKey: input.externalKey,
      timeZone: 'America/Argentina/Buenos_Aires',
    }),
  });
  const location = res.headers.get('Location');
  if (res.status === 201 && location) {
    return location.split('/').filter(Boolean).pop() as string;
  }
  if (res.status === 409) {
    return await accountByKey(input.externalKey);
  }
  throw new KillBillError(`Create account failed: ${res.status} ${await res.text()}`);
}

export async function accountByKey(externalKey: string): Promise<string> {
  const account = await kbJson<{ accountId: string }>(`/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  return account.accountId;
}

export async function addAutoPayOff(accountId: string): Promise<void> {
  await kbVoid(`/1.0/kb/accounts/${accountId}/tags`, {
    method: 'POST',
    body: JSON.stringify(['00000000-0000-0000-0000-000000000001']),
  });
}

export async function addExternalPaymentMethod(accountId: string): Promise<void> {
  await kbVoid(`/1.0/kb/accounts/${accountId}/paymentMethods`, {
    method: 'POST',
    body: JSON.stringify({ pluginName: '__EXTERNAL_PAYMENT__', isDefault: true }),
  });
}

export async function getKbAccountPaymentMethod(accountId: string): Promise<string> {
  const methods = await kbJson<{ paymentMethodId: string }[]>(`/1.0/kb/accounts/${accountId}/paymentMethods?withPluginInfo=false`);
  if (methods.length === 0) {
    await addExternalPaymentMethod(accountId);
    const again = await kbJson<{ paymentMethodId: string }[]>(`/1.0/kb/accounts/${accountId}/paymentMethods?withPluginInfo=false`);
    return again[0]!.paymentMethodId;
  }
  return methods[0]!.paymentMethodId;
}

export async function createChargeInvoice(accountId: string, description: string, amount: Amount): Promise<KbInvoice> {
  const items = await kbJson<KbInvoiceItem[]>(`/1.0/kb/invoices/charges/${accountId}?autoCommit=true&autoPayment=false`, {
    method: 'POST',
    body: JSON.stringify([{ description, amount: Number(amountToString(amount)), currency: amount.currency }]),
  });
  const invoiceId = items[0]!.invoiceId;
  return await getInvoice(invoiceId);
}

export async function getInvoice(invoiceId: string): Promise<KbInvoice> {
  const invoice = await kbJson<KbInvoice>(`/1.0/kb/invoices/${invoiceId}`);
  invoice.items = invoice.items ?? [];
  return invoice;
}

export async function voidInvoice(invoiceId: string): Promise<void> {
  await kbVoid(`/1.0/kb/invoices/${invoiceId}/voidInvoice`, { method: 'PUT' });
}

export async function listAccountInvoices(accountId: string): Promise<KbInvoice[]> {
  const list = await kbJson<KbInvoice[]>(`/1.0/kb/accounts/${accountId}/invoices?withItems=true&audit=NONE`);
  const invoices: KbInvoice[] = [];
  for (const inv of list ?? []) {
    if (inv.status === 'DRAFT') continue;
    const full = await getInvoice(inv.invoiceId);
    invoices.push(full);
  }
  return invoices;
}

export async function authorizePayment(accountId: string, paymentMethodId: string, amount: Amount, paymentExternalKey: string, transactionExternalKey: string): Promise<KbPayment> {
  await kbVoid(`/1.0/kb/accounts/${accountId}/payments?paymentMethodId=${paymentMethodId}`, {
    method: 'POST',
    body: JSON.stringify({
      amount: Number(amountToString(amount)),
      currency: amount.currency,
      transactionType: 'AUTHORIZE',
      transactionExternalKey,
      paymentExternalKey,
    }),
  });
  return await getPaymentByKey(paymentExternalKey);
}

export async function getPaymentByKey(paymentExternalKey: string): Promise<KbPayment> {
  const payment = await kbJson<KbPayment>(`/1.0/kb/payments?withAttempts=false&audit=NONE&externalKey=${encodeURIComponent(paymentExternalKey)}`);
  return payment;
}

export async function capturePayment(paymentId: string, paymentMethodId: string, amount: Amount, transactionExternalKey: string): Promise<void> {
  await kbVoid(`/1.0/kb/payments/${paymentId}?paymentMethodId=${paymentMethodId}`, {
    method: 'POST',
    body: JSON.stringify({
      amount: Number(amountToString(amount)),
      currency: amount.currency,
      transactionType: 'CAPTURE',
      transactionExternalKey,
    }),
  });
}

export async function voidPayment(paymentId: string, paymentMethodId: string, amount: Amount, transactionExternalKey: string): Promise<void> {
  await kbVoid(`/1.0/kb/payments/${paymentId}?paymentMethodId=${paymentMethodId}`, {
    method: 'POST',
    body: JSON.stringify({
      amount: Number(amountToString(amount)),
      currency: amount.currency,
      transactionType: 'VOID',
      transactionExternalKey,
    }),
  });
}

export async function refundPayment(paymentId: string, amount: Amount, transactionExternalKey: string): Promise<string> {
  const res = await kbFetch(`/1.0/kb/payments/${paymentId}/refunds`, {
    method: 'POST',
    body: JSON.stringify({ amount: Number(amountToString(amount)), currency: amount.currency, transactionExternalKey }),
  });
  const location = res.headers.get('Location');
  if (res.status === 201) {
    if (location) {
      const transactionId = location.split('/').filter(Boolean).pop() as string;
      return transactionId;
    }
    return transactionExternalKey;
  }
  throw new KillBillError(`Refund failed: ${res.status} ${await res.text()}`);
}

export async function settleInvoice(invoiceId: string, accountId: string, paymentMethodId: string, amount: Amount, paymentExternalKey: string, transactionExternalKey: string): Promise<void> {
  await kbVoid(`/1.0/kb/invoices/${invoiceId}/payments?paymentMethodId=${paymentMethodId}&externalPayment=true`, {
    method: 'POST',
    body: JSON.stringify({
      targetInvoiceId: invoiceId,
      accountId,
      currency: amount.currency,
      paymentExternalKey,
      transactions: [
        {
          amount: Number(amountToString(amount)),
          currency: amount.currency,
          transactionType: 'PURCHASE',
          transactionExternalKey,
        },
      ],
    }),
  });
}

export async function createSubscription(input: {
  accountId: string;
  bundleExternalKey: string;
  planName: string;
  recurringPrice: Amount;
  entitlementDate?: string | undefined;
}): Promise<KbSubscription> {
  const query = input.entitlementDate
    ? `?entitlementDate=${encodeURIComponent(input.entitlementDate)}&billingDate=${encodeURIComponent(input.entitlementDate)}`
    : '';
  const phaseName = `${input.planName}-evergreen`;
  const res = await kbFetch(`/1.0/kb/subscriptions${query}`, {
    method: 'POST',
    body: JSON.stringify({
      accountId: input.accountId,
      bundleExternalKey: input.bundleExternalKey,
      planName: input.planName,
      priceOverrides: [
        {
          planName: input.planName,
          phaseName,
          phaseType: 'EVERGREEN',
          recurringPrice: Number(amountToString(input.recurringPrice)),
        },
      ],
    }),
  });
  const location = res.headers.get('Location');
  if (res.status === 201 && location) {
    const subscriptionId = location.split('/').filter(Boolean).pop() as string;
    return await getSubscription(subscriptionId);
  }
  throw new KillBillError(`Create subscription failed: ${res.status} ${await res.text()}`);
}

export async function getSubscription(subscriptionId: string): Promise<KbSubscription> {
  const sub = await kbJson<KbSubscription>(`/1.0/kb/subscriptions/${subscriptionId}`);
  sub.prices = sub.prices ?? [];
  return sub;
}

export async function changeSubscription(subscriptionId: string, accountId: string, planName: string, recurringPrice: Amount): Promise<void> {
  const res = await kbFetch(`/1.0/kb/subscriptions/${subscriptionId}`, {
    method: 'PUT',
    body: JSON.stringify({
      accountId,
      planName,
      priceOverrides: [
        {
          planName,
          phaseName: `${planName}-evergreen`,
          phaseType: 'EVERGREEN',
          recurringPrice: Number(amountToString(recurringPrice)),
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new KillBillError(`Change subscription failed: ${res.status} ${await res.text()}`);
  }
}

export async function pauseBundle(bundleId: string, requestedDate: string): Promise<void> {
  await kbVoid(`/1.0/kb/bundles/${bundleId}/pause?requestedDate=${encodeURIComponent(requestedDate)}`, { method: 'PUT' });
}

export async function resumeBundle(bundleId: string, requestedDate: string): Promise<void> {
  await kbVoid(`/1.0/kb/bundles/${bundleId}/resume?requestedDate=${encodeURIComponent(requestedDate)}`, { method: 'PUT' });
}

export async function cancelSubscriptionEndOfTerm(subscriptionId: string, requestedDate: string): Promise<void> {
  await kbVoid(
    `/1.0/kb/subscriptions/${subscriptionId}?requestedDate=${encodeURIComponent(requestedDate)}&entitlementPolicy=END_OF_TERM&billingPolicy=END_OF_TERM&useRequestedDateForBilling=true`,
    { method: 'DELETE' },
  );
}

export async function cancelSubscriptionNow(subscriptionId: string): Promise<void> {
  await kbVoid(`/1.0/kb/subscriptions/${subscriptionId}`, { method: 'DELETE' });
}

export async function getBundleEvents(bundleId: string): Promise<KbBundleEvent[]> {
  const bundle = await kbJson<{ timeline: { events: KbBundleEvent[] } }>(`/1.0/kb/bundles/${bundleId}?audit=MINIMAL`);
  return bundle.timeline?.events ?? [];
}

export async function createAccountCredit(accountId: string, amount: Amount, description: string): Promise<void> {
  await kbVoid('/1.0/kb/credits?autoCommit=true', {
    method: 'POST',
    body: JSON.stringify([{ accountId, amount: Number(amountToString(amount)), currency: amount.currency, description }]),
  });
}

export async function getAccountCba(accountId: string, currency: 'USD' | 'ARS'): Promise<Amount | null> {
  const account = await kbJson<{ accountCBA: number | null }>(`/1.0/kb/accounts/${accountId}?accountWithBalanceAndCBA=true`);
  if (account.accountCBA === null || account.accountCBA === undefined) return null;
  return amountFromString(currency, account.accountCBA.toFixed(2));
}

export async function findSubscriptionByBundleKey(bundleExternalKey: string): Promise<KbSubscription | null> {
  try {
    const bundle = await kbJson<{ bundles: { subscriptions: KbSubscription[] }[] }>(
      `/1.0/kb/bundles?externalKey=${encodeURIComponent(bundleExternalKey)}`,
    );
    const subs = bundle.bundles?.[0]?.subscriptions ?? [];
    if (subs.length === 0) return null;
    return await getSubscription(subs[0]!.subscriptionId);
  } catch {
    return null;
  }
}

export async function getAccountTags(accountId: string): Promise<string[]> {
  const tags = await kbJson<{ tagDefinitionName: string }[]>(`/1.0/kb/accounts/${accountId}/tags`);
  return (tags ?? []).map((t) => t.tagDefinitionName);
}
