import { config } from '../config';
import { BAY_PLAN } from '../../shared/bays';

export class BillingUnavailable extends Error {
  constructor(cause?: unknown) {
    super('Kill Bill is unreachable');
    this.name = 'BillingUnavailable';
    this.cause = cause;
  }
}

const AUTH = `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64')}`;

function headers(contentType?: string): Record<string, string> {
  const result: Record<string, string> = {
    authorization: AUTH,
    'x-killbill-apikey': config.killbill.apiKey,
    'x-killbill-apisecret': config.killbill.apiSecret,
    'x-killbill-createdby': 'lacquer',
    accept: 'application/json',
  };
  if (contentType !== undefined) result['content-type'] = contentType;
  return result;
}

/** Numbers keep their exact decimal text, so no amount passes through binary floating point. */
function parseExact(text: string): unknown {
  if (text.trim() === '') return null;
  return JSON.parse(text, function reviver(_key, value, context?: { source?: string }) {
    if (typeof value === 'number' && context !== undefined && typeof context.source === 'string') {
      return context.source;
    }
    return value;
  }) as unknown;
}

interface KbResponse {
  readonly status: number;
  readonly body: unknown;
  readonly location: string | null;
}

async function request(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = 25_000,
): Promise<KbResponse> {
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}${path}`, {
      method,
      headers: headers(body === undefined ? undefined : 'application/json'),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new BillingUnavailable(error);
  }
  const text = await response.text();
  if (response.status >= 500) {
    throw new BillingUnavailable(new Error(`${method} ${path} answered ${response.status}`));
  }
  let parsed: unknown = null;
  try {
    parsed = parseExact(text);
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed, location: response.headers.get('location') };
}

function expectOk(response: KbResponse, method: string, path: string): KbResponse {
  if (response.status >= 200 && response.status < 300) return response;
  throw new BillingUnavailable(new Error(`${method} ${path} answered ${response.status}`));
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** A Kill Bill amount, normalised to two decimals without losing exactness. */
export function normaliseAmount(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return '0.00';
  const negative = raw.startsWith('-');
  const body = negative ? raw.slice(1) : raw;
  const [whole = '0', fraction = ''] = body.split('.');
  const twoDecimals = `${fraction}00`.slice(0, 2);
  return `${negative ? '-' : ''}${whole}.${twoDecimals}`;
}

export async function billingAnswers(): Promise<boolean> {
  try {
    const response = await fetch(`${config.killbill.url}/1.0/healthcheck`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const CATALOG_XML = buildCatalogXml();

function buildCatalogXml(): string {
  const plans = Object.values(BAY_PLAN);
  return `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>2020-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>MarrowLarkBays</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies><currency>CHF</currency></currencies>
  <products>
${plans.map((plan) => `    <product name="${plan.product}"><category>BASE</category></product>`).join('\n')}
  </products>
  <rules>
    <changePolicy><changePolicyCase><policy>IMMEDIATE</policy></changePolicyCase></changePolicy>
    <changeAlignment><changeAlignmentCase><alignment>START_OF_BUNDLE</alignment></changeAlignmentCase></changeAlignment>
    <cancelPolicy><cancelPolicyCase><policy>IMMEDIATE</policy></cancelPolicyCase></cancelPolicy>
    <createAlignment><createAlignmentCase><alignment>START_OF_BUNDLE</alignment></createAlignmentCase></createAlignment>
    <billingAlignment><billingAlignmentCase><alignment>ACCOUNT</alignment></billingAlignmentCase></billingAlignment>
    <priceList><priceListCase><toPriceList>DEFAULT</toPriceList></priceListCase></priceList>
  </rules>
  <plans>
${plans
  .map(
    (plan) => `    <plan name="${plan.plan}">
      <product>${plan.product}</product>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice><price><currency>CHF</currency><value>${plan.price}</value></price></recurringPrice>
        </recurring>
      </finalPhase>
    </plan>`,
  )
  .join('\n')}
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT">
      <plans>
${plans.map((plan) => `        <plan>${plan.plan}</plan>`).join('\n')}
      </plans>
    </defaultPriceList>
  </priceLists>
