import { KILLBILL_PRODUCT, PLANS } from '../../shared/catalogue.js';
import { formatCents } from '../../shared/money.js';
import { env } from '../env.js';
import { billingUnavailable } from '../http/errors.js';
import { markService } from './health.js';

/** Thrown when Kill Bill cannot be reached, so each caller can answer with its own copy. */
export class BillingUnreachable extends Error {
  constructor() {
    super('Kill Bill is unreachable');
    this.name = 'BillingUnreachable';
  }
}

/** Runs `work` and turns a Kill Bill outage into a 503 carrying this caller's copy. */
export async function withBillingOutage<T>(message: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof BillingUnreachable) throw billingUnavailable(message);
    throw error;
  }
}

/** Thrown when Kill Bill answers but refuses the call. */
class BillingRefusal extends Error {
  constructor(
    readonly status: number,
    readonly payload: string,
  ) {
    super(`Kill Bill answered ${status}: ${payload}`);
    this.name = 'BillingRefusal';
  }
}

const AUTO_PAY_OFF_TAG = '00000000-0000-0000-0000-000000000001';
const AUTO_INVOICING_DRAFT_TAG = '00000000-0000-0000-0000-000000000008';
const EXTERNAL_PAYMENT_PLUGIN = '__EXTERNAL_PAYMENT__';
const CURRENCY = 'CAD';

function headers(contentType = 'application/json'): Record<string, string> {
  return {
    authorization: `Basic ${Buffer.from(`${env.killbill.username}:${env.killbill.password}`).toString('base64')}`,
    'X-Killbill-ApiKey': env.killbill.apiKey,
    'X-Killbill-ApiSecret': env.killbill.apiSecret,
    'X-Killbill-CreatedBy': 'ceibo',
    'content-type': contentType,
  };
}

interface KbResponse {
  status: number;
  location: string | null;
  text: string;
}

