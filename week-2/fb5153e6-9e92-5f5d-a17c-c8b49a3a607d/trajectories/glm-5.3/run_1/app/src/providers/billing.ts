import { config } from '../config.js';
import { guard, markService } from './availability.js';

const base = () => `${config.killbill.url}/1.0/kb`;

function headers(json: boolean, createdBy?: string): Record<string, string> {
  const auth = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64');
  const out: Record<string, string> = {
    Authorization: `Basic ${auth}`,
    'X-Killbill-ApiKey': config.killbill.apiKey,
    'X-Killbill-ApiSecret': config.killbill.apiSecret,
  };
  if (createdBy !== undefined) out['X-Killbill-CreatedBy'] = createdBy;
  if (json) out['Content-Type'] = 'application/json';
  return out;
}

async function fetchRaw<T>(
  method: string,
  path: string,
  options: { json?: unknown; xml?: string; query?: Record<string, string | undefined>; createdBy?: string } = {},
): Promise<{ status: number; body: T | null; location?: string }> {
  return guard('billing', async () => {
    const url = new URL(base() + path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    const response = await fetch(url, {
      method,
      headers: options.xml !== undefined
        ? { ...headers(false, options.createdBy), 'Content-Type': 'text/xml' }
        : options.json !== undefined
          ? headers(true, options.createdBy)
          : headers(false, options.createdBy),
      body: options.xml !== undefined
        ? options.xml
        : options.json !== undefined
          ? JSON.stringify(options.json)
          : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let body: T | null = null;
    if (text !== '') {
      try {
        body = JSON.parse(text) as T;
      } catch {
        body = null;
      }
    }
    return { status: response.status, body, location: response.headers.get('location') ?? undefined };
  });
}

async function call<T>(
  method: string,
  path: string,
  options: { json?: unknown; xml?: string; query?: Record<string, string | undefined>; createdBy?: string } = {},
): Promise<{ status: number; body: T | null; location?: string }> {
  return guard('billing', async () => {
    const url = new URL(base() + path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    const response = await fetch(url, {
      method,
      headers: options.xml !== undefined
        ? { ...headers(false, options.createdBy), 'Content-Type': 'text/xml' }
        : options.json !== undefined
          ? headers(true, options.createdBy)
          : headers(false, options.createdBy),
      body: options.xml !== undefined
        ? options.xml
        : options.json !== undefined
          ? JSON.stringify(options.json)
          : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let body: T | null = null;
    if (text !== '') {
      try {
        body = JSON.parse(text) as T;
      } catch {
        body = null;
      }
    }
    if (response.status >= 400) {
      throw new KbError(`killbill ${method} ${path} status ${response.status}: ${text.slice(0, 300)}`, response.status);
    }
    markService('billing', true);
    return { status: response.status, body, location: response.headers.get('location') ?? undefined };
  });
}

export interface KbAccount {
  accountId: string;
  externalKey?: string;
  email?: string | null;
  currency?: string;
  billCycleDayLocal?: number;
  paymentMethodId?: string | null;
}

export interface KbInvoice {
  invoiceId: string;
  invoiceNumber: string;
  status: string;
  amount: number;
  balance: number;
  items: { invoiceItemId: string; amount: number; description: string | null; planName: string | null; itemType: string | null }[];
}

export interface KbPayment {
  paymentId: string;
  purchasedAmount: number;
  refundedAmount: number;
  paymentMethodId: string;
  transactions: { transactionId: string; transactionType: string; amount: number; status: string }[];
}

export interface KbSubscription {
  subscriptionId: string;
  planName: string;
  state: string;
  billCycleDayLocal: number;
  chargedThroughDate: string | null;
  events: { eventType: string; plan: string; effectiveDate: string }[];
}

export interface KbBundle {
  bundleId: string;
  externalKey: string;
  subscriptions: KbSubscription[];
}

export class KbError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function ensureOk<T>(result: { status: number; body: T | null; location?: string }, expected: number[]): T {
  if (!expected.includes(result.status)) {
    throw new KbError(`killbill status ${result.status}`, result.status);
  }
  return result.body as T;
}

export async function pingBilling(): Promise<void> {
  const result = await call<unknown>('GET', '/tenants', { query: { apiKey: config.killbill.apiKey } });
  if (result.status >= 500) throw new Error('billing tenant lookup failed');
  markService('billing', true);
}

export async function catalogVersions(): Promise<{ effectiveDate: string }[]> {
  const result = await call<{ effectiveDate: string }[]>('GET', '/catalog');
  return ensureOk(result, [200]) ?? [];
}

export function turnstoneCatalogXml(effectiveDate: string): string {
  const plan = (name: string, product: string, price: string): string => `    <plan name="${name}">
      <product>${product}</product>
      <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
      <finalPhase type="EVERGREEN">
        <duration>
          <unit>UNLIMITED</unit>
        </duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice>
            <price>
              <currency>EUR</currency>
              <value>${price}</value>
            </price>
          </recurringPrice>
        </recurring>
      </finalPhase>
    </plan>`;
  const product = (name: string): string => `    <product name="${name}">
      <category>BASE</category>
      <available/>
    </product>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<catalog xmlns:ns2="http://www.w3.org/2001/XMLSchema-instance">
  <effectiveDate>${effectiveDate}</effectiveDate>
  <catalogName>turnstone-catalog</catalogName>
  <currencies>
    <currency>EUR</currency>
  </currencies>
  <products>
${product('Free')}
${product('Basic')}
${product('Pro')}
${product('Premium')}
  </products>
  <rules>
    <changePolicy>
      <changePolicyCase>
        <policy>IMMEDIATE</policy>
      </changePolicyCase>
    </changePolicy>
    <changeAlignment>
      <changeAlignmentCase>
        <alignment>CHANGE_OF_PLAN</alignment>
      </changeAlignmentCase>
    </changeAlignment>
    <cancelPolicy>
      <cancelPolicyCase>
        <policy>END_OF_TERM</policy>
      </cancelPolicyCase>
    </cancelPolicy>
  </rules>
  <plans>
${plan('turnstone-free-monthly', 'Free', '0.00')}
${plan('turnstone-basic-monthly', 'Basic', '9.00')}
${plan('turnstone-pro-monthly', 'Pro', '19.00')}
${plan('turnstone-premium-monthly', 'Premium', '39.00')}
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT">
      <plans>
        <plan>turnstone-free-monthly</plan>
        <plan>turnstone-basic-monthly</plan>
        <plan>turnstone-pro-monthly</plan>
        <plan>turnstone-premium-monthly</plan>
      </plans>
    </defaultPriceList>
  </priceLists>
</catalog>
`;
}

export async function uploadCatalog(effectiveDate: string): Promise<void> {
  const result = await call<unknown>('POST', '/catalog/xml', { xml: turnstoneCatalogXml(effectiveDate), createdBy: 'turnstone-studio' });
  if (result.status !== 201 && result.status !== 200) throw new KbError(`catalog upload status ${result.status}`, result.status);
}

export async function getAccountByExternalKey(externalKey: string): Promise<KbAccount | null> {
  const response = await fetchRaw<KbAccount>('GET', '/accounts', { query: { externalKey } });
  if (response.status === 404) {
    markService('billing', true);
    return null;
  }
  if (response.status !== 200) {
    throw new KbError(`killbill account lookup status ${response.status}`, response.status);
  }
  return response.body;
}

export async function createAccount(externalKey: string, email?: string): Promise<KbAccount> {
  const response = await fetchRaw<KbAccount>('POST', '/accounts', {
    json: { name: externalKey, externalKey, currency: 'EUR', email, isPaymentDelegatedToParent: false },
    createdBy: 'turnstone-studio',
  });
  if (response.status !== 201 || response.body === null) {
    const account = await getAccountByExternalKey(externalKey);
    if (account === null) {
      throw new KbError(`killbill account create status ${response.status}`, response.status);
    }
    return account;
  }
  return response.body;
}

export async function getAccount(accountId: string): Promise<KbAccount> {
  const result = await call<KbAccount>('GET', `/accounts/${accountId}`);
  return ensureOk(result, [200]);
}

export async function createExternalPaymentMethod(accountId: string, externalKey: string): Promise<void> {
  const result = await call<unknown>('POST', `/accounts/${accountId}/paymentMethods`, {
    json: { externalKey, isDefault: true, pluginName: '__EXTERNAL_PAYMENT__' },
    createdBy: 'turnstone-studio',
  });
  ensureOk(result, [201, 200]);
}

export async function listPaymentMethods(accountId: string): Promise<{ paymentMethodId: string; pluginName: string }[]> {
  const result = await call<{ paymentMethodId: string; pluginName: string }[]>('GET', `/accounts/${accountId}/paymentMethods`);
  return ensureOk(result, [200]) ?? [];
}

/** Creates one external charge on a committed invoice and returns the invoice id and item. */
export async function createExternalCharge(
  accountId: string,
  itemUuid: string,
  amountEur: string,
  description: string,
): Promise<{ invoiceId: string; invoiceItemId: string }> {
  const result = await call<{ invoiceId: string; invoiceItemId: string }>('POST', `/invoices/charges/${accountId}`, {
    json: [
      {
        invoiceItemId: itemUuid,
        accountId,
        description,
        amount: Number(amountEur),
        currency: 'EUR',
        itemType: 'EXTERNAL_CHARGE',
      },
    ],
    query: { autoCommit: 'true' },
    createdBy: 'turnstone-studio',
  });
  const body = ensureOk(result, [200]);
  const first = Array.isArray(body) ? body[0] : body;
  return { invoiceId: first.invoiceId, invoiceItemId: first.invoiceItemId };
}

export async function getInvoice(invoiceId: string): Promise<KbInvoice> {
  const result = await call<KbInvoice>('GET', `/invoices/${invoiceId}`);
  return ensureOk(result, [200]);
}

export async function listInvoiceIds(accountId: string): Promise<string[]> {
  const result = await call<{ invoiceId: string }[]>('GET', `/accounts/${accountId}/invoices`);
  const invoices = ensureOk(result, [200]) ?? [];
  return invoices.map(invoice => invoice.invoiceId);
}

export async function createPurchasePayment(
  accountId: string,
  paymentMethodId: string,
  amountEur: string,
  externalKey: string,
): Promise<void> {
  const result = await call<unknown>('POST', `/accounts/${accountId}/payments`, {
    json: {
      transactionType: 'PURCHASE',
      amount: Number(amountEur),
      currency: 'EUR',
      paymentExternalKey: externalKey,
      transactionExternalKey: `${externalKey}-tx`,
    },
    query: { paymentMethodId },
    createdBy: 'turnstone-studio',
  });
  ensureOk(result, [201, 200]);
}

export async function listPayments(accountId: string): Promise<KbPayment[]> {
  const result = await call<KbPayment[]>('GET', `/accounts/${accountId}/payments`);
  return ensureOk(result, [200]) ?? [];
}

export async function createRefund(
  paymentId: string,
  amountEur: string,
  externalKey: string,
): Promise<void> {
  const result = await call<unknown>('POST', `/payments/${paymentId}/refunds`, {
    json: { amount: Number(amountEur), currency: 'EUR', transactionExternalKey: externalKey },
    createdBy: 'turnstone-studio',
  });
  ensureOk(result, [201]);
}

export async function getPayment(paymentId: string): Promise<KbPayment> {
  const result = await call<KbPayment>('GET', `/payments/${paymentId}`);
  return ensureOk(result, [200]);
}

export async function createSubscription(
  accountId: string,
  bundleExternalKey: string,
  planName: string,
): Promise<void> {
  const result = await call<unknown>('POST', '/subscriptions', {
    json: { accountId, externalKey: `${bundleExternalKey}-sub`, bundleExternalKey, planName },
    createdBy: 'turnstone-studio',
  });
  ensureOk(result, [201, 200]);
}

export async function getBundles(accountId: string): Promise<KbBundle[]> {
  const result = await call<KbBundle[]>('GET', `/accounts/${accountId}/bundles`);
  return ensureOk(result, [200]) ?? [];
}

export async function changePlan(
  subscriptionId: string,
  planName: string,
  policy: 'IMMEDIATE' | 'END_OF_TERM',
): Promise<void> {
  const result = await call<unknown>('PUT', `/subscriptions/${subscriptionId}`, {
    json: { planName },
    query: { billingPolicy: policy },
    createdBy: 'turnstone-studio',
  });
  ensureOk(result, [200, 201, 204]);
}

/** Cents conversion for Kill Bill's decimal euro amounts, half up. */
export function centsToEurString(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  return `${negative ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function eurToCents(amount: number): number {
  const text = amount.toFixed(2);
  const [whole, part = '0'] = text.split('.');
  const cents = Number(whole) * 100 + Number((part + '00').slice(0, 2));
  return Math.round(cents);
}
