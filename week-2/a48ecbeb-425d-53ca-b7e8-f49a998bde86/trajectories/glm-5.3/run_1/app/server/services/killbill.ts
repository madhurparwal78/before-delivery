import { env } from '../env.js';

export class KillBillUnavailable extends Error {}

const AUTH = 'Basic ' + Buffer.from(`${env.killbill.username}:${env.killbill.password}`).toString('base64');

export async function kb<T>(
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, string | undefined>
): Promise<{ status: number; body: T | null; location?: string }> {
  let url: URL;
  try {
    url = new URL(env.killbill.url + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
  } catch {
    throw new KillBillUnavailable();
  }
  const headers: Record<string, string> = {
    Authorization: AUTH,
    'X-Killbill-ApiKey': env.killbill.apiKey,
    'X-Killbill-ApiSecret': env.killbill.apiSecret,
    'X-Killbill-CreatedBy': 'ceibo-server',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new KillBillUnavailable();
  }
  if (res.status === 503 || res.status === 502) throw new KillBillUnavailable();
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: res.status, body: parsed as T, location: res.headers.get('location') ?? undefined };
}

export async function kbOk<T>(method: string, path: string, body?: unknown, query?: Record<string, string | undefined>): Promise<T> {
  const res = await kb<T>(method, path, body, query);
  if (res.status >= 400) {
    throw new Error(`Kill Bill ${method} ${path} failed: ${res.status} ${JSON.stringify(res.body)?.slice(0, 200)}`);
  }
  return res.body as T;
}

export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

export interface KbAccount {
  accountId: string;
  externalKey: string | null;
  currency: string;
}

export interface KbSubscription {
  subscriptionId: string;
  bundleId: string;
  state: string;
  planName: string;
  billingPeriod: string;
  chargedThroughDate: string | null;
  cancelledDate: string | null;
  billingEndDate: string | null;
}

export interface KbInvoiceItem {
  invoiceItemId: string;
  invoiceId?: string;
  description: string | null;
  amount: number;
  itemType: string | null;
  startDate: string | null;
  endDate: string | null;
}

export interface KbInvoice {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  targetDate: string;
  amount: number;
  balance: number;
  status: string;
  items: KbInvoiceItem[];
}

export interface KbPayment {
  paymentId: string;
  paymentExternalKey: string | null;
  purchasedAmount: number;
  refundedAmount: number;
  transactions: { transactionId: string; transactionExternalKey: string; status: string }[];
}

export interface KbBlockingState {
  blockedId: string;
  stateName: string;
  service: string;
  isBlockChange: boolean;
  isBlockEntitlement: boolean;
  isBlockBilling: boolean;
  effectiveDate: string;
  type: string;
}

export async function getClock(): Promise<Date> {
  const c = await kbOk<{ currentUtcTime: string }>('GET', '/1.0/kb/test/clock');
  return new Date(c.currentUtcTime);
}

export async function findAccount(externalKey: string): Promise<KbAccount | null> {
  const res = await kb<KbAccount>('GET', '/1.0/kb/accounts', undefined, { externalKey });
  if (res.status === 404) return null;
  if (res.status >= 400) throw new Error(`account lookup failed ${res.status}`);
  return res.body;
}

export async function ensureAccount(name: string, externalKey: string): Promise<KbAccount> {
  const existing = await findAccount(externalKey);
  if (existing) return existing;
  const created = await kb('POST', '/1.0/kb/accounts', { name, externalKey, currency: 'CAD' });
  if (created.status !== 201) {
    const again = await findAccount(externalKey);
    if (again) return again;
    throw new Error(`account create failed ${created.status}`);
  }
  const account = await findAccount(externalKey);
  if (!account) throw new Error('account missing after create');
  await kbOk('POST', `/1.0/kb/accounts/${account.accountId}/tags`, [
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000008',
  ]);
  return account;
}

export async function ensurePaymentMethod(accountId: string): Promise<string> {
  const list = await kbOk<{ paymentMethodId: string }[]>(
    'GET',
    `/1.0/kb/accounts/${accountId}/paymentMethods`
  );
  if (list.length > 0) return list[0].paymentMethodId;
  const res = await kb('POST', `/1.0/kb/accounts/${accountId}/paymentMethods`, {
    pluginName: '__EXTERNAL_PAYMENT__',
    pluginInfo: { isDefaultPaymentMethod: true, properties: [] },
  });
  if (res.status !== 201 && res.status !== 200) throw new Error('payment method create failed');
  const after = await kbOk<{ paymentMethodId: string }[]>(
    'GET',
    `/1.0/kb/accounts/${accountId}/paymentMethods`
  );
  if (after.length === 0) throw new Error('payment method missing after create');
  return after[0].paymentMethodId;
}