async function send(
  method: string,
  path: string,
  body?: unknown,
  contentType = 'application/json',
): Promise<KbResponse> {
  let response: Response;
  try {
    response = await fetch(`${env.killbill.url}${path}`, {
      method,
      headers: headers(contentType),
      body:
        body === undefined
          ? undefined
          : typeof body === 'string'
            ? body
            : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    markService('killbill', false);
    throw new BillingUnreachable();
  }
  markService('killbill', true);
  return {
    status: response.status,
    location: response.headers.get('location'),
    text: await response.text(),
  };
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await send(method, path, body);
  if (response.status >= 400) throw new BillingRefusal(response.status, response.text);
  return (response.text === '' ? null : JSON.parse(response.text)) as T;
}

async function callForId(method: string, path: string, body?: unknown): Promise<string> {
  const response = await send(method, path, body);
  if (response.status >= 400) throw new BillingRefusal(response.status, response.text);
  if (response.location === null) throw new BillingRefusal(response.status, 'no Location header');
  return response.location.replace(/\/$/, '').split('/').pop()!;
}

export async function probeKillBill(): Promise<void> {
  const response = await send('GET', '/1.0/healthcheck');
  if (response.status !== 200) throw new Error(`Kill Bill health answered ${response.status}`);
}

/** Dollars-and-cents string Kill Bill accepts for an amount in whole cents. */
function amount(cents: number): number {
  return Number(formatCents(cents));
}

/* ------------------------------------------------------------------ catalogue */

function catalogueXml(): string {
  const planXml = PLANS.map(
    (plan) => `    <plan name="${plan.name}">
      <product>${KILLBILL_PRODUCT}</product>
      <initialPhases/>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit><number>-1</number></duration>
        <recurring>
          <billingPeriod>${plan.cadence === 'monthly' ? 'MONTHLY' : 'BIMESTRIAL'}</billingPeriod>
          <recurringPrice><price><currency>CAD</currency><value>35.96</value></price></recurringPrice>
        </recurring>
      </finalPhase>
    </plan>`,
  ).join('\n');
  const priceListXml = PLANS.map((plan) => `        <plan>${plan.name}</plan>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>2020-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>Ceibo</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies><currency>CAD</currency></currencies>
  <units/>
  <products>
    <product name="${KILLBILL_PRODUCT}">
      <category>BASE</category>
      <included/>
      <available/>
      <limits/>
    </product>
  </products>
  <rules>
    <changePolicy><changePolicyCase><policy>END_OF_TERM</policy></changePolicyCase></changePolicy>
    <changeAlignment><changeAlignmentCase><alignment>START_OF_SUBSCRIPTION</alignment></changeAlignmentCase></changeAlignment>
    <cancelPolicy><cancelPolicyCase><policy>END_OF_TERM</policy></cancelPolicyCase></cancelPolicy>
    <createAlignment><createAlignmentCase><alignment>START_OF_BUNDLE</alignment></createAlignmentCase></createAlignment>
    <billingAlignment><billingAlignmentCase><alignment>SUBSCRIPTION</alignment></billingAlignmentCase></billingAlignment>
    <priceList><priceListCase><toPriceList>DEFAULT</toPriceList></priceListCase></priceList>
  </rules>
  <plans>
${planXml}
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT">
      <plans>
${priceListXml}
      </plans>
    </defaultPriceList>
  </priceLists>
</catalog>
`;
}

interface KbCatalogVersion {
  products?: Array<{ plans?: Array<{ name: string }> }>;
}

/** Uploads the catalogue only when the tenant is missing any of the published plans. */
export async function ensureCatalogue(): Promise<void> {
  const versions = await call<KbCatalogVersion[]>('GET', '/1.0/kb/catalog');
  const present = new Set<string>();
  for (const version of versions) {
    for (const product of version.products ?? []) {
      for (const plan of product.plans ?? []) present.add(plan.name);
    }
  }
  if (PLANS.every((plan) => present.has(plan.name))) return;
  const response = await send('POST', '/1.0/kb/catalog/xml', catalogueXml(), 'text/xml');
  if (response.status >= 400) throw new BillingRefusal(response.status, response.text);
}

/* -------------------------------------------------------------------- clock */

interface KbClock {
  currentUtcTime: string;
}

let cachedClock: { at: number; now: Date } | null = null;
const CLOCK_CACHE_MS = 1_000;

/** The tenant's own clock, which the test mode may move at any time. */
export async function killBillNow(): Promise<Date> {
  const cached = cachedClock;
  if (cached !== null && Date.now() - cached.at < CLOCK_CACHE_MS) return cached.now;
  const clock = await call<KbClock>('GET', '/1.0/kb/test/clock');
  const now = new Date(clock.currentUtcTime);
  cachedClock = { at: Date.now(), now };
  return now;
}

/* ------------------------------------------------------------------ accounts */

interface KbAccount {
  accountId: string;
  externalKey: string;
}

/**
 * One Kill Bill account per customer, keyed by their PocketBase user id, so
 * processes sharing the tenant share the account. Carries AUTO_PAY_OFF because the
 * server charges every invoice itself, and AUTO_INVOICING_DRAFT so a box invoice
 * can take its deposit, shipping and tax charges before it is committed.
 */
export async function getOrCreateAccount(input: {
  externalKey: string;
  name: string;
  email: string;
}): Promise<string> {
  const existing = await findAccount(input.externalKey);
  if (existing !== null) return existing;

  let accountId: string;
  try {
    accountId = await callForId('POST', '/1.0/kb/accounts', {
      name: input.name,
      externalKey: input.externalKey,
      currency: CURRENCY,
      email: input.email,
    });
  } catch (error) {
    if (error instanceof BillingRefusal) {
      const raced = await findAccount(input.externalKey);
      if (raced !== null) return raced;
    }
    throw error;
  }
  await call('POST', `/1.0/kb/accounts/${accountId}/tags`, [
    AUTO_PAY_OFF_TAG,
    AUTO_INVOICING_DRAFT_TAG,
  ]);
  await call('POST', `/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`, {
    pluginName: EXTERNAL_PAYMENT_PLUGIN,
    pluginInfo: {},
  });
  return accountId;
}

async function findAccount(externalKey: string): Promise<string | null> {
  const response = await send(
    'GET',
    `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`,
  );
  if (response.status === 404) return null;
  if (response.status >= 400) throw new BillingRefusal(response.status, response.text);
  return (JSON.parse(response.text) as KbAccount).accountId;
}

/* ------------------------------------------------------------------ payments */

export interface KbTransaction {
  transactionId: string;
  transactionType: string;
  transactionExternalKey: string;
  amount: number;
  status: string;
}

export interface KbPayment {
  paymentId: string;
  paymentExternalKey: string;
  purchasedAmount: number;
  refundedAmount: number;
  transactions: KbTransaction[];
}

export function paymentKey(orderNumber: string): string {
  return `${env.databaseName}/${orderNumber}`;
}

export async function findPayment(externalKey: string): Promise<KbPayment | null> {
  const response = await send(
    'GET',
    `/1.0/kb/payments?externalKey=${encodeURIComponent(externalKey)}`,
  );
  if (response.status === 404) return null;
  if (response.status >= 400) throw new BillingRefusal(response.status, response.text);
  return JSON.parse(response.text) as KbPayment;
}

/** One PURCHASE payment for a one-off order, keyed by `<database>/<order number>`. */
export async function createPurchase(input: {
  accountId: string;
  orderNumber: string;
  totalCents: number;
}): Promise<void> {
  const key = paymentKey(input.orderNumber);
  await call('POST', `/1.0/kb/accounts/${input.accountId}/payments`, {
    transactionType: 'PURCHASE',
    amount: amount(input.totalCents),
    currency: CURRENCY,
    paymentExternalKey: key,
    transactionExternalKey: `${key}/purchase`,
  });
}

export async function refundPayment(input: {
  paymentId: string;
  amountCents: number;
  transactionExternalKey: string;
}): Promise<void> {
  await call('POST', `/1.0/kb/payments/${input.paymentId}/refunds`, {
    amount: amount(input.amountCents),
    currency: CURRENCY,
    transactionExternalKey: input.transactionExternalKey,
  });
}

/** Reads back whether Kill Bill holds a successful refund transaction. */
export async function refundConfirmed(
  paymentExternalKey: string,
  transactionExternalKey: string,
): Promise<boolean> {
  const payment = await findPayment(paymentExternalKey);
  if (payment === null) return false;
  return payment.transactions.some(
    (transaction) =>
      transaction.transactionExternalKey === transactionExternalKey &&
      transaction.transactionType === 'REFUND' &&
      transaction.status === 'SUCCESS',
  );
}

/* ------------------------------------------------------------------ invoices */

export interface KbInvoiceItem {
  invoiceItemId: string;
  itemType: string;
  amount: number;
  subscriptionId: string | null;
  planName: string | null;
  startDate: string | null;
  endDate: string | null;
}

export interface KbInvoice {
  invoiceId: string;
  invoiceNumber: string | null;
  status: 'DRAFT' | 'COMMITTED' | 'VOID';
  amount: number;
  balance: number;
  targetDate: string;
  items: KbInvoiceItem[];
}

export async function listAccountInvoiceIds(accountId: string): Promise<string[]> {
  const invoices = await call<Array<{ invoiceId: string }>>(
    'GET',
    `/1.0/kb/accounts/${accountId}/invoices`,
  );
  return invoices.map((invoice) => invoice.invoiceId);
}

export async function getInvoice(invoiceId: string): Promise<KbInvoice> {
  return call<KbInvoice>('GET', `/1.0/kb/invoices/${invoiceId}?withItems=true`);
}

export interface ExternalCharge {
  description: string;
  cents: number;
}

export async function addExternalCharges(input: {
  accountId: string;
  invoiceId: string;
  charges: readonly ExternalCharge[];
}): Promise<void> {
  const payload = input.charges
    .filter((charge) => charge.cents > 0)
    .map((charge) => ({
      invoiceId: input.invoiceId,
      accountId: input.accountId,
      amount: amount(charge.cents),
      currency: CURRENCY,
      description: charge.description,
    }));
  if (payload.length === 0) return;
  await call('POST', `/1.0/kb/invoices/charges/${input.accountId}`, payload);
}

export async function commitInvoice(invoiceId: string): Promise<void> {
  await call('PUT', `/1.0/kb/invoices/${invoiceId}/commitInvoice`);
}

/** Pays a committed invoice in full, keyed by `<database>/<order number>`. */
export async function payInvoice(input: {
  accountId: string;
  invoiceId: string;
  orderNumber: string;
  totalCents: number;
}): Promise<void> {
  await call(
    'POST',
    `/1.0/kb/invoices/${input.invoiceId}/payments?externalPayment=false`,
    {
      accountId: input.accountId,
      targetInvoiceId: input.invoiceId,
      purchasedAmount: amount(input.totalCents),
      currency: CURRENCY,
      paymentExternalKey: paymentKey(input.orderNumber),
    },
  );
}

/* ------------------------------------------------------------- subscriptions */

export interface KbSubscriptionEvent {
  eventType: string;
  effectiveDate: string;
  plan: string | null;
  serviceName: string | null;
  serviceStateName: string | null;
}

export interface KbSubscription {
  subscriptionId: string;
  accountId: string;
  bundleId: string;
  planName: string;
  billingPeriod: string;
  state: string;
  startDate: string;
  chargedThroughDate: string | null;
  billingEndDate: string | null;
  cancelledDate: string | null;
  events: KbSubscriptionEvent[];
}

export async function createSubscription(input: {
  accountId: string;
  planName: string;
}): Promise<string> {
  return callForId('POST', '/1.0/kb/subscriptions?callCompletion=true&callTimeoutSec=20', {
    accountId: input.accountId,
    planName: input.planName,
  });
}

export async function getSubscription(subscriptionId: string): Promise<KbSubscription | null> {
  const response = await send('GET', `/1.0/kb/subscriptions/${subscriptionId}`);
  if (response.status === 404) return null;
  if (response.status >= 400) throw new BillingRefusal(response.status, response.text);
  return JSON.parse(response.text) as KbSubscription;
}

export async function changePlan(input: {
  subscriptionId: string;
  planName: string;
  requestedDate: string;
}): Promise<void> {
  await call(
    'PUT',
    `/1.0/kb/subscriptions/${input.subscriptionId}?requestedDate=${input.requestedDate}`,
    { productName: KILLBILL_PRODUCT, planName: input.planName, priceList: 'DEFAULT' },
  );
}

export async function cancelEndOfTerm(subscriptionId: string): Promise<void> {
  await call(
    'DELETE',
    `/1.0/kb/subscriptions/${subscriptionId}?entitlementPolicy=END_OF_TERM&billingPolicy=END_OF_TERM&useRequestedDateForBilling=false`,
  );
}

export async function cancelImmediately(subscriptionId: string): Promise<void> {
  await call(
    'DELETE',
    `/1.0/kb/subscriptions/${subscriptionId}?entitlementPolicy=IMMEDIATE&billingPolicy=IMMEDIATE`,
  );
}

/* ---------------------------------------------------------- blocking states */

export const CEIBO_SERVICE = 'ceibo';
const CEIBO_DUNNING_SERVICE = 'ceibo-dunning';

export type CeiboBlockingState =
  | 'CEIBO_PAUSED'
  | 'CEIBO_SKIPPED'
  | 'CEIBO_ACTIVE'
  | 'CEIBO_OVERDUE'
  | 'CEIBO_CLEAR';

export interface KbBlockingState {
  blockedId: string;
  stateName: string;
  service: string;
  isBlockChange: boolean;
  isBlockEntitlement: boolean;
  isBlockBilling: boolean;
  effectiveDate: string;
  type: 'SUBSCRIPTION' | 'ACCOUNT';
}

/** Kill Bill takes the effective date of a blocking state from the query string. */
export async function blockSubscription(input: {
  subscriptionId: string;
  stateName: CeiboBlockingState;
  blocking: boolean;
  requestedDate?: string;
}): Promise<void> {
  const date =
    input.requestedDate === undefined ? '' : `?requestedDate=${input.requestedDate}`;
  await call('POST', `/1.0/kb/subscriptions/${input.subscriptionId}/block${date}`, {
    stateName: input.stateName,
    service: CEIBO_SERVICE,
    isBlockChange: false,
    isBlockEntitlement: input.blocking,
    isBlockBilling: input.blocking,
  });
}

export async function blockAccount(input: {
  accountId: string;
  stateName: CeiboBlockingState;
}): Promise<void> {
  await call('POST', `/1.0/kb/accounts/${input.accountId}/block`, {
    stateName: input.stateName,
    service: CEIBO_DUNNING_SERVICE,
    isBlockChange: false,
    isBlockEntitlement: false,
    isBlockBilling: false,
  });
}

export async function listBlockingStates(
  accountId: string,
  type: 'SUBSCRIPTION' | 'ACCOUNT',
): Promise<KbBlockingState[]> {
  return call<KbBlockingState[]>(
    'GET',
    `/1.0/kb/accounts/${accountId}/block?blockingStateTypes=${type}`,
  );
}


