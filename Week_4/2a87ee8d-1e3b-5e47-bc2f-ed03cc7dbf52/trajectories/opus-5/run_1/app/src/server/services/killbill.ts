import { config } from '../config.js';
import { killbillAmountToDecimal, decimalToKillbillAmount } from '../domain/money.js';
import { isPlanCode, isBillingTerm, type BillingTerm, type PlanCode } from '../domain/plans.js';
import { catalogXml } from './catalog.js';

/** Raised when Kill Bill is unreachable or rejects a change, so callers answer `billing_unavailable`. */
export class BillingUnavailable extends Error {
  constructor(cause: string) {
    super(`Billing is unavailable: ${cause}`);
    this.name = 'BillingUnavailable';
  }
}

const REQUEST_TIMEOUT_MS = 20_000;
const EXTERNAL_PAYMENT_PLUGIN = '__EXTERNAL_PAYMENT__';

function headers(contentType: string): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64')}`,
    'X-Killbill-ApiKey': config.killbill.apiKey,
    'X-Killbill-ApiSecret': config.killbill.apiSecret,
    'X-Killbill-CreatedBy': 'lanternfold-rooms',
    'Content-Type': contentType,
    Accept: 'application/json',
  };
}

interface KillbillResponse {
  readonly status: number;
  readonly location: string | null;
  readonly text: string;
}

