import { config } from '../config.js';
import { ProviderRefused, providerFetch, providerJson, reachable } from './http.js';
import type { Plan } from '../domain/types.js';

const PROVIDER = 'killbill';
const base = `${config.killbill.url}/1.0/kb`;
const EXTERNAL_PAYMENT_PLUGIN = '__EXTERNAL_PAYMENT__';

export const PLAN_NAMES: Record<Plan, string> = {
  sandbox: 'sandbox-monthly',
  builder: 'builder-monthly',
  desk: 'desk-monthly',
};

export const CLEAR_OVERDUE_STATE = '__KILLBILL__CLEAR__OVERDUE_STATE__';
export const WARNING_OVERDUE_STATE = 'WARNING';
export const DOWNGRADED_OVERDUE_STATE = 'DOWNGRADED';

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64')}`,
    'X-Killbill-ApiKey': config.killbill.apiKey,
    'X-Killbill-ApiSecret': config.killbill.apiSecret,
    'X-Killbill-CreatedBy': 'plumtide-venue',
    ...extra,
  };
}

async function get<T>(path: string): Promise<T> {
  return providerJson<T>(PROVIDER, `${base}${path}`, { headers: headers({ accept: 'application/json' }) });
}

async function post(
  path: string,
  body: unknown,
  contentType = 'application/json',
): Promise<{ status: number; text: string; location: string | null }> {
  const response = await providerFetch(PROVIDER, `${base}${path}`, {
    method: 'POST',
    headers: headers({ 'content-type': contentType, accept: 'application/json' }),
    body: typeof body === 'string' ? body : JSON.stringify(body),
    timeoutMs: 30_000,
  });
  return { status: response.status, text: response.text, location: response.headers.get('location') };
}

function idFromLocation(location: string | null): string | null {
  if (location === null) return null;
  const parts = location.replace(/\/$/, '').split('/');
  return parts[parts.length - 1] ?? null;
}

function expectOk(result: { status: number; text: string }, path: string): void {
  if (result.status >= 400) throw new ProviderRefused(PROVIDER, result.status, `${path}: ${result.text}`);
}

interface KillBillAccount {
  accountId: string;
  externalKey: string;
  paymentMethodId: string | null;
}

/** An account's id never changes once created, so it is looked up only once per process. */
const accountIds = new Map<string, string>();

export async function ensureAccount(
  externalKey: string,
  name: string,
  email: string,
  cardLast4: string | null,
): Promise<string> {
  const cached = accountIds.get(externalKey);
  if (cached !== undefined) return cached;

  const existing = await providerFetch(
    PROVIDER,
    `${base}/accounts?externalKey=${encodeURIComponent(externalKey)}`,
    { headers: headers({ accept: 'application/json' }) },
  );
  let accountId: string | null = null;
  if (existing.status === 200 && existing.text.length > 0) {
    accountId = (JSON.parse(existing.text) as KillBillAccount).accountId;
  } else if (existing.status !== 404) {
    throw new ProviderRefused(PROVIDER, existing.status, existing.text);
  }

  if (accountId === null) {
    const created = await post('/accounts', { name, email, currency: 'USD', externalKey });
    expectOk(created, 'create account');
    accountId = idFromLocation(created.location);
    if (accountId === null) throw new ProviderRefused(PROVIDER, 500, 'account id missing');
  }

  const account = await get<KillBillAccount>(`/accounts/${accountId}`);
  accountIds.set(externalKey, accountId);
  if (account.paymentMethodId === null) {
    const method = await post(
      `/accounts/${accountId}/paymentMethods?isDefault=true`,
      {
        pluginName: EXTERNAL_PAYMENT_PLUGIN,
        pluginInfo: { properties: cardLast4 === null ? [] : [{ key: 'last4', value: cardLast4 }] },
      },
    );
    expectOk(method, 'create payment method');
  }
  return accountId;
}

interface KillBillTransaction {
  transactionId: string;
  transactionExternalKey: string;
  transactionType: string;
  status: string;
  amount: number;
}

interface KillBillPayment {
  paymentId: string;
  paymentExternalKey: string;
  transactions: KillBillTransaction[];
}