</catalog>`;
}

export async function catalogIsPublished(): Promise<boolean> {
  const response = await request('GET', '/1.0/kb/catalog', undefined, 10_000);
  if (response.status !== 200 || !Array.isArray(response.body)) return false;
  const published = JSON.stringify(response.body);
  return Object.values(BAY_PLAN).every((plan) => published.includes(plan.plan));
}

export async function publishCatalog(): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}/1.0/kb/catalog/xml`, {
      method: 'POST',
      headers: { ...headers('text/xml'), accept: 'application/xml' },
      body: CATALOG_XML,
      signal: AbortSignal.timeout(25_000),
    });
  } catch (error) {
    throw new BillingUnavailable(error);
  }
  if (!response.ok) {
    throw new BillingUnavailable(new Error(`catalog upload answered ${response.status}`));
  }
}

export function accountKey(ownerId: string): string {
  return `${config.killbill.keyPrefix}owner-${ownerId}`;
}

export function subscriptionKey(carId: string, staySeq = 1): string {
  const base = `${config.killbill.keyPrefix}car-${carId}`;
  return staySeq <= 1 ? base : `${base}-stay-${String(staySeq)}`;
}

export function transferKey(transferId: string): string {
  return `${config.killbill.keyPrefix}transfer-${transferId}`;
}

async function findAccount(externalKey: string): Promise<string | null> {
  const path = `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`;
  const response = await request('GET', path);
  if (response.status === 404) return null;
  expectOk(response, 'GET', path);
  return text(record(response.body)?.accountId);
}

/** One Kill Bill account per owner, created when first needed and reused when it exists. */
export async function ensureAccount(
  ownerId: string,
  name: string,
  email: string,
): Promise<string> {
  const externalKey = accountKey(ownerId);
  const existing = await findAccount(externalKey);
  if (existing !== null) return existing;
  const created = await request('POST', '/1.0/kb/accounts', {
    externalKey,
    name,
    email,
    currency: 'CHF',
    timeZone: 'Europe/Zurich',
  });
  if (created.status === 201) {
    const location = created.location;
    const id = location === null ? null : (location.split('/').pop() ?? null);
    if (id !== null && id !== '') return id;
  }
  const retried = await findAccount(externalKey);
  if (retried !== null) return retried;
  throw new BillingUnavailable(new Error('account could not be created'));
}

export interface KbSubscription {
  readonly subscriptionId: string;
  readonly state: string;
  readonly chargedThroughDate: string | null;
  readonly billingEndDate: string | null;
}

function dateOnly(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return match === null ? null : (match[1] ?? null);
}

function toSubscription(body: unknown): KbSubscription | null {
  const entry = record(body);
  const id = text(entry?.subscriptionId);
  if (id === null) return null;
  return {
    subscriptionId: id,
    state: text(entry?.state) ?? 'ACTIVE',
    chargedThroughDate: dateOnly(entry?.chargedThroughDate),
    billingEndDate: dateOnly(entry?.billingEndDate),
  };
}

export async function findSubscription(
  carId: string,
  staySeq = 1,
): Promise<KbSubscription | null> {
  const path = `/1.0/kb/subscriptions?externalKey=${encodeURIComponent(subscriptionKey(carId, staySeq))}`;
  const response = await request('GET', path);
  if (response.status === 404) return null;
  expectOk(response, 'GET', path);
  return toSubscription(response.body);
}

export async function readSubscriptionById(subscriptionId: string): Promise<KbSubscription | null> {
  const path = `/1.0/kb/subscriptions/${subscriptionId}`;
  const response = await request('GET', path);
  if (response.status === 404) return null;
  expectOk(response, 'GET', path);
  return toSubscription(response.body);
}

/** Creates the car's bay subscription, reusing it when it already exists. */
export async function ensureSubscription(
  carId: string,
  accountId: string,
  planName: string,
  staySeq: number,
): Promise<KbSubscription> {
  // A stay of its own, so a car taken in again after a release is billed again.
  let stay = staySeq;
  let existing = await findSubscription(carId, stay);
  while (existing !== null && existing.state === 'CANCELLED' && stay < staySeq + 20) {
    stay += 1;
    existing = await findSubscription(carId, stay);
  }
  if (existing !== null) return existing;
  await request('POST', '/1.0/kb/subscriptions', {
    accountId,
    externalKey: subscriptionKey(carId, stay),
    planName,
  });
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const created = await findSubscription(carId, stay);
    if (created !== null) return created;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new BillingUnavailable(new Error('subscription could not be created'));
}