async function call(
  method: string,
  path: string,
  options: { body?: unknown; xml?: string } = {},
): Promise<KillbillResponse> {
  const isXml = options.xml !== undefined;
  const init: RequestInit = {
    method,
    headers: headers(isXml ? 'text/xml' : 'application/json'),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
  if (isXml) init.body = options.xml;
  else if (options.body !== undefined) init.body = JSON.stringify(options.body);

  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}${path}`, init);
  } catch (error) {
    throw new BillingUnavailable((error as Error).message);
  }
  const text = await response.text();
  if (response.status >= 500) throw new BillingUnavailable(`${method} ${path} answered ${response.status}`);
  return { status: response.status, location: response.headers.get('location'), text };
}

function parseJson<T>(response: KillbillResponse, method: string, path: string): T {
  if (response.status < 200 || response.status >= 300) {
    throw new BillingUnavailable(`${method} ${path} answered ${response.status}: ${response.text.slice(0, 200)}`);
  }
  if (response.text === '') throw new BillingUnavailable(`${method} ${path} returned an empty body`);
  return JSON.parse(response.text) as T;
}

function idFromLocation(response: KillbillResponse): string {
  const id = response.location?.split('/').pop();
  if (id === undefined || id === '') throw new BillingUnavailable('Kill Bill returned no resource location');
  return id;
}

async function catalogExists(): Promise<boolean> {
  const response = await call('GET', '/1.0/kb/catalog');
  if (response.status !== 200 || response.text === '') return false;
  const versions = JSON.parse(response.text) as unknown[];
  return versions.length > 0;
}

/**
 * Makes sure the tenant's catalog exists, uploading exactly one version across instances.
 * Kill Bill rejects a second upload of a version whose effective date it already holds, so
 * the upload is guarded by an existence check on both sides of the race.
 */
export async function ensureCatalog(): Promise<void> {
  if (await catalogExists()) return;
  const response = await call('POST', '/1.0/kb/catalog/xml', { xml: catalogXml() });
  if (response.status === 201 || response.status === 200) return;
  if (await catalogExists()) return;
  throw new BillingUnavailable(`catalog upload answered ${response.status}: ${response.text.slice(0, 200)}`);
}

interface AccountJson {
  accountId: string;
  externalKey: string;
  accountBalance?: number | null;
}

export interface AccountDescriptor {
  readonly name: string;
  readonly externalKey: string;
  readonly email: string;
  readonly timeZone?: string;
}

async function findAccount(externalKey: string): Promise<string | null> {
  const response = await call('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  if (response.status === 404) return null;
  if (response.status !== 200 || response.text === '') return null;
  return (JSON.parse(response.text) as AccountJson).accountId;
}

/** Each account is created at most once, identified by its external key across instances. */
export async function ensureAccount(descriptor: AccountDescriptor): Promise<string> {
  const existing = await findAccount(descriptor.externalKey);
  if (existing !== null) return existing;
  const body: Record<string, unknown> = {
    name: descriptor.name,
    externalKey: descriptor.externalKey,
    currency: 'EUR',
    email: descriptor.email,
  };
  if (descriptor.timeZone !== undefined) body.timeZone = descriptor.timeZone;
  const created = await call('POST', '/1.0/kb/accounts', { body });
  if (created.status === 201) return idFromLocation(created);
  // A concurrent create wins the external-key conflict; read it back.
  const raced = await findAccount(descriptor.externalKey);
  if (raced !== null) return raced;
  throw new BillingUnavailable(`account create answered ${created.status}: ${created.text.slice(0, 200)}`);
}

export async function ensureDefaultPaymentMethod(accountId: string): Promise<void> {
  const existing = await call('GET', `/1.0/kb/accounts/${accountId}/paymentMethods`);
  if (existing.status === 200 && existing.text !== '') {
    const methods = JSON.parse(existing.text) as unknown[];
    if (methods.length > 0) return;
  }
  const created = await call('POST', `/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`, {
    body: { pluginName: EXTERNAL_PAYMENT_PLUGIN, pluginInfo: {} },
  });
  if (created.status !== 201) {
    throw new BillingUnavailable(`payment method answered ${created.status}: ${created.text.slice(0, 200)}`);
  }
}

interface SubscriptionEventJson {
  eventType: string;
  effectiveDate: string;
  plan: string | null;
}

interface SubscriptionJson {
  subscriptionId: string;
  planName: string;
  state: string;
  chargedThroughDate: string | null;
  events: readonly SubscriptionEventJson[] | null;
}

export interface SubscriptionState {
  readonly subscriptionId: string;
  readonly plan: PlanCode;
  readonly term: BillingTerm;
  /** The charged-through date as Kill Bill reports it, `YYYY-MM-DD`. */
  readonly chargedThroughDate: string | null;
  readonly cancelled: boolean;
  readonly pendingChange: { readonly plan: PlanCode; readonly term: BillingTerm; readonly effectiveDate: string } | null;
}

function splitPlanName(planName: string): { plan: PlanCode; term: BillingTerm } | null {
  const separator = planName.lastIndexOf('-');
  if (separator <= 0) return null;
  const plan = planName.slice(0, separator);
  const term = planName.slice(separator + 1);
  if (!isPlanCode(plan) || !isBillingTerm(term)) return null;
  return { plan, term };
}

function readSubscription(json: SubscriptionJson, nowMs: number): SubscriptionState {
  const current = splitPlanName(json.planName);
  if (!current) throw new BillingUnavailable(`unknown plan name ${json.planName}`);
  // A scheduled change shows as a CHANGE event with a future effective date.
  const futureChange = (json.events ?? [])
    .filter((event) => event.eventType === 'CHANGE' && Date.parse(event.effectiveDate) > nowMs)
    .sort((a, b) => Date.parse(a.effectiveDate) - Date.parse(b.effectiveDate))[0];
  let pendingChange: SubscriptionState['pendingChange'] = null;
  if (futureChange?.plan) {
    const target = splitPlanName(futureChange.plan);
    if (target) {
      pendingChange = {
        plan: target.plan,
        term: target.term,
        effectiveDate: futureChange.effectiveDate.slice(0, 10),
      };
    }
  }
  return {
    subscriptionId: json.subscriptionId,
    plan: current.plan,
    term: current.term,
    chargedThroughDate: json.chargedThroughDate,
    cancelled: json.state === 'CANCELLED',
    pendingChange,
  };
}

export async function getSubscription(subscriptionId: string, nowMs: number): Promise<SubscriptionState | null> {
  const response = await call('GET', `/1.0/kb/subscriptions/${subscriptionId}`);
  if (response.status === 404) return null;
  return readSubscription(parseJson<SubscriptionJson>(response, 'GET', 'subscription'), nowMs);
}

/** Finds the account's one base subscription, so a restart never creates a second. */
export async function findBaseSubscription(accountId: string, nowMs: number): Promise<SubscriptionState | null> {
  const response = await call('GET', `/1.0/kb/accounts/${accountId}/bundles`);
  if (response.status !== 200 || response.text === '') return null;
  const bundles = JSON.parse(response.text) as ReadonlyArray<{ subscriptions?: readonly SubscriptionJson[] }>;
  for (const bundle of bundles) {
    for (const subscription of bundle.subscriptions ?? []) {
      if (subscription.state !== 'CANCELLED') return readSubscription(subscription, nowMs);
    }
  }
  return null;
}

export async function createSubscription(accountId: string, planName: string): Promise<string> {
  // `productCategory` must be absent when `planName` is set.
  const created = await call(
    'POST',
    '/1.0/kb/subscriptions?callCompletion=true&callTimeoutSec=15',
    { body: { accountId, planName } },
  );
  if (created.status !== 201) {
    throw new BillingUnavailable(`subscription create answered ${created.status}: ${created.text.slice(0, 200)}`);
  }
  return idFromLocation(created);
}

/** The catalog's change policy decides whether this applies at once or at the term end. */
export async function changeSubscriptionPlan(subscriptionId: string, planName: string): Promise<void> {
  const response = await call(
    'PUT',
    `/1.0/kb/subscriptions/${subscriptionId}?callCompletion=true&callTimeoutSec=15`,
    { body: { planName } },
  );
  if (response.status !== 204 && response.status !== 200) {
    throw new BillingUnavailable(`plan change answered ${response.status}: ${response.text.slice(0, 200)}`);
  }
}

/** Removes a change Kill Bill has scheduled but not yet applied. */
export async function undoPendingChange(subscriptionId: string): Promise<void> {
  const response = await call('PUT', `/1.0/kb/subscriptions/${subscriptionId}/undoChangePlan`, { body: {} });
  if (response.status !== 204 && response.status !== 200) {
    throw new BillingUnavailable(`undo change answered ${response.status}: ${response.text.slice(0, 200)}`);
  }
}

export interface InvoiceItem {
  readonly description: string;
  readonly amount: string;
}

export interface Invoice {
  readonly id: string;
  readonly number: string;
  /** `YYYY-MM-DD` as Kill Bill reports it. */
  readonly date: string;
  readonly amount: string;
  readonly balance: string;
  readonly currency: string;
  readonly items: readonly InvoiceItem[];
}

interface InvoiceJson {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  amount: number;
  balance: number;
  currency: string;
  items?: ReadonlyArray<{ description?: string | null; amount: number }> | null;
}

function readInvoice(json: InvoiceJson): Invoice {
  return {
    id: json.invoiceId,
    number: json.invoiceNumber,
    date: json.invoiceDate,
    amount: killbillAmountToDecimal(json.amount),
    balance: killbillAmountToDecimal(json.balance),
    currency: json.currency,
    items: (json.items ?? []).map((item) => ({
      description: item.description ?? '',
      amount: killbillAmountToDecimal(item.amount),
    })),
  };
}

export async function getInvoice(invoiceId: string): Promise<Invoice | null> {
  const response = await call('GET', `/1.0/kb/invoices/${invoiceId}?withItems=true`);
  if (response.status === 404) return null;
  return readInvoice(parseJson<InvoiceJson>(response, 'GET', 'invoice'));
}

/**
 * Kill Bill's account invoice list reports a zero amount and no items, so each invoice is
 * fetched individually for its real amount, balance and items.
 */
export async function listInvoices(accountId: string): Promise<Invoice[]> {
  const response = await call('GET', `/1.0/kb/accounts/${accountId}/invoices`);
  if (response.status === 404) return [];
  const summaries = parseJson<readonly InvoiceJson[]>(response, 'GET', 'invoices');
  const invoices: Invoice[] = [];
  for (const summary of summaries) {
    const invoice = await getInvoice(summary.invoiceId);
    if (invoice) invoices.push(invoice);
  }
  invoices.sort((a, b) => (a.date === b.date ? Number(b.number) - Number(a.number) : a.date < b.date ? 1 : -1));
  return invoices;
}

/**
 * Kill Bill generates a prorated invoice shortly after an immediate change, so the app waits
 * for it rather than computing proration itself.
 */
export async function awaitNewInvoice(
  accountId: string,
  knownInvoiceIds: ReadonlySet<string>,
  timeoutMs: number,
): Promise<Invoice | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const invoices = await listInvoices(accountId);
    const fresh = invoices.find((invoice) => !knownInvoiceIds.has(invoice.id));
    if (fresh) return fresh;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

export async function accountBalance(accountId: string): Promise<string> {
  const response = await call('GET', `/1.0/kb/accounts/${accountId}?accountWithBalance=true`);
  const account = parseJson<AccountJson>(response, 'GET', 'account');
  return killbillAmountToDecimal(account.accountBalance ?? 0);
}

/** Asks Kill Bill to pay one invoice with the account's default payment method. */
export async function payInvoice(accountId: string, invoiceId: string, amount: string): Promise<void> {
  const response = await call('POST', `/1.0/kb/invoices/${invoiceId}/payments?externalPayment=false`, {
    body: {
      targetInvoiceId: invoiceId,
      accountId,
      purchasedAmount: decimalToKillbillAmount(amount),
    },
  });
  if (response.status !== 201 && response.status !== 204) {
    throw new BillingUnavailable(`payment answered ${response.status}: ${response.text.slice(0, 200)}`);
  }
}

/** Posts one external charge, which Kill Bill invoices at once. */
export async function postExternalCharge(
  accountId: string,
  amount: string,
  description: string,
): Promise<string> {
  const response = await call('POST', `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`, {
    body: [
      {
        accountId,
        amount: decimalToKillbillAmount(amount),
        currency: 'EUR',
        description,
      },
    ],
  });
  const items = parseJson<ReadonlyArray<{ invoiceId: string }>>(response, 'POST', 'external charge');
  const invoiceId = items[0]?.invoiceId;
  if (invoiceId === undefined) throw new BillingUnavailable('external charge returned no invoice');
  return invoiceId;
}

/**
 * Finds an invoice already carrying an item with this description, so an attempt that lost
 * its response records the existing invoice instead of charging again.
 */
export async function findInvoiceByItemDescription(
  accountId: string,
  description: string,
): Promise<Invoice | null> {
  const invoices = await listInvoices(accountId);
  return invoices.find((invoice) => invoice.items.some((item) => item.description === description)) ?? null;
}

export async function billingIsUp(): Promise<boolean> {
  try {
    const response = await fetch(`${config.killbill.url}/1.0/healthcheck`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
