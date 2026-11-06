import { config } from '../config';
import { plans } from '../domain/seeddata';

export class BillingUnreachable extends Error {}

const authorization = `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64')}`;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: authorization,
    'X-Killbill-ApiKey': config.killbill.apiKey,
    'X-Killbill-ApiSecret': config.killbill.apiSecret,
    'X-Killbill-CreatedBy': 'farshore',
    ...extra,
  };
}

interface KillBillResponse {
  status: number;
  location: string | null;
  text: string;
}

async function call(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<KillBillResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${config.killbill.url}${path}`, {
      method,
      headers: headers(body === undefined ? extraHeaders : { 'Content-Type': 'application/json', ...extraHeaders }),
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      signal: controller.signal,
    });
    return { status: response.status, location: response.headers.get('location'), text: await response.text() };
  } catch (error) {
    throw new BillingUnreachable((error as Error).message);
  } finally {
    clearTimeout(timer);
  }
}

function usageBlocks(): string {
  return ['storage-gb-hours', 'egress-gb', 'request-units']
    .map(
      (unit) => `<tieredBlock><unit>${unit}</unit><size>1</size>
            <prices><price><currency>USD</currency><value>0.001</value></price></prices>
            <max>1000000000</max></tieredBlock>`,
    )
    .join('\n');
}

function planXml(planName: string, productName: string, price: string): string {
  return `<plan name="${planName}">
      <product>${productName}</product>
      <initialPhases/>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice><price><currency>USD</currency><value>${price}</value></price></recurringPrice>
        </recurring>
        <usages>
          <usage name="${planName}-usage" billingMode="IN_ARREAR" usageType="CONSUMABLE">
            <billingPeriod>MONTHLY</billingPeriod>
            <tiers><tier><blocks>
              ${usageBlocks()}
            </blocks></tier></tiers>
          </usage>
        </usages>
      </finalPhase>
    </plan>`;
}

export function catalogXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>2024-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>Farshore</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies><currency>USD</currency></currencies>
  <units>
    <unit name="storage-gb-hours"/>
    <unit name="egress-gb"/>
    <unit name="request-units"/>
  </units>
  <products>
    <product name="FarshoreSandbox"><category>BASE</category></product>
    <product name="FarshoreIndie"><category>BASE</category></product>
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
    ${planXml('farshore-sandbox-monthly', 'FarshoreSandbox', '0.00')}
    ${planXml('farshore-indie-monthly', 'FarshoreIndie', '19.00')}
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT">
      <plans>
        <plan>farshore-sandbox-monthly</plan>
        <plan>farshore-indie-monthly</plan>
      </plans>
    </defaultPriceList>
  </priceLists>
</catalog>`;
}

export async function ensureTenant(): Promise<void> {
  const existing = await call('GET', '/1.0/kb/tenants?apiKey=' + encodeURIComponent(config.killbill.apiKey));
  if (existing.status === 200) return;
  await call('POST', '/1.0/kb/tenants', {
    apiKey: config.killbill.apiKey,
    apiSecret: config.killbill.apiSecret,
    externalKey: 'farshore',
  });
}

/** Uploads the Farshore catalog when the tenant has none. */
export async function ensureCatalog(): Promise<void> {
  const existing = await call('GET', '/1.0/kb/catalog/xml');
  if (existing.status === 200 && existing.text.includes('farshore-indie-monthly')) return;
  await call('POST', '/1.0/kb/catalog/xml', catalogXml(), { 'Content-Type': 'text/xml' });
}

async function findAccount(externalKey: string): Promise<string | null> {
  const response = await call('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  if (response.status !== 200) return null;
  const parsed = JSON.parse(response.text) as { accountId?: string };
  return parsed.accountId ?? null;
}

async function findSubscription(externalKey: string): Promise<string | null> {
  const response = await call('GET', `/1.0/kb/subscriptions?externalKey=${encodeURIComponent(externalKey)}`);
  if (response.status !== 200) return null;
  const parsed = JSON.parse(response.text) as { subscriptionId?: string };
  return parsed.subscriptionId ?? null;
}

export interface Subscription {
  accountId: string;
  subscriptionId: string;
}

/** One USD account and one subscription on the workspace's plan. */
export async function ensureSubscription(slug: string, name: string, planId: string): Promise<Subscription> {
  const accountKey = `farshore-${slug}`;
  const subscriptionKey = `farshore-${slug}-plan`;
  let accountId = await findAccount(accountKey);
  if (!accountId) {
    const created = await call('POST', '/1.0/kb/accounts', { name, currency: 'USD', externalKey: accountKey });
    if (created.status >= 400 && created.status !== 409) throw new BillingUnreachable(`account ${created.status} ${created.text}`);
    accountId = await findAccount(accountKey);
    if (!accountId) throw new BillingUnreachable('account not created');
  }
  let subscriptionId = await findSubscription(subscriptionKey);
  if (!subscriptionId) {
    const plan = plans.find((item) => item.id === planId);
    const created = await call('POST', '/1.0/kb/subscriptions', {
      accountId,
      externalKey: subscriptionKey,
      planName: plan ? plan.killbillPlan : 'farshore-indie-monthly',
    });
    if (created.status >= 400) throw new BillingUnreachable(`subscription ${created.status} ${created.text}`);
    subscriptionId = await findSubscription(subscriptionKey);
    if (!subscriptionId) throw new BillingUnreachable('subscription not created');
  }
  return { accountId, subscriptionId };
}

export interface UsagePost {
  subscriptionId: string;
  trackingId: string;
  unit: string;
  recordDate: string;
  amount: string;
}

/** Posts one usage record, keyed by its tracking ID so repeats never double-count. */
export async function postUsage(post: UsagePost): Promise<'posted' | 'already-recorded'> {
  const response = await call('POST', '/1.0/kb/usages', {
    subscriptionId: post.subscriptionId,
    trackingId: post.trackingId,
    unitUsageRecords: [
      {
        unitType: post.unit,
        usageRecords: [{ recordDate: post.recordDate, amount: Number(post.amount) }],
      },
    ],
  });
  if (response.status === 201 || response.status === 200) return 'posted';
  if (response.status === 409 || /tracking/i.test(response.text)) return 'already-recorded';
  throw new BillingUnreachable(`usage ${response.status} ${response.text.slice(0, 200)}`);
}