async function paymentByExternalKey(externalKey: string): Promise<KillBillPayment | null> {
  const response = await providerFetch(
    PROVIDER,
    `${base}/payments?externalKey=${encodeURIComponent(externalKey)}&withPluginInfo=false`,
    { headers: headers({ accept: 'application/json' }) },
  );
  if (response.status === 404) return null;
  if (response.status >= 400) throw new ProviderRefused(PROVIDER, response.status, response.text);
  return JSON.parse(response.text) as KillBillPayment;
}

const dollars = (cents: number): number => Number.parseFloat((cents / 100).toFixed(2));

export interface PurchaseResult {
  paymentId: string;
  succeeded: boolean;
}

/** A deposit is a PURCHASE on the depositor's own account; a replay reuses the same keys. */
export async function purchase(
  accountId: string,
  externalKey: string,
  amountCents: number,
  cardLast4: string,
): Promise<PurchaseResult> {
  const result = await post(`/accounts/${accountId}/payments?controlPluginName=`, {
    transactionType: 'PURCHASE',
    amount: dollars(amountCents),
    currency: 'USD',
    paymentExternalKey: externalKey,
    transactionExternalKey: externalKey,
    properties: [{ key: 'last4', value: cardLast4 }],
  });
  if (result.status >= 500) throw new ProviderRefused(PROVIDER, result.status, result.text);

  const payment = await paymentByExternalKey(externalKey);
  if (payment === null) return { paymentId: '', succeeded: false };
  const purchases = payment.transactions.filter((item) => item.transactionType === 'PURCHASE');
  return {
    paymentId: payment.paymentId,
    succeeded: purchases.some((item) => item.status === 'SUCCESS'),
  };
}

export interface RefundResult {
  transactionId: string;
  succeeded: boolean;
}

export async function refund(
  paymentId: string,
  externalKey: string,
  amountCents: number,
): Promise<RefundResult> {
  const result = await post(`/payments/${paymentId}/refunds`, {
    amount: dollars(amountCents),
    currency: 'USD',
    transactionExternalKey: externalKey,
  });
  if (result.status >= 500) throw new ProviderRefused(PROVIDER, result.status, result.text);
  const payment = await providerJson<KillBillPayment>(
    PROVIDER,
    `${base}/payments/${paymentId}?withPluginInfo=false`,
    { headers: headers({ accept: 'application/json' }) },
  );
  const transaction = payment.transactions.find((item) => item.transactionExternalKey === externalKey);
  return {
    transactionId: transaction?.transactionId ?? '',
    succeeded: transaction?.status === 'SUCCESS',
  };
}

export interface InvoiceItem {
  description: string;
  amount_cents: number;
  start_date: string | null;
  end_date: string | null;
}

export interface Invoice {
  id: string;
  number: string;
  invoice_date: string;
  amount_cents: number;
  balance_cents: number;
  items: InvoiceItem[];
}

interface KillBillInvoice {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  amount: number;
  balance: number;
  items: { description: string; amount: number; startDate: string | null; endDate: string | null }[];
}

const cents = (amount: number): number => Math.round(amount * 100);

export async function invoices(accountId: string): Promise<Invoice[]> {
  const rows = await get<KillBillInvoice[]>(
    `/accounts/${accountId}/invoices?withItems=true&includeInvoiceComponents=true`,
  );
  return rows.map((row) => ({
    id: row.invoiceId,
    number: row.invoiceNumber,
    invoice_date: row.invoiceDate,
    amount_cents: cents(row.amount),
    balance_cents: cents(row.balance),
    items: (row.items ?? []).map((item) => ({
      description: item.description,
      amount_cents: cents(item.amount),
      start_date: item.startDate,
      end_date: item.endDate,
    })),
  }));
}

interface OverdueStateResponse {
  name: string;
  isClearState: boolean;
}

interface OverdueConfigState {
  name: string;
  unpaidInvoicesAtLeast: number;
}

let overdueStates: OverdueConfigState[] | null = null;

