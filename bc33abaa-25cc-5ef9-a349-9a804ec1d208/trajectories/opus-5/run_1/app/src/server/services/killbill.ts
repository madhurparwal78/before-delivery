import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config';
import { fail } from '../http/errors';

const AUTO_PAY_OFF_TAG = '00000000-0000-0000-0000-000000000001';
const EXTERNAL_PAYMENT_PLUGIN = '__EXTERNAL_PAYMENT__';

export interface KbInvoiceItem {
  itemType: string;
  amount: number;
  planName: string | null;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  quantity: number | null;
}

export interface KbInvoice {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  amount: number;
  balance: number;
  items: KbInvoiceItem[];
}

export interface KbTransaction {
  transactionType: string;
  amount: number;
  status: string;
  transactionExternalKey: string | null;
}

export interface KbPayment {
  paymentId: string;
  purchasedAmount: number;
  refundedAmount: number;
  paymentExternalKey: string | null;
  transactions: KbTransaction[];
}

export interface KbSubscription {
  subscriptionId: string;
  bundleId: string;
  planName: string;
  productCategory: string;
  state: string;
  quantity: number | null;
  cancelledDate: string | null;
  chargedThroughDate: string | null;
  events: { eventType: string; effectiveDate: string; plan: string | null }[];
}

export type BillingPolicy = 'IMMEDIATE' | 'END_OF_TERM';

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64')}`,
    'X-Killbill-ApiKey': config.killbill.apiKey,
    'X-Killbill-ApiSecret': config.killbill.apiSecret,
    'X-Killbill-CreatedBy': 'orrery-studio',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

interface KbResponse {
  status: number;
  location: string | null;
  body: unknown;
}

function logProviderFailure(method: string, path: string, status: number, body: unknown): void {
  process.stderr.write(
    `kill bill ${method} ${path} answered ${status}: ${JSON.stringify(body).slice(0, 200)}\n`,
  );
}

