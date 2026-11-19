import { config } from '../config.js';
import { errors } from '../errors.js';
import { planById, plans } from '../../shared/plans.js';
import type { PlanId } from '../../shared/types.js';

const headers = {
  'X-Killbill-ApiKey': config.killbill.apiKey,
  'X-Killbill-ApiSecret': config.killbill.apiSecret,
  'X-Killbill-CreatedBy': 'rushes',
  Authorization: `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64')}`,
};

const readTimeoutMs = 8_000;
const writeTimeoutMs = 30_000;

interface CallOptions {
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  json?: unknown;
  xml?: string;
  /** Subscription changes run to completion, so they wait longer than a read. */
  timeoutMs?: number;
}

interface CallResult {
  status: number;
  location: string | null;
  text: string;
}

async function call(options: CallOptions): Promise<CallResult> {
  const requestHeaders: Record<string, string> = { ...headers };
  let body: string | undefined;
  if (options.json !== undefined) {
    requestHeaders['Content-Type'] = 'application/json';
    body = JSON.stringify(options.json);
  } else if (options.xml !== undefined) {
    requestHeaders['Content-Type'] = 'text/xml';
    body = options.xml;
  }
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}${options.path}`, {
      method: options.method,
      headers: requestHeaders,
      body,
      signal: AbortSignal.timeout(options.timeoutMs ?? readTimeoutMs),
    });
  } catch {
    throw errors.billingUnavailable();
  }
  if (response.status >= 500) {
    throw errors.billingUnavailable();
  }
  return {
    status: response.status,
    location: response.headers.get('location'),
    text: await response.text(),
  };
}

function parseJson<T>(result: CallResult): T {
  try {
    return JSON.parse(result.text) as T;
  } catch {
    throw errors.billingUnavailable();
  }
}

function catalogXml(): string {
  const planXml = plans
    .map(
      (plan) => `    <plan name="${plan.plan}">
      <product>RushesSeats</product>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice><price><currency>USD</currency><value>${plan.monthlyPrice}</value></price></recurringPrice>
        </recurring>
      </finalPhase>
    </plan>`,
    )
    .join('\n');
  const priceListPlans = plans.map((plan) => `        <plan>${plan.plan}</plan>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <effectiveDate>2024-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>Rushes</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies>
    <currency>USD</currency>
  </currencies>
  <products>
    <product name="RushesSeats">
      <category>BASE</category>
    </product>
  </products>
  <rules>
    <changePolicy>
      <changePolicyCase><policy>IMMEDIATE</policy></changePolicyCase>
    </changePolicy>
    <changeAlignment>
      <changeAlignmentCase><alignment>START_OF_SUBSCRIPTION</alignment></changeAlignmentCase>
    </changeAlignment>
    <cancelPolicy>
      <cancelPolicyCase><policy>IMMEDIATE</policy></cancelPolicyCase>
    </cancelPolicy>
    <createAlignment>
      <createAlignmentCase><alignment>START_OF_BUNDLE</alignment></createAlignmentCase>
    </createAlignment>
    <billingAlignment>
      <billingAlignmentCase><alignment>ACCOUNT</alignment></billingAlignmentCase>
    </billingAlignment>
    <priceList>
      <priceListCase><toPriceList>DEFAULT</toPriceList></priceListCase>
    </priceList>
  </rules>
  <plans>
${planXml}
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT">
      <plans>
${priceListPlans}
      </plans>
    </defaultPriceList>
  </priceLists>
