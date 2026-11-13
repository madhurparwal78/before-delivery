import { env } from '../env.js';
import { CATALOG_NAME, maintenanceCatalogXml } from './killbill-catalog.js';

/** Kill Bill records every charge. Paid state is only ever read from its answers. */

export class BillingUnavailable extends Error {}
export class BillingRejected extends Error {}

const AUTO_PAY_OFF_TAG = '00000000-0000-0000-0000-000000000001';
const EXTERNAL_PAYMENT_PLUGIN = '__EXTERNAL_PAYMENT__';
const INVOICE_PAYMENT_CONTROL = '__INVOICE_PAYMENT_CONTROL_PLUGIN__';
const CREATED_BY = 'spindrift-rooms';

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const basic = Buffer.from(`${env.killbillUsername}:${env.killbillPassword}`).toString('base64');
  return {
    authorization: `Basic ${basic}`,
    'x-killbill-apikey': env.killbillApiKey,
    'x-killbill-apisecret': env.killbillApiSecret,
    'x-killbill-createdby': CREATED_BY,
    accept: 'application/json',
    ...extra,
  };
}

interface CallOptions {
  method?: string;
  body?: string;
  contentType?: string;
  timeoutMs?: number;
}

interface RawResponse {
  status: number;
  location: string | null;
  text: string;
}