/** Reads Kill Bill's own overdue configuration, most severe state first. */
async function overdueConfiguration(): Promise<OverdueConfigState[]> {
  if (overdueStates !== null) return overdueStates;
  const response = await providerFetch(PROVIDER, `${base}/overdue/xml`, { headers: headers() });
  if (response.status >= 400) throw new ProviderRefused(PROVIDER, response.status, response.text);
  const states: OverdueConfigState[] = [];
  const blocks = response.text.matchAll(/<state name="([^"]+)">([\s\S]*?)<\/state>/g);
  for (const block of blocks) {
    const name = block[1] as string;
    const threshold = /<numberOfUnpaidInvoicesEqualsOrExceeds>(\d+)</.exec(block[2] as string);
    if (threshold === null) continue;
    states.push({ name, unpaidInvoicesAtLeast: Number.parseInt(threshold[1] as string, 10) });
  }
  states.sort((left, right) => right.unpaidInvoicesAtLeast - left.unpaidInvoicesAtLeast);
  overdueStates = states;
  return states;
}

/**
 * Kill Bill's overdue state for the account. Kill Bill persists the state its notification queue
 * last applied, so the state Kill Bill's own configuration gives for its current unpaid invoices
 * is taken whenever it is the more severe of the two.
 */
export async function overdueState(accountId: string): Promise<{ name: string; unpaidInvoices: number }> {
  const [persisted, configured, accountInvoices] = await Promise.all([
    get<OverdueStateResponse>(`/accounts/${accountId}/overdue`),
    overdueConfiguration(),
    invoices(accountId),
  ]);
  const unpaidInvoices = accountInvoices.filter((invoice) => invoice.balance_cents > 0).length;
  const implied = configured.find((state) => unpaidInvoices >= state.unpaidInvoicesAtLeast);
  const severity = (name: string): number =>
    name === DOWNGRADED_OVERDUE_STATE ? 2 : name === WARNING_OVERDUE_STATE ? 1 : 0;
  const persistedName = persisted.isClearState ? CLEAR_OVERDUE_STATE : persisted.name;
  const impliedName = implied?.name ?? CLEAR_OVERDUE_STATE;
  return {
    name: severity(impliedName) >= severity(persistedName) ? impliedName : persistedName,
    unpaidInvoices,
  };
}

export interface Subscription {
  subscriptionId: string;
  planName: string;
  chargedThroughDate: string | null;
  state: string;
}

interface KillBillBundle {
  externalKey: string;
  subscriptions: Subscription[];
}

export async function activeSubscription(
  accountId: string,
  bundleExternalKey: string,
): Promise<Subscription | null> {
  const bundles = await get<KillBillBundle[]>(`/accounts/${accountId}/bundles`);
  const bundle = bundles.find((item) => item.externalKey === bundleExternalKey);
  return bundle?.subscriptions.find((item) => item.state !== 'CANCELLED') ?? null;
}

export async function createSubscription(
  accountId: string,
  bundleExternalKey: string,
  plan: Plan,
): Promise<Subscription> {
  const result = await post('/subscriptions?callCompletion=true&callTimeoutSec=20', {
    accountId,
    bundleExternalKey,
    planName: PLAN_NAMES[plan],
  });
  expectOk(result, 'create subscription');
  const subscription = await activeSubscription(accountId, bundleExternalKey);
  if (subscription === null) throw new ProviderRefused(PROVIDER, 500, 'subscription missing after create');
  return subscription;
}

export async function changeSubscriptionPlan(
  subscriptionId: string,
  plan: Plan,
  policy: 'IMMEDIATE' | 'END_OF_TERM',
): Promise<void> {
  const result = await providerFetch(
    PROVIDER,
    `${base}/subscriptions/${subscriptionId}?billingPolicy=${policy}&callCompletion=true&callTimeoutSec=20`,
    {
      method: 'PUT',
      headers: headers({ 'content-type': 'application/json', accept: 'application/json' }),
      body: JSON.stringify({ planName: PLAN_NAMES[plan] }),
      timeoutMs: 30_000,
    },
  );
  expectOk(result, 'change plan');
}

export async function subscription(subscriptionId: string): Promise<Subscription> {
  return get<Subscription>(`/subscriptions/${subscriptionId}`);
}

/** Pays every unpaid invoice with the account's default payment method. */
export async function payOutstanding(accountId: string): Promise<number> {
  const unpaid = (await invoices(accountId)).filter((invoice) => invoice.balance_cents > 0);
  for (const invoice of unpaid) {
    const result = await post(`/invoices/${invoice.id}/payments`, {
      accountId,
      targetInvoiceId: invoice.id,
      purchasedAmount: dollars(invoice.balance_cents),
    });
    expectOk(result, 'pay invoice');
  }
  return unpaid.length;
}