</catalog>
`;
}

export async function ensureCatalog(): Promise<void> {
  const current = await call({ method: 'GET', path: '/1.0/kb/catalog/xml' });
  if (current.status === 200 && plans.every((plan) => current.text.includes(`name="${plan.plan}"`))) {
    return;
  }
  const uploaded = await call({
    method: 'POST',
    path: '/1.0/kb/catalog/xml',
    xml: catalogXml(),
    timeoutMs: writeTimeoutMs,
  });
  if (uploaded.status >= 400) {
    throw errors.billingUnavailable();
  }
}

interface KbAccount {
  accountId: string;
}

interface KbSubscription {
  subscriptionId: string;
  planName: string;
  state: string;
}

interface KbBundle {
  bundleId: string;
  externalKey: string;
  subscriptions: KbSubscription[];
}

function accountKey(slug: string): string {
  return `rushes-ws-${slug}`;
}

function bundleKey(slug: string): string {
  return `rushes-seats-${slug}`;
}

async function findAccount(slug: string): Promise<string | null> {
  const result = await call({
    method: 'GET',
    path: `/1.0/kb/accounts?externalKey=${encodeURIComponent(accountKey(slug))}`,
  });
  if (result.status === 404) {
    return null;
  }
  if (result.status >= 400) {
    throw errors.billingUnavailable();
  }
  return parseJson<KbAccount>(result).accountId;
}

async function createAccount(slug: string, name: string): Promise<string> {
  const result = await call({
    method: 'POST',
    path: '/1.0/kb/accounts',
    json: { name, externalKey: accountKey(slug), currency: 'USD' },
    timeoutMs: writeTimeoutMs,
  });
  if (result.status >= 400 || result.location === null) {
    throw errors.billingUnavailable();
  }
  return result.location.slice(result.location.lastIndexOf('/') + 1);
}

async function findActiveSubscription(slug: string): Promise<KbSubscription | null> {
  const result = await call({
    method: 'GET',
    path: `/1.0/kb/bundles?externalKey=${encodeURIComponent(bundleKey(slug))}`,
  });
  if (result.status === 404) {
    return null;
  }
  if (result.status >= 400) {
    return null;
  }
  const bundles = parseJson<KbBundle[]>(result);
  for (const bundle of bundles) {
    const active = bundle.subscriptions.find((subscription) => subscription.state === 'ACTIVE');
    if (active) {
      return active;
    }
  }
  return null;
}

async function createSubscription(accountId: string, slug: string, plan: PlanId): Promise<void> {
  const result = await call({
    method: 'POST',
    path: '/1.0/kb/subscriptions?callCompletion=true&callTimeoutSec=20',
    json: { accountId, bundleExternalKey: bundleKey(slug), planName: plan },
    timeoutMs: writeTimeoutMs,
  });
  if (result.status >= 400) {
    throw errors.billingUnavailable();
  }
}

async function changeSubscriptionPlan(subscriptionId: string, plan: PlanId): Promise<void> {
  const result = await call({
    method: 'PUT',
    path: `/1.0/kb/subscriptions/${subscriptionId}?callCompletion=true&callTimeoutSec=20&policy=IMMEDIATE`,
    json: { planName: plan },
    timeoutMs: writeTimeoutMs,
  });
  if (result.status >= 400) {
    throw errors.billingUnavailable();
  }
}

/** Creates the workspace's billing account and subscription, and sets a freshly seeded one to its plan. */
export async function ensureWorkspaceSubscription(slug: string, name: string, seededPlan: PlanId): Promise<void> {
  const accountId = (await findAccount(slug)) ?? (await createAccount(slug, name));
  const existing = await findActiveSubscription(slug);
  if (existing === null) {
    await createSubscription(accountId, slug, seededPlan);
    return;
  }
  if (existing.planName !== seededPlan) {
    await changeSubscriptionPlan(existing.subscriptionId, seededPlan);
  }
}

/** Reads the plan of the workspace's active subscription. Kill Bill is the source of truth. */
export async function readSubscriptionPlan(slug: string): Promise<PlanId | null> {
  const active = await findActiveSubscription(slug);
  if (active === null) {
    return null;
  }
  return planById(active.planName)?.plan ?? null;
}

export async function upgradeSubscriptionPlan(slug: string, plan: PlanId): Promise<void> {
  const active = await findActiveSubscription(slug);
  if (active === null) {
    throw errors.billingUnavailable();
  }
  await changeSubscriptionPlan(active.subscriptionId, plan);
}
