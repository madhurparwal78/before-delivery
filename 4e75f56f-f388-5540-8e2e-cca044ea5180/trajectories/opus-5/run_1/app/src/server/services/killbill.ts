import { config } from '../config.js';

export class BillingUnavailable extends Error {
  constructor(detail: string) {
    super(`Kill Bill is not answering: ${detail}`);
    this.name = 'BillingUnavailable';
  }
}

const TIMEOUT_MS = 20_000;
const EXTERNAL_PAYMENT_PLUGIN = '__EXTERNAL_PAYMENT__';
const INVOICE_PAYMENT_CONTROL_PLUGIN = '__INVOICE_PAYMENT_CONTROL_PLUGIN__';

export interface KbTransaction {
  readonly transactionExternalKey: string;
  readonly transactionType: string;
  readonly amountCents: number;
  readonly status: string;
}

export interface KbPayment {
  readonly paymentId: string;
  readonly paymentExternalKey: string;
  readonly transactions: readonly KbTransaction[];
}

export interface KbInvoiceItem {
  readonly invoiceItemId: string;
  readonly description: string;
  readonly amountCents: number;
  readonly itemType: string;
  readonly linkedInvoiceItemId: string | null;
}

export interface KbInvoice {
  readonly invoiceId: string;
  readonly amountCents: number;
  readonly balanceCents: number;
  readonly status: string;
  readonly items: readonly KbInvoiceItem[];
}

interface RawTransaction {
  transactionExternalKey: string;
  transactionType: string;
  amount: number;
  status: string;
}

interface RawPayment {
  paymentId: string;
  paymentExternalKey: string;
  transactions: RawTransaction[];
}

interface RawInvoiceItem {
  invoiceItemId: string;
  invoiceId: string;
  description: string | null;
  amount: number;
  itemType: string;
  linkedInvoiceItemId: string | null;
}

interface RawInvoice {
  invoiceId: string;
  amount: number;
  balance: number;
  status: string;
  items: RawInvoiceItem[];
}

interface RawAccount {
  accountId: string;
  externalKey: string;
  paymentMethodId: string | null;
}

interface RawPaymentMethod {
  paymentMethodId: string;
  pluginName: string;
  isDefault: boolean;
}

function toCents(amount: number): number {
  return Math.round(amount * 100);
}