export interface SubscriptionRecord {
  subscriptionId: string;
  planName: string;
  billingPeriod: string;
  chargedThroughDate: string;
}

export async function getSubscription(subscriptionId: string): Promise<KbSubscription> {
  return kbOk<KbSubscription>('GET', `/1.0/kb/subscriptions/${subscriptionId}`, undefined, { audit: 'NONE' });
}

export async function getBlockingStates(accountId: string): Promise<KbBlockingState[]> {
  return kbOk<KbBlockingState[]>('GET', `/1.0/kb/accounts/${accountId}/block`);
}

export async function getInvoices(accountId: string): Promise<KbInvoice[]> {
  return kbOk<KbInvoice[]>('GET', `/1.0/kb/accounts/${accountId}/invoices`);
}

export async function getInvoice(invoiceId: string): Promise<KbInvoice> {
  return kbOk<KbInvoice>('GET', `/1.0/kb/invoices/${invoiceId}`);
}

export async function commitInvoice(invoiceId: string): Promise<void> {
  const res = await kb('PUT', `/1.0/kb/invoices/${invoiceId}/commitInvoice`);
  if (res.status >= 400 && res.status !== 409) throw new Error(`commit invoice failed ${res.status}`);
}

export async function addCharges(
  accountId: string,
  items: { amount: number; description: string }[],
  invoiceId?: string
): Promise<KbInvoiceItem[]> {
  const body = items.map((i) => ({
    accountId,
    ...(invoiceId ? { invoiceId } : {}),
    amount: centsToDollars(i.amount),
    currency: 'CAD',
    description: i.description,
  }));
  const res = await kb<KbInvoiceItem[]>('POST', `/1.0/kb/invoices/charges/${accountId}`, body);
  if (res.status >= 400) throw new Error(`add charges failed ${res.status}`);
  return res.body ?? [];
}

export async function triggerInvoice(accountId: string, targetDate: string): Promise<void> {
  const res = await kb(
    'POST',
    '/1.0/kb/invoices',
    undefined,
    { accountId, targetDate }
  );
  if (res.status >= 400 && res.status !== 404) throw new Error(`trigger invoice failed ${res.status}`);
}

export async function findPaymentByExternalKey(paymentExternalKey: string): Promise<KbPayment | null> {
  const res = await kb<KbPayment>('GET', '/1.0/kb/payments', undefined, { externalKey: paymentExternalKey });
  if (res.status === 404) return null;
  if (res.status >= 400) throw new Error(`payment lookup failed ${res.status}`);
  return res.body;
}

export async function accountPurchase(
  accountId: string,
  paymentMethodId: string,
  cents: number,
  paymentExternalKey: string,
  transactionExternalKey: string
): Promise<KbPayment> {
  const res = await kb<KbPayment>(
    'POST',
    `/1.0/kb/accounts/${accountId}/payments`,
    {
      transactionType: 'PURCHASE',
      amount: centsToDollars(cents),
      currency: 'CAD',
      paymentExternalKey,
      transactionExternalKey,
    },
    { paymentMethodId }
  );
  if (res.status >= 400) throw new Error(`account purchase failed ${res.status} ${JSON.stringify(res.body)?.slice(0, 300)}`);
  const found = await findPaymentByExternalKey(paymentExternalKey);
  if (!found) throw new Error('payment missing after purchase');
  return found;
}

export async function invoicePurchase(
  accountId: string,
  paymentMethodId: string,
  invoiceId: string,
  cents: number,
  paymentExternalKey: string
): Promise<void> {
  const res = await kb(
    'POST',
    `/1.0/kb/invoices/${invoiceId}/payments`,
    {
      targetInvoiceId: invoiceId,
      accountId,
      purchasedAmount: centsToDollars(cents),
      currency: 'CAD',
      paymentExternalKey,
    },
    { paymentMethodId, externalPayment: 'true' }
  );
  if (res.status >= 400) throw new Error(`invoice purchase failed ${res.status} ${JSON.stringify(res.body)?.slice(0, 300)}`);
}

