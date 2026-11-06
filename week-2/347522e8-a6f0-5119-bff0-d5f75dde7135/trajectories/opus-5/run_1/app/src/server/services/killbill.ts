/**
 * Kill Bill. Every call is attempted fresh with its own timeout, and no
 * failure or availability answer is ever cached, so billing that comes back is
 * used on the next request without a restart.
 */

import { QUICK_SERVICE_TIMEOUT_MS, SERVICE_TIMEOUT_MS, config } from '../config.js';

export const SHELF_PLAN = 'walk-in-shelf-monthly';
const SHELF_PRODUCT = 'WalkInShelf';
const SHELF_PRICE_USD = '45.00';
const EXTERNAL_PAYMENT_METHOD = '__EXTERNAL_PAYMENT__';
const CREATED_BY = 'railside';

export class BillingUnavailable extends Error {
  constructor(cause?: unknown) {
    super('billing_unavailable');
    this.cause = cause;
  }
}

export class PaymentDeclined extends Error {
  constructor(readonly paymentId: string | null) {
    super('payment_failed');
  }
}

function authHeaders(): Record<string, string> {
  const basic = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString(
    'base64',
  );
  return {
    authorization: `Basic ${basic}`,
    'X-Killbill-ApiKey': config.killbill.apiKey,
    'X-Killbill-ApiSecret': config.killbill.apiSecret,
    'X-Killbill-CreatedBy': CREATED_BY,
  };
}

interface CallOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  xml?: string;
  timeoutMs?: number;
  /** Status codes to hand back to the caller instead of treating as an outage. */
  expected?: number[];
}

interface KbResponse {
  status: number;
  location: string | null;
  text: string;
}

async function call(path: string, options: CallOptions = {}): Promise<KbResponse> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { ...authHeaders(), accept: 'application/json' };
  let body: string | undefined;
  if (options.xml !== undefined) {
    headers['content-type'] = 'text/xml';
    body = options.xml;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}${path}`, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(options.timeoutMs ?? SERVICE_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new BillingUnavailable(cause);
  }
  const text = await response.text();
  const acceptable = options.expected ?? [];
  if (response.status >= 500 && !acceptable.includes(response.status)) {
    throw new BillingUnavailable(`${method} ${path} answered ${response.status}`);
  }
  return {
    status: response.status,
    location: response.headers.get('location'),
    text,
  };
}

function parseJson<T>(response: KbResponse): T {
  if (response.text.length === 0) throw new BillingUnavailable('empty body from Kill Bill');
  return JSON.parse(response.text) as T;
}

function idFromLocation(location: string | null): string {
  // Kill Bill's Location header ends with a trailing slash.
  const id = location?.replace(/\/+$/, '').split('/').pop();
  if (!id) throw new BillingUnavailable('Kill Bill returned no resource location');
  return id;
}

/** The live billing check behind `purchases_available`, with a two-second budget. */
export async function isBillingReachable(): Promise<boolean> {
  try {
    const response = await call('/1.0/healthcheck', { timeoutMs: QUICK_SERVICE_TIMEOUT_MS });
    return response.status === 200;
  } catch {
    return false;
  }
}

export interface RenterAccountInput {
  renterId: string;
  businessName: string;
  email: string;
}

interface KbAccount {
  accountId: string;
}

/** The renter's one Kill Bill account, created the first time billing is needed. */
export async function ensureAccount(input: RenterAccountInput): Promise<string> {
  const externalKey = `renter-${input.renterId}`;
  const existing = await call(
    `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`,
    { expected: [404] },
  );
  if (existing.status === 200) {
    return parseJson<KbAccount>(existing).accountId;
  }
  const created = await call('/1.0/kb/accounts', {
    method: 'POST',
    body: {
      externalKey,
      name: input.businessName,
      email: input.email,
      currency: 'USD',
    },
    expected: [409],
  });
  if (created.status === 409) {
    const again = await call(`/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`);
    return parseJson<KbAccount>(again).accountId;
  }
  const accountId = idFromLocation(created.location);
  await ensureExternalPaymentMethod(accountId);
  return accountId;
}

interface KbPaymentMethod {
  paymentMethodId: string;
  pluginName: string;
  isDefault: boolean;
}

async function ensureExternalPaymentMethod(accountId: string): Promise<void> {
  const list = await call(`/1.0/kb/accounts/${accountId}/paymentMethods`);
  const methods = parseJson<KbPaymentMethod[]>(list);
  if (methods.some((method) => method.pluginName === EXTERNAL_PAYMENT_METHOD && method.isDefault)) {
    return;
  }
  await call(`/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`, {
    method: 'POST',
    body: {
      pluginName: EXTERNAL_PAYMENT_METHOD,
      pluginInfo: {},
    },
  });
}

interface KbPayment {
  paymentId: string;
  transactions: { transactionType: string; status: string }[];
}

/**
 * Records the pack payment. The payment external key is derived from the renter
 * and the idempotency key, so a retry finds the existing payment instead of
 * charging again.
 */
export async function recordPurchasePayment(
  accountId: string,
  amountUsd: string,
  paymentExternalKey: string,
): Promise<string> {
  const existing = await call(
    `/1.0/kb/payments?externalKey=${encodeURIComponent(paymentExternalKey)}`,
    { expected: [404] },
  );
  if (existing.status === 200) {
    return assertSucceeded(parseJson<KbPayment>(existing));
  }
  const created = await call(`/1.0/kb/accounts/${accountId}/payments`, {
    method: 'POST',
    body: {
      transactionType: 'PURCHASE',
      amount: Number(amountUsd),
      currency: 'USD',
      paymentExternalKey,
      transactionExternalKey: paymentExternalKey,
    },
    expected: [402, 409, 422],
  });
  if (created.status === 201 && created.location !== null) {
    const payment = await call(`/1.0/kb/payments/${idFromLocation(created.location)}`);
    return assertSucceeded(parseJson<KbPayment>(payment));
  }
  const lookup = await call(
    `/1.0/kb/payments?externalKey=${encodeURIComponent(paymentExternalKey)}`,
    { expected: [404] },
  );
  if (lookup.status === 200) {
    return assertSucceeded(parseJson<KbPayment>(lookup));
  }
  throw new PaymentDeclined(null);
}

function assertSucceeded(payment: KbPayment): string {
  const purchase = payment.transactions.find((tx) => tx.transactionType === 'PURCHASE');
  if (!purchase || purchase.status !== 'SUCCESS') {
    throw new PaymentDeclined(payment.paymentId);
  }
  return payment.paymentId;
}

/** Undoes a payment whose local save could not be completed. */
export async function refundPayment(paymentId: string, amountUsd: string): Promise<void> {
  await call(`/1.0/kb/payments/${paymentId}/refunds`, {
    method: 'POST',
    body: { amount: Number(amountUsd), currency: 'USD' },
    expected: [400, 404, 422],
  });
}

/** The overage charge at check-out. */
export async function addExternalCharge(
  accountId: string,
  amountUsd: string,
  description: string,
): Promise<void> {
  const response = await call(`/1.0/kb/invoices/charges/${accountId}?autoCommit=true`, {
    method: 'POST',
    body: [{ accountId, amount: Number(amountUsd), currency: 'USD', description }],
    expected: [400, 404, 422],
  });
  if (response.status !== 200 && response.status !== 201) {
    throw new BillingUnavailable(`external charge answered ${response.status}`);
  }
}

interface KbCatalog {
  products?: { name: string; plans?: { name: string }[] }[];
}

function shelfCatalogXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>2020-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>Railside</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies><currency>USD</currency></currencies>
  <products>
    <product name="${SHELF_PRODUCT}"><category>BASE</category></product>
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
    <plan name="${SHELF_PLAN}">
      <product>${SHELF_PRODUCT}</product>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice><price><currency>USD</currency><value>${SHELF_PRICE_USD}</value></price></recurringPrice>
        </recurring>
      </finalPhase>
    </plan>
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT"><plans><plan>${SHELF_PLAN}</plan></plans></defaultPriceList>
  </priceLists>
</catalog>`;
}