function toDollars(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

function authHeaders(): Record<string, string> {
  const basic = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64');
  return {
    authorization: `Basic ${basic}`,
    'x-killbill-apikey': config.killbill.apiKey,
    'x-killbill-apisecret': config.killbill.apiSecret,
    'x-killbill-createdby': 'opaline-bench-days',
    'content-type': 'application/json',
    accept: 'application/json',
  };
}

interface CallResult {
  status: number;
  location: string | null;
  text: string;
}

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${config.killbill.url}${path}`, {
    method,
    headers: authHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

async function call(method: string, path: string, body?: unknown): Promise<CallResult> {
  let response: Response;
  try {
    response = await send(method, path, body);
  } catch {
    // A pooled connection can be dropped between requests, so one fresh attempt
    // keeps the first request after Kill Bill returns from failing.
    try {
      response = await send(method, path, body);
    } catch (error) {
      throw new BillingUnavailable(error instanceof Error ? error.message : 'request failed');
    }
  }
  const text = await response.text();
  if (response.status >= 500) {
    throw new BillingUnavailable(`${method} ${path} answered ${response.status}`);
  }
  return { status: response.status, location: response.headers.get('location'), text };
}

function parse<T>(result: CallResult, method: string, path: string): T {
  if (result.status >= 400) {
    throw new BillingUnavailable(`${method} ${path} answered ${result.status}: ${result.text.slice(0, 200)}`);
  }
  return JSON.parse(result.text) as T;
}

function idFromLocation(result: CallResult, method: string, path: string): string {
  if (result.status >= 400 || result.location === null) {
    throw new BillingUnavailable(`${method} ${path} answered ${result.status}: ${result.text.slice(0, 200)}`);
  }
  const parts = result.location.replace(/\/+$/, '').split('/');
  const id = parts.at(-1);
  if (id === undefined) throw new BillingUnavailable(`${method} ${path} returned no id`);
  return id;
}

export interface BuyerAccount {
  readonly kbAccountId: string;
  readonly paymentMethodId: string;
}

const AUTO_PAY_OFF_TAG = '00000000-0000-0000-0000-000000000001';

/**
 * Kill Bill pays a committed invoice by itself whenever the account has a
 * default payment method, which would charge the buyer a second time under a
 * key we do not control. The AUTO_PAY_OFF control tag leaves the external
 * payment method as the default while making this app the only payer.
 */
async function ensureManualPayments(kbAccountId: string): Promise<void> {
  const path = `/1.0/kb/accounts/${kbAccountId}/tags`;
  const tags = parse<{ tagDefinitionId: string }[]>(await call('GET', path), 'GET', path);
  if (tags.some((tag) => tag.tagDefinitionId === AUTO_PAY_OFF_TAG)) return;
  const added = await call('POST', path, [AUTO_PAY_OFF_TAG]);
  if (added.status >= 400) {
    throw new BillingUnavailable(`POST ${path} answered ${added.status}`);
  }
}

/** One Kill Bill account per buyer, with the built-in external payment method as default. */
export async function ensureBuyerAccount(
  appAccountId: string,
  name: string,
  email: string,
): Promise<BuyerAccount> {
  const externalKey = `ob-${appAccountId}`;
  const lookupPath = `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`;
  const lookup = await call('GET', lookupPath);
  let kbAccountId: string;
  if (lookup.status === 200) {
    kbAccountId = parse<RawAccount>(lookup, 'GET', lookupPath).accountId;
  } else {
    const created = await call('POST', '/1.0/kb/accounts', {
      name,
      email,
      currency: 'USD',
      externalKey,
    });
    kbAccountId = idFromLocation(created, 'POST', '/1.0/kb/accounts');
  }

  await ensureManualPayments(kbAccountId);

  const methodsPath = `/1.0/kb/accounts/${kbAccountId}/paymentMethods`;
  const methods = parse<RawPaymentMethod[]>(await call('GET', methodsPath), 'GET', methodsPath);
  const existing = methods.find((method) => method.pluginName === EXTERNAL_PAYMENT_PLUGIN);
  if (existing !== undefined) {
    return { kbAccountId, paymentMethodId: existing.paymentMethodId };
  }
  const createPath = `${methodsPath}?isDefault=true`;
  const created = await call('POST', createPath, {
    pluginName: EXTERNAL_PAYMENT_PLUGIN,
    pluginInfo: {},
  });
  if (created.status >= 400) {
    throw new BillingUnavailable(`POST ${createPath} answered ${created.status}`);
  }
  const refreshed = parse<RawPaymentMethod[]>(await call('GET', methodsPath), 'GET', methodsPath);
  const method = refreshed.find((candidate) => candidate.pluginName === EXTERNAL_PAYMENT_PLUGIN);
  if (method === undefined) {
    throw new BillingUnavailable('the external payment method was not created');
  }
  return { kbAccountId, paymentMethodId: method.paymentMethodId };
}

export interface ChargeLine {
  readonly description: string;
  readonly amountCents: number;
}

export interface CreatedInvoice {
  readonly invoiceId: string;
  readonly items: readonly { invoiceItemId: string; description: string; amountCents: number }[];
}

export async function createInvoiceWithCharges(
  kbAccountId: string,
  lines: readonly ChargeLine[],
): Promise<CreatedInvoice> {
  const path = `/1.0/kb/invoices/charges/${kbAccountId}?autoCommit=true`;
  const body = lines.map((line) => ({
    accountId: kbAccountId,
    amount: toDollars(line.amountCents),
    currency: 'USD',
    description: line.description,
  }));
  const items = parse<RawInvoiceItem[]>(await call('POST', path, body), 'POST', path);
  const invoiceId = items[0]?.invoiceId;
  if (invoiceId === undefined) throw new BillingUnavailable('the invoice was created with no items');
  await waitForCommittedInvoice(invoiceId);
  return {
    invoiceId,
    items: items.map((item) => ({
      invoiceItemId: item.invoiceItemId,
      description: item.description ?? '',
      amountCents: toCents(item.amount),
    })),
  };
}

const COMMIT_POLLS = 20;
const COMMIT_DELAY_MS = 150;

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Kill Bill commits a freshly created invoice on its own bus, and the invoice
 * payment control plugin aborts a purchase against one that is not committed
 * yet, so the invoice is read back until it carries a balance to pay.
 */
async function waitForCommittedInvoice(invoiceId: string): Promise<void> {
  for (let attempt = 0; attempt < COMMIT_POLLS; attempt += 1) {
    const invoice = await getInvoice(invoiceId);
    if (invoice.status === 'COMMITTED' && invoice.balanceCents > 0) return;
    await wait(COMMIT_DELAY_MS);
  }
  throw new BillingUnavailable(`invoice ${invoiceId} was not committed`);
}

function isControlPluginAbort(result: CallResult): boolean {
  return result.status === 422 && result.text.includes('Control plugin aborted call');
}

export async function findPaymentByExternalKey(externalKey: string): Promise<KbPayment | null> {
  const path = `/1.0/kb/payments?externalKey=${encodeURIComponent(externalKey)}`;
  const result = await call('GET', path);
  if (result.status === 404) return null;
  if (result.status >= 400) {
    const looksMissing = result.text.includes('does not exist');
    if (looksMissing) return null;
    throw new BillingUnavailable(`GET ${path} answered ${result.status}`);
  }
  const raw = JSON.parse(result.text) as RawPayment;
  return {
    paymentId: raw.paymentId,
    paymentExternalKey: raw.paymentExternalKey,
    transactions: raw.transactions.map((transaction) => ({
      transactionExternalKey: transaction.transactionExternalKey,
      transactionType: transaction.transactionType,
      amountCents: toCents(transaction.amount),
      status: transaction.status,
    })),
  };
}

export async function getPayment(paymentId: string): Promise<KbPayment> {
  const path = `/1.0/kb/payments/${paymentId}`;
  const raw = parse<RawPayment>(await call('GET', path), 'GET', path);
  return {
    paymentId: raw.paymentId,
    paymentExternalKey: raw.paymentExternalKey,
    transactions: raw.transactions.map((transaction) => ({
      transactionExternalKey: transaction.transactionExternalKey,
      transactionType: transaction.transactionType,
      amountCents: toCents(transaction.amount),
      status: transaction.status,
    })),
  };
}

export async function getInvoice(invoiceId: string): Promise<KbInvoice> {
  const path = `/1.0/kb/invoices/${invoiceId}`;
  const raw = parse<RawInvoice>(await call('GET', path), 'GET', path);
  return {
    invoiceId: raw.invoiceId,
    amountCents: toCents(raw.amount),
    balanceCents: toCents(raw.balance),
    status: raw.status,
    items: raw.items.map((item) => ({
      invoiceItemId: item.invoiceItemId,
      description: item.description ?? '',
      amountCents: toCents(item.amount),
      itemType: item.itemType,
      linkedInvoiceItemId: item.linkedInvoiceItemId,
    })),
  };
}

/**
 * A PURCHASE against an invoice, carrying the given external key as both the
 * payment and the transaction external key. A confirmed transaction under the
 * same key is reused, so a retry never charges twice.
 */
export async function purchaseInvoice(
  kbAccountId: string,
  paymentMethodId: string,
  invoiceId: string,
  amountCents: number,
  externalKey: string,
): Promise<KbPayment> {
  const existing = await findPaymentByExternalKey(externalKey);
  if (existing !== null) return existing;

  const path =
    `/1.0/kb/accounts/${kbAccountId}/payments` +
    `?paymentMethodId=${paymentMethodId}` +
    `&controlPluginName=${INVOICE_PAYMENT_CONTROL_PLUGIN}` +
    `&pluginProperty=${encodeURIComponent(`IPCD_INVOICE_ID=${invoiceId}`)}`;
  const body = {
    transactionType: 'PURCHASE',
    amount: toDollars(amountCents),
    currency: 'USD',
    paymentExternalKey: externalKey,
    transactionExternalKey: externalKey,
  };
  let created = await call('POST', path, body);
  for (let attempt = 0; attempt < COMMIT_POLLS && isControlPluginAbort(created); attempt += 1) {
    await wait(COMMIT_DELAY_MS);
    const reused = await findPaymentByExternalKey(externalKey);
    if (reused !== null) return reused;
    created = await call('POST', path, body);
  }
  if (created.status >= 400) {
    const reused = await findPaymentByExternalKey(externalKey);
    if (reused !== null) return reused;
    throw new BillingUnavailable(`POST ${path} answered ${created.status}: ${created.text.slice(0, 200)}`);
  }
  const paymentId = idFromLocation(created, 'POST', path);
  const payment = await getPayment(paymentId);
  const purchased = payment.transactions.find(
    (transaction) => transaction.transactionType === 'PURCHASE' && transaction.status === 'SUCCESS',
  );
  if (purchased === undefined) {
    throw new BillingUnavailable('the purchase was not confirmed');
  }
  return payment;
}

/** A REFUND with an invoice-item adjustment on the seat's item. */
export async function refundWithItemAdjustment(
  paymentId: string,
  amountCents: number,
  transactionExternalKey: string,
  invoiceItemId: string,
): Promise<void> {
  const existing = await getPayment(paymentId);
  const already = existing.transactions.find(
    (transaction) =>
      transaction.transactionExternalKey === transactionExternalKey && transaction.status === 'SUCCESS',
  );
  if (already !== undefined) return;

  const path = `/1.0/kb/invoicePayments/${paymentId}/refunds`;
  const created = await call('POST', path, {
    paymentId,
    amount: toDollars(amountCents),
    currency: 'USD',
    transactionExternalKey,
    isAdjusted: true,
    adjustments: [{ invoiceItemId, amount: toDollars(amountCents) }],
  });
  if (created.status >= 400) {
    throw new BillingUnavailable(`POST ${path} answered ${created.status}: ${created.text.slice(0, 200)}`);
  }
  const refreshed = await getPayment(paymentId);
  const confirmed = refreshed.transactions.find(
    (transaction) =>
      transaction.transactionExternalKey === transactionExternalKey && transaction.status === 'SUCCESS',
  );
  if (confirmed === undefined) {
    throw new BillingUnavailable('the refund was not confirmed');
  }
}

export async function ping(): Promise<void> {
  const path = '/1.0/healthcheck';
  const result = await call('GET', path);
  if (result.status >= 400) {
    throw new BillingUnavailable(`healthcheck answered ${result.status}`);
  }
}