export async function refundPayment(
  paymentId: string,
  cents: number,
  transactionExternalKey: string
): Promise<void> {
  const res = await kb(
    'POST',
    `/1.0/kb/payments/${paymentId}/refunds`,
    {
      amount: centsToDollars(cents),
      currency: 'CAD',
      transactionExternalKey,
    }
  );
  if (res.status >= 400) throw new Error(`refund failed ${res.status} ${JSON.stringify(res.body)?.slice(0, 300)}`);
}

export async function addSubscriptionBlockingState(
  subscriptionId: string,
  stateName: string,
  requestedDate: string,
  blocking: boolean
): Promise<void> {
  const res = await kb(
    'POST',
    `/1.0/kb/subscriptions/${subscriptionId}/block`,
    {
      stateName,
      service: 'ceibo',
      isBlockChange: false,
      isBlockBilling: blocking,
      isBlockEntitlement: blocking,
    },
    { requestedDate }
  );
  if (res.status >= 400) throw new Error(`blocking state failed ${res.status}`);
}

export async function addAccountBlockingState(
  accountId: string,
  stateName: string,
  service: string,
  blocking: boolean
): Promise<void> {
  const res = await kb(
    'POST',
    `/1.0/kb/accounts/${accountId}/block`,
    {
      stateName,
      service,
      isBlockChange: false,
      isBlockBilling: blocking,
      isBlockEntitlement: blocking,
    },
    { requestedDate: undefined }
  );
  if (res.status >= 400) throw new Error(`account blocking state failed ${res.status}`);
}

export async function createSubscription(accountId: string, planName: string): Promise<SubscriptionRecord> {
  const res = await kb('POST', '/1.0/kb/subscriptions', { accountId, planName });
  if (res.status >= 400) throw new Error(`subscription create failed ${res.status}`);
  const bundles = await kbOk<
    { subscriptions: { subscriptionId: string; planName: string; billingPeriod: string; chargedThroughDate: string }[] }[]
  >('GET', `/1.0/kb/accounts/${accountId}/bundles`);
  const sub = bundles.flatMap((b) => b.subscriptions).find((s) => s.planName === planName);
  if (!sub) throw new Error('subscription missing after create');
  return { subscriptionId: sub.subscriptionId, planName: sub.planName, billingPeriod: sub.billingPeriod, chargedThroughDate: sub.chargedThroughDate };
}

export async function changePlan(subscriptionId: string, planName: string): Promise<void> {
  const res = await kb('PUT', `/1.0/kb/subscriptions/${subscriptionId}`, { planName }, { billingPolicy: 'END_OF_TERM' });
  if (res.status >= 400) throw new Error(`change plan failed ${res.status}`);
}

export async function cancelAtEndOfTerm(subscriptionId: string): Promise<void> {
  const res = await kb('DELETE', `/1.0/kb/subscriptions/${subscriptionId}`, undefined, {
    entitlementPolicy: 'END_OF_TERM',
    billingPolicy: 'END_OF_TERM',
  });
  if (res.status >= 400) throw new Error(`cancel failed ${res.status}`);
}

export async function cancelImmediately(subscriptionId: string): Promise<void> {
  const res = await kb('DELETE', `/1.0/kb/subscriptions/${subscriptionId}`, undefined, {
    entitlementPolicy: 'IMMEDIATE',
    billingPolicy: 'IMMEDIATE',
  });
  if (res.status >= 400) throw new Error(`immediate cancel failed ${res.status}`);
}

export async function catalogPlanNames(): Promise<string[]> {
  try {
    const versions = await kbOk<{ products: { plans: { name: string }[] }[] }[]>(
      'GET',
      '/1.0/kb/catalog'
    );
    const names: string[] = [];
    for (const version of versions) {
      for (const product of version.products ?? []) {
        for (const plan of product.plans ?? []) names.push(plan.name);
      }
    }
    return names;
  } catch (e) {
    if (e instanceof KillBillUnavailable) throw e;
    return [];
  }
}

export async function uploadSimplePlans(
  plans: { planId: string; productName: string; billingPeriod: string; amount: number }[]
): Promise<void> {
  for (const plan of plans) {
    const res = await kb('POST', '/1.0/kb/catalog/simplePlan', {
      planId: plan.planId,
      productName: plan.productName,
      productCategory: 'BASE',
      currency: 'CAD',
      amount: plan.amount,
      billingPeriod: plan.billingPeriod,
    });
    if (res.status >= 400) throw new Error(`simplePlan ${plan.planId} failed ${res.status}`);
  }
}