async function request(
  method: string,
  path: string,
  body?: unknown,
  contentType?: string,
): Promise<KbResponse> {
  const headers = authHeaders();
  if (contentType) headers['Content-Type'] = contentType;
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}/1.0/kb${path}`, {
      method,
      headers,
      body:
        body === undefined
          ? undefined
          : typeof body === 'string'
            ? body
            : JSON.stringify(body),
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    throw fail.serviceDown('billing');
  }
  const text = await response.text();
  if (response.status >= 500) throw fail.serviceDown('billing');
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = text;
    }
  }
  if (response.status >= 400) logProviderFailure(method, path, response.status, parsed);
  return { status: response.status, location: response.headers.get('location'), body: parsed };
}

function expect(response: KbResponse, allowed: number[]): KbResponse {
  if (!allowed.includes(response.status)) throw fail.serviceDown('billing');
  return response;
}

function idFromLocation(response: KbResponse, segment: string): string {
  const location = response.location;
  if (!location) throw fail.serviceDown('billing');
  const parts = location.split(`/${segment}/`);
  const tail = parts[1];
  if (!tail) throw fail.serviceDown('billing');
  return tail.replace(/\/$/, '');
}

export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function toAmount(cents: number): number {
  return Math.round(cents) / 100;
}

let catalogUploaded = false;

const CATALOG_NAME = 'OrreryStudio';
const CATALOG_PLANS = [
  'team-monthly',
  'team-annual',
  'business-monthly',
  'business-annual',
  'seat-team-monthly',
  'seat-team-annual',
  'seat-business-monthly',
  'seat-business-annual',
];

/** The tenant refuses a repeat upload of the same version, so it is uploaded only when missing. */
export async function ensureCatalog(): Promise<void> {
  if (catalogUploaded) return;
  const current = expect(await request('GET', '/catalog'), [200]);
  const versions = (current.body ?? []) as {
    name?: string;
    products?: { plans?: { name?: string }[] }[];
  }[];
  const present = versions.some((version) => {
    if (version.name !== CATALOG_NAME) return false;
    const plans = new Set(
      (version.products ?? []).flatMap((product) => (product.plans ?? []).map((plan) => plan.name)),
    );
    return CATALOG_PLANS.every((plan) => plans.has(plan));
  });
  if (present) {
    catalogUploaded = true;
    return;
  }
  const xml = readFileSync(join(__dirname, '..', 'billing', 'catalog.xml'), 'utf8');
  expect(await request('POST', '/catalog/xml', xml, 'text/xml'), [201, 200, 204]);
  catalogUploaded = true;
}

export async function findAccountId(workspaceId: string): Promise<string | null> {
  const response = await request('GET', `/accounts?externalKey=${encodeURIComponent(workspaceId)}`);
  if (response.status === 404) return null;
  expect(response, [200]);
  const account = response.body as { accountId?: string } | null;
  return account?.accountId ?? null;
}

export async function createAccount(workspaceId: string, name: string): Promise<string> {
  await ensureCatalog();
  const existing = await findAccountId(workspaceId);
  if (existing) return existing;
  const created = expect(
    await request('POST', '/accounts', { name, externalKey: workspaceId, currency: 'USD' }),
    [201],
  );
  const accountId = idFromLocation(created, 'accounts');
  expect(await request('POST', `/accounts/${accountId}/tags`, [AUTO_PAY_OFF_TAG]), [201]);
  expect(
    await request('POST', `/accounts/${accountId}/paymentMethods?isDefault=true`, {
      pluginName: EXTERNAL_PAYMENT_PLUGIN,
      pluginInfo: {},
    }),
    [201],
  );
  return accountId;
}

export async function createSubscription(
  accountId: string,
  planName: string,
): Promise<KbSubscription> {
  const created = expect(
    await request('POST', '/subscriptions', {
      accountId,
      planName,
    }),
    [201],
  );
  return getSubscription(idFromLocation(created, 'subscriptions'));
}

export async function createSeatAddon(
  accountId: string,
  bundleId: string,
  seatPlan: string,
  quantity: number,
): Promise<KbSubscription> {
  const created = expect(
    await request('POST', '/subscriptions', {
      accountId,
      bundleId,
      planName: seatPlan,
      quantity,
    }),
    [201],
  );
  return getSubscription(idFromLocation(created, 'subscriptions'));
}

export async function getSubscription(subscriptionId: string): Promise<KbSubscription> {
  const response = expect(await request('GET', `/subscriptions/${subscriptionId}`), [200]);
  const body = response.body as {
    subscriptionId: string;
    bundleId: string;
    planName: string;
    productCategory: string;
    state: string;
    quantity: number | null;
    cancelledDate: string | null;
    chargedThroughDate: string | null;
    events?: { eventType: string; effectiveDate: string; plan: string | null }[];
  };
  return {
    subscriptionId: body.subscriptionId,
    bundleId: body.bundleId,
    planName: body.planName,
    productCategory: body.productCategory,
    state: body.state,
    quantity: body.quantity,
    cancelledDate: body.cancelledDate,
    chargedThroughDate: body.chargedThroughDate,
    events: body.events ?? [],
  };
}

export async function accountBundleSubscriptions(accountId: string): Promise<KbSubscription[]> {
  const response = expect(await request('GET', `/accounts/${accountId}/bundles`), [200]);
  const bundles = (response.body ?? []) as { subscriptions?: unknown[] }[];
  const out: KbSubscription[] = [];
  for (const bundle of bundles) {
    for (const entry of bundle.subscriptions ?? []) {
      const sub = entry as {
        subscriptionId: string;
        bundleId: string;
        planName: string;
        productCategory: string;
        state: string;
        quantity: number | null;
        cancelledDate: string | null;
        chargedThroughDate: string | null;
      };
      out.push({
        subscriptionId: sub.subscriptionId,
        bundleId: sub.bundleId,
        planName: sub.planName,
        productCategory: sub.productCategory,
        state: sub.state,
        quantity: sub.quantity,
        cancelledDate: sub.cancelledDate,
        chargedThroughDate: sub.chargedThroughDate,
        events: [],
      });
    }
  }
  return out;
}

export async function listBundleSubscriptions(bundleId: string): Promise<KbSubscription[]> {
  const response = expect(await request('GET', `/bundles/${bundleId}`), [200]);
  const body = response.body as { subscriptions?: unknown[] };
  const subscriptions = (body.subscriptions ?? []) as {
    subscriptionId: string;
    bundleId: string;
    planName: string;
    productCategory: string;
    state: string;
    quantity: number | null;
    cancelledDate: string | null;
    chargedThroughDate: string | null;
    events?: { eventType: string; effectiveDate: string; plan: string | null }[];
  }[];
  return subscriptions.map((entry) => ({
    subscriptionId: entry.subscriptionId,
    bundleId: entry.bundleId,
    planName: entry.planName,
    productCategory: entry.productCategory,
    state: entry.state,
    quantity: entry.quantity,
    cancelledDate: entry.cancelledDate,
    chargedThroughDate: entry.chargedThroughDate,
    events: entry.events ?? [],
  }));
}

export async function changePlan(
  subscriptionId: string,
  product: string,
  billingPeriod: 'MONTHLY' | 'ANNUAL',
  planName: string,
  policy: BillingPolicy,
): Promise<void> {
  expect(
    await request(
      'PUT',
      `/subscriptions/${subscriptionId}?billingPolicy=${policy}`,
      { productName: product, billingPeriod, priceList: 'DEFAULT', planName },
    ),
    [200, 204],
  );
}

export async function setAddonQuantity(
  subscriptionId: string,
  quantity: number,
  effectiveFromDate: string | null,
): Promise<void> {
  const query = effectiveFromDate ? `?effectiveFromDate=${effectiveFromDate}&` : '?';
  expect(
    await request(
      'PUT',
      `/subscriptions/${subscriptionId}/quantity${query}`,
      { quantity },
    ),
    [200, 204],
  );
}

export async function cancelSubscription(
  subscriptionId: string,
  policy: BillingPolicy,
): Promise<void> {
  const entitlementPolicy = policy === 'IMMEDIATE' ? 'IMMEDIATE' : 'END_OF_TERM';
  expect(
    await request(
      'DELETE',
      `/subscriptions/${subscriptionId}?billingPolicy=${policy}&entitlementPolicy=${entitlementPolicy}`,
    ),
    [200, 204],
  );
}

function parseInvoice(body: unknown): KbInvoice {
  const invoice = body as {
    invoiceId: string;
    invoiceNumber: string;
    invoiceDate: string;
    amount: number;
    balance: number;
    items?: {
      itemType: string;
      amount: number;
      planName: string | null;
      description: string | null;
      startDate: string | null;
      endDate: string | null;
      quantity: number | null;
    }[];
  };
  return {
    invoiceId: invoice.invoiceId,
    invoiceNumber: String(invoice.invoiceNumber),
    invoiceDate: invoice.invoiceDate,
    amount: invoice.amount,
    balance: invoice.balance,
    items: (invoice.items ?? []).map((item) => ({
      itemType: item.itemType,
      amount: item.amount,
      planName: item.planName,
      description: item.description,
      startDate: item.startDate,
      endDate: item.endDate,
      quantity: item.quantity,
    })),
  };
}

export async function getInvoice(invoiceId: string): Promise<KbInvoice> {
  const response = expect(await request('GET', `/invoices/${invoiceId}?withItems=true`), [200]);
  return parseInvoice(response.body);
}

/** The account invoice list omits amounts, so each invoice is read in full. */
export async function listInvoices(accountId: string): Promise<KbInvoice[]> {
  const response = expect(await request('GET', `/accounts/${accountId}/invoices`), [200]);
  const list = (response.body ?? []) as { invoiceId: string }[];
  const invoices: KbInvoice[] = [];
  for (const entry of list) {
    invoices.push(await getInvoice(entry.invoiceId));
  }
  return invoices;
}

function parsePayment(body: unknown): KbPayment {
  const payment = body as {
    paymentId: string;
    purchasedAmount: number;
    refundedAmount: number;
    paymentExternalKey: string | null;
    transactions?: {
      transactionType: string;
      amount: number;
      status: string;
      transactionExternalKey: string | null;
    }[];
  };
  return {
    paymentId: payment.paymentId,
    purchasedAmount: payment.purchasedAmount,
    refundedAmount: payment.refundedAmount,
    paymentExternalKey: payment.paymentExternalKey,
    transactions: (payment.transactions ?? []).map((transaction) => ({
      transactionType: transaction.transactionType,
      amount: transaction.amount,
      status: transaction.status,
      transactionExternalKey: transaction.transactionExternalKey,
    })),
  };
}

export async function getPayment(paymentId: string): Promise<KbPayment> {
  const response = expect(await request('GET', `/payments/${paymentId}`), [200]);
  return parsePayment(response.body);
}

export async function listPayments(accountId: string): Promise<KbPayment[]> {
  const response = expect(await request('GET', `/accounts/${accountId}/payments`), [200]);
  const list = (response.body ?? []) as unknown[];
  return list.map(parsePayment);
}

export async function payInvoice(options: {
  accountId: string;
  invoiceId: string;
  amountCents: number;
  transactionExternalKey: string;
}): Promise<KbPayment> {
  const amount = toAmount(options.amountCents);
  const created = expect(
    await request('POST', `/invoices/${options.invoiceId}/payments?externalPayment=true`, {
      accountId: options.accountId,
      targetInvoiceId: options.invoiceId,
      purchasedAmount: amount,
      currency: 'USD',
      paymentExternalKey: options.transactionExternalKey,
      transactions: [
        {
          transactionExternalKey: options.transactionExternalKey,
          transactionType: 'PURCHASE',
          amount,
          currency: 'USD',
        },
      ],
    }),
    [201],
  );
  return getPayment(idFromLocation(created, 'invoicePayments'));
}

export async function refundPayment(options: {
  paymentId: string;
  amountCents: number;
  transactionExternalKey: string;
}): Promise<KbPayment> {
  expect(
    await request('POST', `/payments/${options.paymentId}/refunds`, {
      paymentId: options.paymentId,
      amount: toAmount(options.amountCents),
      currency: 'USD',
      transactionExternalKey: options.transactionExternalKey,
    }),
    [200, 201],
  );
  return getPayment(options.paymentId);
}

/** A failed settlement is a chargeback on the invoice payment, which reopens the balance. */
export async function chargebackPayment(options: {
  paymentId: string;
  amountCents: number;
  transactionExternalKey: string;
}): Promise<KbPayment> {
  expect(
    await request('POST', `/invoicePayments/${options.paymentId}/chargebacks`, {
      paymentId: options.paymentId,
      amount: toAmount(options.amountCents),
      currency: 'USD',
      transactionExternalKey: options.transactionExternalKey,
    }),
    [200, 201],
  );
  return getPayment(options.paymentId);
}

export async function dryRunPlanChange(options: {
  accountId: string;
  bundleId: string;
  subscriptionId: string;
  product: string;
  billingPeriod: 'MONTHLY' | 'ANNUAL';
  policy: BillingPolicy;
}): Promise<KbInvoice | null> {
  const response = await request('POST', `/invoices/dryRun?accountId=${options.accountId}`, {
    dryRunType: 'SUBSCRIPTION_ACTION',
    dryRunAction: 'CHANGE',
    subscriptionId: options.subscriptionId,
    bundleId: options.bundleId,
    productName: options.product,
    productCategory: 'BASE',
    billingPeriod: options.billingPeriod,
    priceListName: 'DEFAULT',
    billingPolicy: options.policy,
  });
  if (response.status === 204) return null;
  expect(response, [200]);
  return parseInvoice(response.body);
}

export async function dryRunAddonChange(options: {
  accountId: string;
  bundleId: string;
  subscriptionId: string;
  seatPlan: string;
}): Promise<KbInvoice | null> {
  const response = await request('POST', `/invoices/dryRun?accountId=${options.accountId}`, {
    dryRunType: 'SUBSCRIPTION_ACTION',
    dryRunAction: 'CHANGE',
    subscriptionId: options.subscriptionId,
    bundleId: options.bundleId,
    planName: options.seatPlan,
    priceListName: 'DEFAULT',
    billingPolicy: 'IMMEDIATE',
  });
  if (response.status === 204) return null;
  expect(response, [200]);
  return parseInvoice(response.body);
}

export async function changeAddonPlan(
  subscriptionId: string,
  seatPlan: string,
  policy: BillingPolicy,
): Promise<void> {
  expect(
    await request(
      'PUT',
      `/subscriptions/${subscriptionId}?billingPolicy=${policy}`,
      { planName: seatPlan },
    ),
    [200, 204],
  );
}

const AUTO_INVOICING_OFF_TAG = '00000000-0000-0000-0000-000000000002';

/** Holding invoicing off lets one action group several changes into one invoice. */
export async function setAutoInvoicingOff(accountId: string, off: boolean): Promise<void> {
  if (off) {
    expect(await request('POST', `/accounts/${accountId}/tags`, [AUTO_INVOICING_OFF_TAG]), [201]);
    return;
  }
  expect(
    await request('DELETE', `/accounts/${accountId}/tags?tagDef=${AUTO_INVOICING_OFF_TAG}`),
    [200, 204],
  );
}

/**
 * Generates the invoice for everything billed since the last run. Kill Bill
 * processes entitlement changes asynchronously, so an expected invoice is
 * waited for briefly.
 */
export async function triggerInvoice(
  accountId: string,
  options: { expectInvoice: boolean } = { expectInvoice: false },
): Promise<KbInvoice | null> {
  const attempts = options.expectInvoice ? 10 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const targetDate = new Date().toISOString().slice(0, 10);
    const response = await request(
      'POST',
      `/invoices?accountId=${accountId}&targetDate=${targetDate}`,
    );
    // 204 and 404 both mean there is nothing left to invoice.
    if (response.status !== 204 && response.status !== 404) {
      expect(response, [200, 201]);
      return getInvoice(idFromLocation(response, 'invoices'));
    }
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return null;
}

export async function reachable(): Promise<boolean> {
  try {
    const response = await request('GET', '/catalog');
    return response.status === 200;
  } catch {
    return false;
  }
}
