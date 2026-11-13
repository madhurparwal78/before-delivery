import { config } from '../config';
import { Cadence, Decimal, toCents } from '../shared/money';

export class PaymentsUnavailable extends Error {}

const PLAN_NAMES: Record<Cadence, string> = {
  sixMonths: 'plus-six-months',
  yearly: 'plus-yearly',
};

export function cadenceOfPlan(planName: string): Cadence {
  return planName === PLAN_NAMES.yearly ? 'yearly' : 'sixMonths';
}

const CATALOG_XML = `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>2020-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>Ocotillo</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies>
    <currency>USD</currency>
  </currencies>
  <products>
    <product name="Plus">
      <category>BASE</category>
    </product>
  </products>
  <rules>
    <changePolicy>
      <changePolicyCase>
        <policy>END_OF_TERM</policy>
      </changePolicyCase>
    </changePolicy>
    <changeAlignment>
      <changeAlignmentCase>
        <alignment>START_OF_BUNDLE</alignment>
      </changeAlignmentCase>
    </changeAlignment>
    <cancelPolicy>
      <cancelPolicyCase>
        <policy>END_OF_TERM</policy>
      </cancelPolicyCase>
    </cancelPolicy>
    <createAlignment>
      <createAlignmentCase>
        <alignment>START_OF_BUNDLE</alignment>
      </createAlignmentCase>
    </createAlignment>
    <billingAlignment>
      <billingAlignmentCase>
        <alignment>ACCOUNT</alignment>
      </billingAlignmentCase>
    </billingAlignment>
    <priceList>
      <priceListCase>
        <toPriceList>DEFAULT</toPriceList>
      </priceListCase>
    </priceList>
  </rules>
  <plans>
    <plan name="plus-six-months">
      <product>Plus</product>
      <finalPhase type="EVERGREEN">
        <duration>
          <unit>UNLIMITED</unit>
        </duration>
        <recurring>
          <billingPeriod>BIANNUAL</billingPeriod>
          <recurringPrice>
            <price>
              <currency>USD</currency>
              <value>749.95</value>
            </price>
          </recurringPrice>
        </recurring>
      </finalPhase>
    </plan>
    <plan name="plus-yearly">
      <product>Plus</product>
      <finalPhase type="EVERGREEN">
        <duration>
          <unit>UNLIMITED</unit>
        </duration>
        <recurring>
          <billingPeriod>ANNUAL</billingPeriod>
          <recurringPrice>
            <price>
              <currency>USD</currency>
              <value>1274.92</value>
            </price>
          </recurringPrice>
        </recurring>
      </finalPhase>
    </plan>
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT">
      <plans>
        <plan>plus-six-months</plan>
        <plan>plus-yearly</plan>
      </plans>
    </defaultPriceList>
  </priceLists>
</catalog>`;

interface CallOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  contentType?: string;
  rawBody?: string;
  timeoutMs?: number;
  tenantHeaders?: boolean;
}

interface CallResult {
  status: number;
  location: string | null;
  json: unknown;
  text: string;
}

