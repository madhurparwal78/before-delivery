import { config } from '../config';
import { billingUnavailable, idempotencyConflict } from '../errors';

const PLAN_NAME = 'bellroll-rental-monthly';
const REQUEST_TIMEOUT_MS = 20000;

const CATALOG_XML = `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>2020-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>Bellroll</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies><currency>USD</currency></currencies>
  <products>
    <product name="Rental"><category>BASE</category></product>
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
    <plan name="${PLAN_NAME}">
      <product>Rental</product>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice><price><currency>USD</currency><value>0.00</value></price></recurringPrice>
        </recurring>
      </finalPhase>
    </plan>
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT"><plans><plan>${PLAN_NAME}</plan></plans></defaultPriceList>
  </priceLists>
</catalog>`;

export interface KillBillTransaction {
  transactionType: string;
  amount: number;
  status: string;
  transactionExternalKey: string;
  transactionId: string;
}

export interface KillBillPayment {
  paymentId: string;
  paymentExternalKey: string;
  transactions: KillBillTransaction[];
}

export interface KillBillSubscription {
  subscriptionId: string;
  state: string;
}

interface Reply {
  status: number;
  location: string | null;
  text: string;
}

function basicAuth(): string {
  return `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64')}`;
}

async function call(
  method: string,
  path: string,
  options: { body?: string; contentType?: string; tenantHeaders?: boolean } = {},
): Promise<Reply> {
  const headers: Record<string, string> = {
    Authorization: basicAuth(),
    'X-Killbill-CreatedBy': 'bellroll',
  };
  if (options.tenantHeaders !== false) {
    headers['X-Killbill-ApiKey'] = config.killbill.apiKey;
    headers['X-Killbill-ApiSecret'] = config.killbill.apiSecret;
  }
  if (options.body !== undefined) headers['Content-Type'] = options.contentType ?? 'application/json';
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}${path}`, {
      method,
      headers,
      body: options.body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw billingUnavailable();
  }
  return { status: response.status, location: response.headers.get('location'), text: await response.text() };
}

function parse<T>(reply: Reply): T {
  try {
    return JSON.parse(reply.text) as T;
  } catch {
    throw billingUnavailable();
  }
}

function idFromLocation(reply: Reply): string {
  const parts = (reply.location ?? '').split('/').filter((part) => part.length > 0);
  const id = parts[parts.length - 1];
  if (id === undefined) throw billingUnavailable();
  return id;
}

function dollars(amountCents: number): string {
  return (amountCents / 100).toFixed(2);
}

function cents(amount: number): number {
  return Math.round(amount * 100);
}

let tenantReady = false;

/** Creates the tenant and uploads the plan catalog when the configured tenant has neither. */
export async function ensureTenantAndCatalog(): Promise<void> {
  const tenant = await call('GET', `/1.0/kb/tenants?apiKey=${encodeURIComponent(config.killbill.apiKey)}`, {
    tenantHeaders: false,
  });
  if (tenant.status !== 200) {
    const created = await call('POST', '/1.0/kb/tenants?useGlobalDefault=true', {
      tenantHeaders: false,
      body: JSON.stringify({ apiKey: config.killbill.apiKey, apiSecret: config.killbill.apiSecret }),
    });
    if (created.status !== 201 && created.status !== 409) throw billingUnavailable();
  }
  const plans = await call('GET', '/1.0/kb/catalog/availableBasePlans');
  if (plans.status !== 200) throw billingUnavailable();
  const available = parse<Array<{ plan?: string }>>(plans);
  if (available.some((entry) => entry.plan === PLAN_NAME)) {
    tenantReady = true;
    return;
  }
  const uploaded = await call('POST', '/1.0/kb/catalog/xml', { body: CATALOG_XML, contentType: 'text/xml' });
  if (uploaded.status !== 201) throw billingUnavailable();
  tenantReady = true;
}

/** Looks an account up by its external key and creates it with an external payment method when missing. */
export async function ensureAccount(contractId: string, parentName: string): Promise<string> {
  if (!tenantReady) await ensureTenantAndCatalog();
  const found = await call('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(contractId)}`);
  if (found.status === 200) return parse<{ accountId: string }>(found).accountId;
  if (found.status !== 404) throw billingUnavailable();
  const created = await call('POST', '/1.0/kb/accounts', {
    body: JSON.stringify({ name: parentName, externalKey: contractId, currency: 'USD' }),
  });
  if (created.status !== 201) throw billingUnavailable();
  const accountId = idFromLocation(created);
  const method = await call('POST', `/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`, {
    body: JSON.stringify({ pluginName: '__EXTERNAL_PAYMENT__', pluginInfo: {} }),
  });
  if (method.status !== 201) throw billingUnavailable();
  return accountId;
}

export function subscriptionExternalKey(contractId: string): string {
  return `${contractId}-rental`;
}

export async function findSubscription(contractId: string): Promise<KillBillSubscription | null> {
  const key = subscriptionExternalKey(contractId);
  const found = await call('GET', `/1.0/kb/subscriptions?externalKey=${encodeURIComponent(key)}`);
  if (found.status === 404) return null;
  if (found.status !== 200) throw billingUnavailable();
  return parse<KillBillSubscription>(found);
}