const CATALOG_XML = `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>2020-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>PlumtideVenue</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies><currency>USD</currency></currencies>
  <products><product name="BuilderApi"><category>BASE</category></product></products>
  <rules>
    <changePolicy><changePolicyCase><policy>IMMEDIATE</policy></changePolicyCase></changePolicy>
    <changeAlignment><changeAlignmentCase><alignment>START_OF_SUBSCRIPTION</alignment></changeAlignmentCase></changeAlignment>
    <cancelPolicy><cancelPolicyCase><policy>END_OF_TERM</policy></cancelPolicyCase></cancelPolicy>
    <createAlignment><createAlignmentCase><alignment>START_OF_BUNDLE</alignment></createAlignmentCase></createAlignment>
    <billingAlignment><billingAlignmentCase><alignment>ACCOUNT</alignment></billingAlignmentCase></billingAlignment>
    <priceList><priceListCase><toPriceList>DEFAULT</toPriceList></priceListCase></priceList>
  </rules>
  <plans>
    <plan name="sandbox-monthly">
      <product>BuilderApi</product>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <recurring><billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice><price><currency>USD</currency><value>0.00</value></price></recurringPrice>
        </recurring>
      </finalPhase>
    </plan>
    <plan name="builder-monthly">
      <product>BuilderApi</product>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <recurring><billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice><price><currency>USD</currency><value>49.00</value></price></recurringPrice>
        </recurring>
      </finalPhase>
    </plan>
    <plan name="desk-monthly">
      <product>BuilderApi</product>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <recurring><billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice><price><currency>USD</currency><value>249.00</value></price></recurringPrice>
        </recurring>
      </finalPhase>
    </plan>
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT">
      <plans><plan>sandbox-monthly</plan><plan>builder-monthly</plan><plan>desk-monthly</plan></plans>
    </defaultPriceList>
  </priceLists>
</catalog>`;

const OVERDUE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<overdueConfig>
  <accountOverdueStates>
    <initialReevaluationInterval><unit>DAYS</unit><number>1</number></initialReevaluationInterval>
    <state name="DOWNGRADED">
      <condition><numberOfUnpaidInvoicesEqualsOrExceeds>2</numberOfUnpaidInvoicesEqualsOrExceeds></condition>
      <externalMessage>Plan downgraded to Sandbox until the outstanding invoice is paid</externalMessage>
      <blockChanges>true</blockChanges>
      <disableEntitlementAndChangesBlocked>false</disableEntitlementAndChangesBlocked>
      <subscriptionCancellationPolicy>NONE</subscriptionCancellationPolicy>
    </state>
    <state name="WARNING">
      <condition><numberOfUnpaidInvoicesEqualsOrExceeds>1</numberOfUnpaidInvoicesEqualsOrExceeds></condition>
      <externalMessage>Last plan payment failed</externalMessage>
      <blockChanges>false</blockChanges>
      <disableEntitlementAndChangesBlocked>false</disableEntitlementAndChangesBlocked>
      <subscriptionCancellationPolicy>NONE</subscriptionCancellationPolicy>
    </state>
  </accountOverdueStates>
</overdueConfig>`;

/** Uploads the catalog and overdue configuration only when the tenant lacks them. */
export async function ensureTenantConfiguration(): Promise<void> {
  const catalog = await providerFetch(PROVIDER, `${base}/catalog`, {
    headers: headers({ accept: 'application/json' }),
  });
  const hasPlans = catalog.status === 200 && catalog.text.includes('builder-monthly');
  if (!hasPlans) expectOk(await post('/catalog/xml', CATALOG_XML, 'text/xml'), 'upload catalog');

  const overdue = await providerFetch(PROVIDER, `${base}/overdue/xml`, { headers: headers() });
  const hasStates = overdue.status === 200 && overdue.text.includes('DOWNGRADED');
  if (!hasStates) {
    expectOk(await post('/overdue/xml', OVERDUE_XML, 'text/xml'), 'upload overdue config');
    overdueStates = null;
  }
}

export async function up(): Promise<boolean> {
  return reachable(PROVIDER, `${config.killbill.url}/1.0/healthcheck`);
}