async function call(options: CallOptions): Promise<CallResult> {
  const headers: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(`${config.killBill.username}:${config.killBill.password}`).toString('base64')}`,
    'X-Killbill-CreatedBy': 'ocotillo-member-desk',
    Accept: 'application/json',
  };
  if (options.tenantHeaders !== false) {
    headers['X-Killbill-ApiKey'] = config.killBill.apiKey;
    headers['X-Killbill-ApiSecret'] = config.killBill.apiSecret;
  }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.rawBody !== undefined) headers['Content-Type'] = options.contentType ?? 'text/xml';
  let response: Response;
  try {
    response = await fetch(`${config.killBill.url}${options.path}`, {
      method: options.method,
      headers,
      body:
        options.rawBody !== undefined
          ? options.rawBody
          : options.body !== undefined
            ? JSON.stringify(options.body)
            : undefined,
      signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
    });
  } catch {
    throw new PaymentsUnavailable('Kill Bill unreachable');
  }
  const text = await response.text();
  if (response.status >= 500) throw new PaymentsUnavailable(`Kill Bill error ${response.status}`);
  let json: unknown = null;
  if (text !== '' && (response.headers.get('content-type') ?? '').includes('json')) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: response.status, location: response.headers.get('location'), json, text };
}

function idFromLocation(location: string | null): string {
  if (!location) throw new PaymentsUnavailable('Kill Bill gave no resource location');
  const parts = location.split('/').filter((part) => part !== '');
  return parts[parts.length - 1] as string;
}

export async function ensureTenantAndCatalog(): Promise<void> {
  const tenant = await call({
    method: 'POST',
    path: '/1.0/kb/tenants?useGlobalDefault=true',
    body: {
      apiKey: config.killBill.apiKey,
      apiSecret: config.killBill.apiSecret,
      externalKey: config.killBill.apiKey,
    },
    tenantHeaders: false,
  });
  if (tenant.status >= 400 && tenant.status !== 409) {
    throw new PaymentsUnavailable(`Kill Bill refused the tenant (${tenant.status})`);
  }
  const existing = await call({ method: 'GET', path: '/1.0/kb/catalog' });
  if (existing.status === 200 && existing.text.includes('plus-six-months')) return;
  const uploaded = await call({
    method: 'POST',
    path: '/1.0/kb/catalog/xml',
    rawBody: CATALOG_XML,
    contentType: 'text/xml',
  });
  if (uploaded.status >= 400) {
    throw new PaymentsUnavailable(`Kill Bill refused the catalog (${uploaded.status}): ${uploaded.text}`);
  }
}

export interface AccountInput {
  externalKey: string;
  name: string;
  email: string;
}

export async function findAccountId(externalKey: string): Promise<string | null> {
  const found = await call({
    method: 'GET',
    path: `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`,
  });
  if (found.status === 404) return null;
  const account = found.json as { accountId?: string } | null;
  return account?.accountId ?? null;
}

export async function createAccount(input: AccountInput): Promise<string> {
  const existing = await findAccountId(input.externalKey);
  if (existing) return existing;
  const created = await call({
    method: 'POST',
    path: '/1.0/kb/accounts',
    body: {
      externalKey: input.externalKey,
      name: input.name,
      email: input.email,
      currency: 'USD',
      timeZone: 'America/Phoenix',
    },
  });
  if (created.status >= 400) {
    throw new PaymentsUnavailable(`Kill Bill refused the account (${created.status})`);
  }
  const accountId = idFromLocation(created.location);
  await addDefaultPaymentMethod(accountId);
  return accountId;
}

async function addDefaultPaymentMethod(accountId: string): Promise<void> {
  const methods = await call({
    method: 'GET',
    path: `/1.0/kb/accounts/${accountId}/paymentMethods`,
  });
  const list = (methods.json as { pluginName?: string }[] | null) ?? [];
  if (list.length > 0) return;
  const added = await call({
    method: 'POST',
    path: `/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`,
    body: { pluginName: '__EXTERNAL_PAYMENT__', pluginInfo: {} },
  });
  if (added.status >= 400) {
    throw new PaymentsUnavailable(`Kill Bill refused the payment method (${added.status})`);
  }
}

export async function deleteAccountSubscriptions(accountId: string): Promise<void> {
  const bundles = await call({ method: 'GET', path: `/1.0/kb/accounts/${accountId}/bundles` });
  const list = (bundles.json as { subscriptions?: { subscriptionId: string }[] }[] | null) ?? [];
  for (const bundle of list) {
    for (const subscription of bundle.subscriptions ?? []) {
      await call({
        method: 'DELETE',
        path: `/1.0/kb/subscriptions/${subscription.subscriptionId}?entitlementPolicy=IMMEDIATE&billingPolicy=IMMEDIATE`,
      });
    }
  }
}

export async function createSubscription(
  accountId: string,
  cadence: Cadence,
  timeoutMs = 10000,
): Promise<string> {
  const created = await call({
    method: 'POST',
    path: '/1.0/kb/subscriptions',
    body: { accountId, planName: PLAN_NAMES[cadence] },
    timeoutMs,
  });
  if (created.status >= 400) {
    throw new PaymentsUnavailable(`Kill Bill refused the subscription (${created.status}): ${created.text}`);
  }
  return idFromLocation(created.location);
}

export interface SubscriptionReport {
  subscriptionId: string;
  planName: string;
  cadence: Cadence;
  chargedThroughDate: string | null;
  cancelledDate: string | null;
  state: string;
}

export async function readSubscription(subscriptionId: string): Promise<SubscriptionReport | null> {
  const found = await call({ method: 'GET', path: `/1.0/kb/subscriptions/${subscriptionId}` });
  if (found.status === 404) return null;
  if (found.status >= 400) {
    throw new PaymentsUnavailable(`Kill Bill refused the subscription read (${found.status})`);
  }
  const body = found.json as {
    subscriptionId: string;
    planName: string;
    chargedThroughDate?: string | null;
    cancelledDate?: string | null;
    state?: string;
  };
  return {
    subscriptionId: body.subscriptionId,
    planName: body.planName,
    cadence: cadenceOfPlan(body.planName),
    chargedThroughDate: body.chargedThroughDate ?? null,
    cancelledDate: body.cancelledDate ?? null,
    state: body.state ?? 'ACTIVE',
  };
}

export async function changePlan(subscriptionId: string, cadence: Cadence): Promise<void> {
  const changed = await call({
    method: 'PUT',
    path: `/1.0/kb/subscriptions/${subscriptionId}?billingPolicy=END_OF_TERM`,
    body: { subscriptionId, planName: PLAN_NAMES[cadence] },
  });
  if (changed.status >= 400) {
    throw new PaymentsUnavailable(`Kill Bill refused the plan change (${changed.status}): ${changed.text}`);
  }
}

export async function cancelSubscription(subscriptionId: string): Promise<void> {
  const cancelled = await call({
    method: 'DELETE',
    path: `/1.0/kb/subscriptions/${subscriptionId}?entitlementPolicy=END_OF_TERM&billingPolicy=END_OF_TERM&useRequestedDateForBilling=false`,
  });
  if (cancelled.status >= 400) {
    throw new PaymentsUnavailable(`Kill Bill refused the cancellation (${cancelled.status})`);
  }
}

export async function uncancelSubscription(subscriptionId: string): Promise<void> {
  const uncancelled = await call({
    method: 'PUT',
    path: `/1.0/kb/subscriptions/${subscriptionId}/uncancel`,
    body: {},
  });
  if (uncancelled.status >= 400 && uncancelled.status !== 400) {
    throw new PaymentsUnavailable(`Kill Bill refused the uncancellation (${uncancelled.status})`);
  }
}

export interface PaidInvoice {
  invoiceId: string;
  amountCents: number;
  currency: string;
  paidAt: string;
  items: { description: string; periodStart: string; periodEnd: string; amountCents: number }[];
}

interface InvoiceJson {
  invoiceId: string;
  amount: number | string;
  balance: number | string;
  currency: string;
  invoiceDate: string;
  items?: {
    description?: string | null;
    prettyPlanName?: string | null;
    planName?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    amount: number | string;
  }[];
}

interface InvoicePaymentJson {
  targetInvoiceId: string;
  transactions?: { status?: string; effectiveDate?: string; transactionType?: string }[];
}

export async function listPaidInvoices(accountId: string): Promise<PaidInvoice[]> {
  const list = await call({
    method: 'GET',
    path: `/1.0/kb/accounts/${accountId}/invoices`,
  });
  if (list.status >= 400) {
    throw new PaymentsUnavailable(`Kill Bill refused the invoice list (${list.status})`);
  }
  const summaries = (list.json as { invoiceId: string }[] | null) ?? [];
  const detailed: InvoiceJson[] = [];
  for (const summary of summaries) {
    const invoice = await call({
      method: 'GET',
      path: `/1.0/kb/invoices/${summary.invoiceId}?withItems=true`,
    });
    if (invoice.status >= 400) continue;
    detailed.push(invoice.json as InvoiceJson);
  }
  const payments = await call({
    method: 'GET',
    path: `/1.0/kb/accounts/${accountId}/invoicePayments`,
  });
  const paymentsByInvoice = new Map<string, string>();
  for (const payment of ((payments.json as InvoicePaymentJson[] | null) ?? [])) {
    const settled = (payment.transactions ?? []).find(
      (transaction) => transaction.status === 'SUCCESS' && transaction.transactionType !== 'REFUND',
    );
    if (settled?.effectiveDate) paymentsByInvoice.set(payment.targetInvoiceId, settled.effectiveDate);
  }
  const paid: PaidInvoice[] = [];
  for (const invoice of detailed) {
    const amount = new Decimal(String(invoice.amount));
    const balance = new Decimal(String(invoice.balance));
    if (amount.lessThanOrEqualTo(0) || !balance.isZero()) continue;
    const paidAt = paymentsByInvoice.get(invoice.invoiceId);
    if (!paidAt) continue;
    paid.push({
      invoiceId: invoice.invoiceId,
      amountCents: toCents(amount),
      currency: invoice.currency,
      paidAt: new Date(paidAt).toISOString(),
      items: (invoice.items ?? []).map((item) => ({
        description:
          item.description ?? item.prettyPlanName ?? item.planName ?? 'Plus membership',
        periodStart: item.startDate ?? invoice.invoiceDate,
        periodEnd: item.endDate ?? invoice.invoiceDate,
        amountCents: toCents(new Decimal(String(item.amount))),
      })),
    });
  }
  return paid;
}

export async function eraseAccount(accountId: string): Promise<void> {
  const updated = await call({
    method: 'PUT',
    path: `/1.0/kb/accounts/${accountId}?treatNullAsReset=false`,
    body: { accountId, name: 'Erased member', email: '', phone: '' },
  });
  if (updated.status >= 400) {
    throw new PaymentsUnavailable(`Kill Bill refused the account update (${updated.status})`);
  }
}

export async function checkReachable(): Promise<void> {
  const health = await call({ method: 'GET', path: '/1.0/healthcheck', timeoutMs: 5000 });
  if (health.status >= 400) throw new PaymentsUnavailable('Kill Bill is not healthy');
}