export async function ensureSubscription(contractId: string, accountId: string): Promise<string> {
  const existing = await findSubscription(contractId);
  if (existing !== null) return existing.subscriptionId;
  const created = await call('POST', '/1.0/kb/subscriptions', {
    body: JSON.stringify({
      accountId,
      externalKey: subscriptionExternalKey(contractId),
      planName: PLAN_NAME,
    }),
  });
  if (created.status !== 201) throw billingUnavailable();
  return idFromLocation(created);
}

async function readSubscription(subscriptionId: string): Promise<KillBillSubscription> {
  const reply = await call('GET', `/1.0/kb/subscriptions/${subscriptionId}`);
  if (reply.status !== 200) throw billingUnavailable();
  return parse<KillBillSubscription>(reply);
}

/** Cancels a subscription immediately and commits only once Kill Bill reads it back as cancelled. */
export async function cancelSubscriptionAndConfirm(subscriptionId: string): Promise<void> {
  const before = await readSubscription(subscriptionId);
  if (before.state !== 'CANCELLED') {
    const cancelled = await call(
      'DELETE',
      `/1.0/kb/subscriptions/${subscriptionId}?entitlementPolicy=IMMEDIATE&billingPolicy=IMMEDIATE`,
    );
    if (cancelled.status !== 204 && cancelled.status !== 200) throw billingUnavailable();
  }
  const after = await readSubscription(subscriptionId);
  if (after.state !== 'CANCELLED') throw billingUnavailable();
}

export async function findPayment(paymentExternalKey: string): Promise<KillBillPayment | null> {
  const found = await call('GET', `/1.0/kb/payments?externalKey=${encodeURIComponent(paymentExternalKey)}`);
  if (found.status === 404) return null;
  if (found.status !== 200) throw billingUnavailable();
  return parse<KillBillPayment>(found);
}

/**
 * The one purchase for an action: an already successful transaction under the same external key is
 * adopted, the same key with a different amount is refused, and nothing else charges twice.
 */
export async function purchaseOnce(
  accountId: string,
  externalKey: string,
  amountCents: number,
): Promise<{ killbillPaymentId: string }> {
  const existing = await findPayment(externalKey);
  const succeeded = existing?.transactions.find(
    (transaction) =>
      transaction.transactionType === 'PURCHASE' &&
      transaction.status === 'SUCCESS' &&
      transaction.transactionExternalKey === externalKey,
  );
  if (existing !== null && succeeded !== undefined) {
    if (cents(succeeded.amount) !== amountCents) throw idempotencyConflict();
    return { killbillPaymentId: existing.paymentId };
  }
  const created = await call('POST', `/1.0/kb/accounts/${accountId}/payments`, {
    body: JSON.stringify({
      transactionType: 'PURCHASE',
      amount: dollars(amountCents),
      currency: 'USD',
      paymentExternalKey: externalKey,
      transactionExternalKey: externalKey,
    }),
  });
  if (created.status !== 201) throw billingUnavailable();
  const payment = await findPayment(externalKey);
  const confirmed = payment?.transactions.find(
    (transaction) => transaction.transactionExternalKey === externalKey && transaction.status === 'SUCCESS',
  );
  if (payment === null || confirmed === undefined) throw billingUnavailable();
  return { killbillPaymentId: payment.paymentId };
}

/** The one refund for a reversal, on the original payment, adopting a successful earlier attempt. */
export async function refundOnce(
  paymentExternalKey: string,
  killbillPaymentId: string,
  transactionExternalKey: string,
  amountCents: number,
): Promise<{ killbillRefundId: string }> {
  const existing = await findPayment(paymentExternalKey);
  const succeeded = existing?.transactions.find(
    (transaction) =>
      transaction.transactionType === 'REFUND' &&
      transaction.status === 'SUCCESS' &&
      transaction.transactionExternalKey === transactionExternalKey,
  );
  if (succeeded !== undefined) {
    if (cents(succeeded.amount) !== amountCents) throw idempotencyConflict();
    return { killbillRefundId: succeeded.transactionId };
  }
  const created = await call('POST', `/1.0/kb/payments/${killbillPaymentId}/refunds`, {
    body: JSON.stringify({
      amount: dollars(amountCents),
      currency: 'USD',
      transactionExternalKey,
    }),
  });
  if (created.status !== 201) throw billingUnavailable();
  const payment = await findPayment(paymentExternalKey);
  const confirmed = payment?.transactions.find(
    (transaction) =>
      transaction.transactionExternalKey === transactionExternalKey && transaction.status === 'SUCCESS',
  );
  if (confirmed === undefined) throw billingUnavailable();
  return { killbillRefundId: confirmed.transactionId };
}

export function paymentExternalKey(contractId: string, idempotencyKey: string): string {
  return `${contractId}-pay-${idempotencyKey}`;
}

export function buyoutExternalKey(contractId: string): string {
  return `${contractId}-buyout`;
}

export function reversalTransactionKey(contractId: string, paymentId: string): string {
  return `${contractId}-reversal-${paymentId}`;
}