async function call(path: string, options: CallOptions = {}): Promise<RawResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  try {
    const res = await fetch(`${env.killbillUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: authHeaders(
        options.body === undefined
          ? {}
          : { 'content-type': options.contentType ?? 'application/json' },
      ),
      body: options.body,
      signal: controller.signal,
    });
    return {
      status: res.status,
      location: res.headers.get('location'),
      text: await res.text(),
    };
  } catch (error) {
    throw new BillingUnavailable(String(error));
  } finally {
    clearTimeout(timer);
  }
}

function parseJson<T>(res: RawResponse): T {
  if (res.text === '') return undefined as T;
  return JSON.parse(res.text) as T;
}

function expectOk<T>(res: RawResponse, what: string): T {
  if (res.status >= 500) throw new BillingUnavailable(`${what} ${res.status}`);
  if (res.status >= 400) throw new BillingRejected(`${what} ${res.status} ${res.text.slice(0, 300)}`);
  return parseJson<T>(res);
}

function idFromLocation(res: RawResponse, what: string): string {
  if (res.status >= 500) throw new BillingUnavailable(`${what} ${res.status}`);
  if (res.status >= 400) throw new BillingRejected(`${what} ${res.status} ${res.text.slice(0, 300)}`);
  const location = res.location;
  if (!location) throw new BillingRejected(`${what}: no location`);
  return location.replace(/\/$/, '').split('/').pop() ?? '';
}

/** Kill Bill speaks decimal dollars; the app speaks integer cents. */
function toDollars(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export async function billingIsUp(): Promise<boolean> {
  try {
    const res = await call('/1.0/kb/nodesInfo', { timeoutMs: 3_000 });
    return res.status === 200;
  } catch {
    return false;
  }
}

/** Upload the maintenance catalog when the tenant has none. */
export async function ensureCatalog(): Promise<void> {
  const existing = await call('/1.0/kb/catalog');
  if (existing.status === 200) {
    const versions = parseJson<{ name?: string }[]>(existing) ?? [];
    if (versions.some((v) => v.name === CATALOG_NAME)) return;
  }
  const upload = await call('/1.0/kb/catalog/xml', {
    method: 'POST',
    body: maintenanceCatalogXml(),
    contentType: 'text/xml',
  });
  expectOk(upload, 'catalog upload');
}

interface AccountJson {
  accountId: string;
  externalKey: string;
  name: string;
  email: string;
}

/**
 * One USD account per payer, keyed by the app user id, with the external
 * payment method as its default. Automatic payment is switched off so every
 * charge is made by an explicit request carrying its idempotency key.
 */
export async function ensurePayerAccount(
  appUserId: string,
  name: string,
  email: string,
): Promise<string> {
  const found = await call(`/1.0/kb/accounts?externalKey=${encodeURIComponent(appUserId)}`);
  if (found.status === 200 && found.text !== '') {
    const account = parseJson<AccountJson>(found);
    if (account?.accountId) return account.accountId;
  }
  const created = await call('/1.0/kb/accounts', {
    method: 'POST',
    body: JSON.stringify({ name, externalKey: appUserId, currency: 'USD', email }),
  });
  let accountId: string;
  if (created.status === 409) {
    const again = await call(`/1.0/kb/accounts?externalKey=${encodeURIComponent(appUserId)}`);
    accountId = parseJson<AccountJson>(again).accountId;
  } else {
    accountId = idFromLocation(created, 'create account');
  }
  await configureAccount(accountId);
  return accountId;
}

async function configureAccount(accountId: string): Promise<void> {
  const tags = await call(`/1.0/kb/accounts/${accountId}/tags`);
  const current = tags.status === 200 ? parseJson<{ tagDefinitionId: string }[]>(tags) ?? [] : [];
  if (!current.some((t) => t.tagDefinitionId === AUTO_PAY_OFF_TAG)) {
    await call(`/1.0/kb/accounts/${accountId}/tags`, {
      method: 'POST',
      body: JSON.stringify([AUTO_PAY_OFF_TAG]),
    });
  }
  const methods = await call(`/1.0/kb/accounts/${accountId}/paymentMethods`);
  const existing = methods.status === 200 ? parseJson<{ pluginName: string }[]>(methods) ?? [] : [];
  if (!existing.some((m) => m.pluginName === EXTERNAL_PAYMENT_PLUGIN)) {
    const added = await call(`/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`, {
      method: 'POST',
      body: JSON.stringify({ pluginName: EXTERNAL_PAYMENT_PLUGIN, pluginInfo: {} }),
    });
    expectOk(added, 'add payment method');
  }
}

export interface InvoiceItem {
  description: string;
  amountCents: number;
  startDate: string | null;
  endDate: string | null;
}

export interface Invoice {
  killbillInvoiceId: string;
  invoiceNumber: string;
  amountCents: number;
  balanceCents: number;
  invoiceDate: string;
  items: InvoiceItem[];
}

interface InvoiceJson {
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
  balance: number;
  invoiceDate: string;
  items?: {
    description: string;
    amount: number;
    startDate: string | null;
    endDate: string | null;
  }[];
}

function toInvoice(json: InvoiceJson): Invoice {
  return {
    killbillInvoiceId: json.invoiceId,
    invoiceNumber: String(json.invoiceNumber),
    amountCents: toCents(json.amount),
    balanceCents: toCents(json.balance),
    invoiceDate: json.invoiceDate,
    items: (json.items ?? []).map((i) => ({
      description: i.description,
      amountCents: toCents(i.amount),
      startDate: i.startDate,
      endDate: i.endDate,
    })),
  };
}

/** One invoice per issued milestone or sponsor share, with its two charge items. */
export async function createChargeInvoice(
  accountId: string,
  charges: readonly { description: string; amountCents: number }[],
): Promise<Invoice> {
  const res = await call(`/1.0/kb/invoices/charges/${accountId}?autoCommit=true`, {
    method: 'POST',
    body: JSON.stringify(
      charges.map((c) => ({
        amount: toDollars(c.amountCents),
        currency: 'USD',
        description: c.description,
      })),
    ),
  });
  const items = expectOk<{ invoiceId: string }[]>(res, 'create charges');
  const invoiceId = items[0]?.invoiceId;
  if (!invoiceId) throw new BillingRejected('create charges: no invoice');
  return getInvoice(invoiceId);
}

export async function getInvoice(invoiceId: string): Promise<Invoice> {
  const res = await call(`/1.0/kb/invoices/${invoiceId}`);
  return toInvoice(expectOk<InvoiceJson>(res, 'get invoice'));
}

export interface PaymentResult {
  killbillPaymentId: string;
  succeeded: boolean;
  amountCents: number;
}

interface PaymentJson {
  paymentId: string;
  purchasedAmount: number;
  transactions: { transactionExternalKey: string; status: string; transactionType: string }[];
}

function toPaymentResult(json: PaymentJson, key: string): PaymentResult {
  const transaction =
    json.transactions.find((t) => t.transactionExternalKey === key) ?? json.transactions[0];
  return {
    killbillPaymentId: json.paymentId,
    succeeded: transaction?.status === 'SUCCESS',
    amountCents: toCents(json.purchasedAmount),
  };
}

/**
 * One PURCHASE payment for the invoice's balance, with the request's
 * idempotency key as the transaction external key.
 */
export async function payInvoice(
  accountId: string,
  invoiceId: string,
  amountCents: number,
  idempotencyKey: string,
): Promise<PaymentResult> {
  const query = new URLSearchParams({
    controlPluginName: INVOICE_PAYMENT_CONTROL,
    pluginProperty: `IPCD_INVOICE_ID=${invoiceId}`,
  });
  const res = await call(`/1.0/kb/accounts/${accountId}/payments?${query.toString()}`, {
    method: 'POST',
    body: JSON.stringify({
      transactionType: 'PURCHASE',
      amount: toDollars(amountCents),
      currency: 'USD',
      transactionExternalKey: idempotencyKey,
      paymentExternalKey: idempotencyKey,
    }),
  });
  if (res.status >= 500) throw new BillingUnavailable(`pay invoice ${res.status}`);
  if (res.status >= 400) {
    // The charge may already exist from an earlier attempt that lost its answer.
    const found = await findPaymentByKey(idempotencyKey);
    if (found) return found;
    throw new BillingRejected(`pay invoice ${res.status} ${res.text.slice(0, 300)}`);
  }
  const paymentId = idFromLocation(res, 'pay invoice');
  const payment = await call(`/1.0/kb/payments/${paymentId}`);
  return toPaymentResult(expectOk<PaymentJson>(payment, 'read payment'), idempotencyKey);
}

/** Ask Kill Bill whether a payment with this key exists, so a charge is never made twice. */
export async function findPaymentByKey(idempotencyKey: string): Promise<PaymentResult | null> {
  const res = await call(`/1.0/kb/payments?externalKey=${encodeURIComponent(idempotencyKey)}`);
  if (res.status === 404) return null;
  if (res.status >= 500) throw new BillingUnavailable(`find payment ${res.status}`);
  if (res.status >= 400 || res.text === '') return null;
  const json = parseJson<PaymentJson>(res);
  if (!json?.paymentId) return null;
  return toPaymentResult(json, idempotencyKey);
}

export interface Subscription {
  killbillSubscriptionId: string;
  planName: string;
  startDate: string;
  chargedThroughDate: string | null;
}

interface SubscriptionJson {
  subscriptionId: string;
  planName: string;
  startDate: string;
  chargedThroughDate: string | null;
}

export async function createSubscription(
  accountId: string,
  planName: string,
  externalKey: string,
): Promise<Subscription> {
  const res = await call('/1.0/kb/subscriptions?callCompletion=true&callTimeoutSec=15', {
    method: 'POST',
    body: JSON.stringify({ accountId, planName, externalKey }),
    timeoutMs: 30_000,
  });
  const subscriptionId = idFromLocation(res, 'create subscription');
  return getSubscription(subscriptionId);
}

export async function getSubscription(subscriptionId: string): Promise<Subscription> {
  const res = await call(`/1.0/kb/subscriptions/${subscriptionId}`);
  const json = expectOk<SubscriptionJson>(res, 'get subscription');
  return {
    killbillSubscriptionId: json.subscriptionId,
    planName: json.planName,
    startDate: json.startDate,
    chargedThroughDate: json.chargedThroughDate,
  };
}

/**
 * Change the plan with immediate effect, so Kill Bill credits the unused part
 * of the old plan and charges the new plan from the change date. Kill Bill
 * refuses a request that carries both a requested date and a billing policy.
 */
export async function changeSubscriptionPlan(
  subscriptionId: string,
  planName: string,
): Promise<void> {
  const query = new URLSearchParams({
    callCompletion: 'true',
    callTimeoutSec: '15',
    billingPolicy: 'IMMEDIATE',
  });
  const res = await call(`/1.0/kb/subscriptions/${subscriptionId}?${query.toString()}`, {
    method: 'PUT',
    body: JSON.stringify({ planName }),
    timeoutMs: 30_000,
  });
  if (res.status >= 500) throw new BillingUnavailable(`change plan ${res.status}`);
  if (res.status >= 400) throw new BillingRejected(`change plan ${res.status} ${res.text.slice(0, 300)}`);
}

export async function listAccountInvoices(accountId: string): Promise<Invoice[]> {
  const res = await call(
    `/1.0/kb/accounts/${accountId}/invoices?includeInvoiceComponents=true`,
  );
  const json = expectOk<InvoiceJson[]>(res, 'list invoices') ?? [];
  return json.map(toInvoice);
}

/**
 * Kill Bill raises the invoice for a subscription change on its own bus, a
 * moment after the change is accepted. Wait for it so the screen can show Kill
 * Bill's own items rather than an empty table.
 */
export async function waitForInvoiceAfter(
  accountId: string,
  knownInvoiceIds: readonly string[],
  timeoutMs = 20_000,
): Promise<Invoice | null> {
  const known = new Set(knownInvoiceIds);
  const deadline = Date.now() + timeoutMs;
  let latest: Invoice | null = null;
  while (Date.now() < deadline) {
    const invoices = await listAccountInvoices(accountId);
    const fresh = invoices.filter((i) => !known.has(i.killbillInvoiceId));
    if (fresh.length > 0) {
      latest = fresh[fresh.length - 1] ?? null;
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return latest;
}