/** Uploads the shelf catalog when the tenant has no plan by that name yet. */
export async function ensureShelfCatalog(): Promise<void> {
  const response = await call('/1.0/kb/catalog', { expected: [404] });
  if (response.status === 200) {
    const catalogs = parseJson<KbCatalog[] | KbCatalog>(response);
    const list = Array.isArray(catalogs) ? catalogs : [catalogs];
    const hasPlan = list.some((catalog) =>
      (catalog.products ?? []).some((product) =>
        (product.plans ?? []).some((plan) => plan.name === SHELF_PLAN),
      ),
    );
    if (hasPlan) return;
  }
  const uploaded = await call('/1.0/kb/catalog/xml', { method: 'POST', xml: shelfCatalogXml() });
  if (uploaded.status !== 201) {
    throw new BillingUnavailable(`catalog upload answered ${uploaded.status}`);
  }
}

export interface KbSubscription {
  subscriptionId: string;
  state: string;
  cancelledDate?: string | null;
}

export async function createShelfSubscription(
  accountId: string,
  externalKey: string,
): Promise<KbSubscription> {
  await ensureShelfCatalog();
  const created = await call('/1.0/kb/subscriptions', {
    method: 'POST',
    body: {
      accountId,
      externalKey,
      planName: SHELF_PLAN,
    },
    expected: [400, 404, 409, 422],
  });
  if (created.status !== 201 || created.location === null) {
    throw new BillingUnavailable(`create subscription answered ${created.status}`);
  }
  const read = await call(`/1.0/kb/subscriptions/${idFromLocation(created.location)}`);
  return parseJson<KbSubscription>(read);
}

export async function cancelShelfSubscription(subscriptionId: string): Promise<KbSubscription> {
  const cancelled = await call(
    `/1.0/kb/subscriptions/${subscriptionId}?entitlementPolicy=IMMEDIATE&billingPolicy=IMMEDIATE&useRequestedDateForBilling=true`,
    { method: 'DELETE', expected: [400, 404] },
  );
  if (cancelled.status !== 204 && cancelled.status !== 200) {
    throw new BillingUnavailable(`cancel subscription answered ${cancelled.status}`);
  }
  const read = await call(`/1.0/kb/subscriptions/${subscriptionId}`);
  return parseJson<KbSubscription>(read);
}

/** Reads the subscription's state, with the two-second budget the renter read states. */
export async function readSubscription(subscriptionId: string): Promise<KbSubscription> {
  const read = await call(`/1.0/kb/subscriptions/${subscriptionId}`, {
    timeoutMs: QUICK_SERVICE_TIMEOUT_MS,
    expected: [404],
  });
  if (read.status === 404) {
    return { subscriptionId, state: 'CANCELLED' };
  }
  return parseJson<KbSubscription>(read);
}