/** Entitlement ends at once and billing at the end of the paid term. */
export async function cancelSubscription(subscriptionId: string): Promise<void> {
  const path = `/1.0/kb/subscriptions/${subscriptionId}?entitlementPolicy=IMMEDIATE&billingPolicy=END_OF_TERM&useRequestedDateForBilling=false`;
  const response = await request('DELETE', path);
  if (response.status === 404) return;
  expectOk(response, 'DELETE', path);
}

export interface KbCharge {
  readonly invoiceId: string;
}

export async function externalCharge(
  accountId: string,
  amount: string,
  description: string,
): Promise<KbCharge> {
  const path = `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`;
  const response = expectOk(
    await request('POST', path, [{ accountId, amount, currency: 'CHF', description }]),
    'POST',
    path,
  );
  const items = Array.isArray(response.body) ? response.body : [];
  for (const item of items) {
    const invoiceId = text(record(item)?.invoiceId);
    if (invoiceId !== null) return { invoiceId };
  }
  throw new BillingUnavailable(new Error('charge returned no invoice'));
}

export interface KbInvoice {
  readonly invoiceId: string;
  readonly balance: string;
  readonly amount: string;
}

export async function readInvoice(invoiceId: string): Promise<KbInvoice> {
  const path = `/1.0/kb/invoices/${invoiceId}`;
  const response = expectOk(await request('GET', path), 'GET', path);
  const entry = record(response.body);
  return {
    invoiceId,
    balance: normaliseAmount(entry?.balance),
    amount: normaliseAmount(entry?.amount),
  };
}

export interface KbPayment {
  readonly paymentId: string;
  readonly paymentExternalKey: string | null;
  readonly amount: string;
  readonly refunded: string;
  readonly at: string;
}

export async function readInvoicePayments(invoiceId: string): Promise<KbPayment[]> {
  const path = `/1.0/kb/invoices/${invoiceId}/payments`;
  const response = expectOk(await request('GET', path), 'GET', path);
  const list = Array.isArray(response.body) ? response.body : [];
  const payments: KbPayment[] = [];
  for (const item of list) {
    const entry = record(item);
    const paymentId = text(entry?.paymentId);
    if (paymentId === null) continue;
    payments.push({
      paymentId,
      paymentExternalKey: text(entry?.paymentExternalKey),
      amount: normaliseAmount(entry?.purchasedAmount),
      refunded: normaliseAmount(entry?.refundedAmount),
      at: firstTransactionTime(entry?.transactions),
    });
  }
  payments.sort((left, right) => left.at.localeCompare(right.at));
  return payments;
}

function firstTransactionTime(transactions: unknown): string {
  if (!Array.isArray(transactions)) return new Date(0).toISOString();
  for (const transaction of transactions) {
    const entry = record(transaction);
    if (text(entry?.transactionType) === 'PURCHASE') {
      const effective = text(entry?.effectiveDate);
      if (effective !== null) return new Date(effective).toISOString();
    }
  }
  return new Date(0).toISOString();
}

/** Each bank transfer is one Kill Bill external payment against that invoice. */
export async function externalPayment(
  accountId: string,
  invoiceId: string,
  amount: string,
  externalKey: string,
): Promise<string> {
  const path = `/1.0/kb/invoices/${invoiceId}/payments?externalPayment=true`;
  expectOk(
    await request('POST', path, {
      accountId,
      targetInvoiceId: invoiceId,
      purchasedAmount: amount,
      currency: 'CHF',
      paymentExternalKey: externalKey,
    }),
    'POST',
    path,
  );
  const payments = await readInvoicePayments(invoiceId);
  const match = payments.find((payment) => payment.paymentExternalKey === externalKey);
  if (match === undefined) {
    throw new BillingUnavailable(new Error('payment could not be read back'));
  }
  return match.paymentId;
}

export async function setPaymentCustomField(
  paymentId: string,
  name: string,
  value: string,
): Promise<void> {
  const path = `/1.0/kb/payments/${paymentId}/customFields`;
  expectOk(await request('POST', path, [{ name, value }]), 'POST', path);
}
