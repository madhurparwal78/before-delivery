import { config } from '../config.js';

const TIMEOUT_MS = 5000;
const PLAN_NAME = 'daybook-seat-monthly';
const CATALOG_XML = `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>2020-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>Daybook</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies>
    <currency>USD</currency>
  </currencies>
  <products>
    <product name="Daybook">
      <category>BASE</category>
    </product>
  </products>
  <rules>
    <changePolicy>
      <changePolicyCase>
        <policy>IMMEDIATE</policy>
      </changePolicyCase>
    </changePolicy>
    <changeAlignment>
      <changeAlignmentCase>
        <alignment>START_OF_BUNDLE</alignment>
      </changeAlignmentCase>
    </changeAlignment>
    <cancelPolicy>
      <cancelPolicyCase>
        <policy>IMMEDIATE</policy>
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
    <plan name="${PLAN_NAME}">
      <product>Daybook</product>
      <initialPhases>
        <phase type="TRIAL">
          <duration>
            <unit>DAYS</unit>
            <number>14</number>
          </duration>
          <fixed>
            <fixedPrice/>
          </fixed>
        </phase>
      </initialPhases>
      <finalPhase type="EVERGREEN">
        <duration>
          <unit>UNLIMITED</unit>
          <number>-1</number>
        </duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice>
            <price>
              <currency>USD</currency>
              <value>12.00</value>
            </price>
          </recurringPrice>
        </recurring>
      </finalPhase>
    </plan>
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT">
      <plans>
        <plan>${PLAN_NAME}</plan>
      </plans>
    </defaultPriceList>
  </priceLists>
</catalog>`;

export class BillingUnavailable extends Error {
  constructor(detail: string) {
    super(`Kill Bill is unreachable: ${detail}`);
  }
}

interface KillBillResponse {
  status: number;
  location: string | null;
  text: string;
}

function headers(contentType?: string): Record<string, string> {
  const base: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64')}`,
    'X-Killbill-ApiKey': config.killbill.apiKey,
    'X-Killbill-ApiSecret': config.killbill.apiSecret,
    'X-Killbill-CreatedBy': 'tidemark-daybook',
    Accept: 'application/json',
  };
  if (contentType) base['Content-Type'] = contentType;
  return base;
}

async function call(
  method: string,
  path: string,
  body?: { contentType: string; payload: string },
): Promise<KillBillResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${config.killbill.url}${path}`, {
      method,
      headers: headers(body?.contentType),
      body: body?.payload,
      signal: controller.signal,
    });
    return {
      status: response.status,
      location: response.headers.get('location'),
      text: await response.text(),
    };
  } catch (error) {
    throw new BillingUnavailable(error instanceof Error ? error.message : 'unknown');
  } finally {
    clearTimeout(timer);
  }
}

function idFromLocation(location: string | null): string | null {
  if (!location) return null;
  const id = location.split('/').filter(Boolean).pop();
  return id ?? null;
}

interface BundleListEntry {
  externalKey: string;
  subscriptions: { subscriptionId: string; state: string; planName: string }[];
}

/** Makes sure the tenant catalog holds the Daybook seat plan, without replacing one that has it. */
export async function ensureCatalog(): Promise<void> {
  const current = await call('GET', '/1.0/kb/catalog');
  if (current.status === 200 && current.text.includes(PLAN_NAME)) return;
  const uploaded = await call('POST', '/1.0/kb/catalog/xml', {
    contentType: 'text/xml',
    payload: CATALOG_XML,
  });
  if (uploaded.status >= 300) {
    throw new BillingUnavailable(`catalog upload answered ${uploaded.status}`);
  }
}

export async function ensureAccount(input: {
  workspaceId: string;
  workspaceName: string;
  ownerEmail: string;
}): Promise<string> {
  const existing = await call(
    'GET',
    `/1.0/kb/accounts?externalKey=${encodeURIComponent(input.workspaceId)}`,
  );
  if (existing.status === 200 && existing.text.length > 0) {
    const parsed = JSON.parse(existing.text) as { accountId?: string };
    if (parsed.accountId) return parsed.accountId;
  }
  const created = await call('POST', '/1.0/kb/accounts', {
    contentType: 'application/json',
    payload: JSON.stringify({
      externalKey: input.workspaceId,
      name: input.workspaceName,
      email: input.ownerEmail,
      currency: 'USD',
    }),
  });
  const accountId = idFromLocation(created.location);
  if (created.status === 201 && accountId) return accountId;
  if (created.status === 409) {
    const lookup = await call(
      'GET',
      `/1.0/kb/accounts?externalKey=${encodeURIComponent(input.workspaceId)}`,
    );
    const parsed = JSON.parse(lookup.text) as { accountId?: string };
    if (parsed.accountId) return parsed.accountId;
  }
  throw new BillingUnavailable(`account create answered ${created.status}`);
}

async function listBundles(accountId: string): Promise<BundleListEntry[]> {
  const response = await call('GET', `/1.0/kb/accounts/${accountId}/bundles`);
  if (response.status !== 200) {
    throw new BillingUnavailable(`bundle list answered ${response.status}`);
  }
  return JSON.parse(response.text) as BundleListEntry[];
}

function activeSubscriptionIn(bundles: BundleListEntry[], bundleKey: string): string | null {
  for (const bundle of bundles) {
    if (bundle.externalKey !== bundleKey) continue;
    for (const subscription of bundle.subscriptions) {
      if (subscription.planName === PLAN_NAME && subscription.state !== 'CANCELLED') {
        return subscription.subscriptionId;
      }
    }
  }
  return null;
}

/** One seat subscription per seat-holding member, in a bundle keyed `<workspaceId>:<memberId>`. */
export async function ensureSeat(input: {
  accountId: string;
  workspaceId: string;
  memberId: string;
}): Promise<string> {
  const bundleKey = `${input.workspaceId}:${input.memberId}`;
  const existing = activeSubscriptionIn(await listBundles(input.accountId), bundleKey);
  if (existing) return existing;
  const created = await call('POST', '/1.0/kb/subscriptions', {
    contentType: 'application/json',
    payload: JSON.stringify({
      accountId: input.accountId,
      bundleExternalKey: bundleKey,
      planName: PLAN_NAME,
    }),
  });
  const subscriptionId = idFromLocation(created.location);
  if (created.status === 201 && subscriptionId) return subscriptionId;
  throw new BillingUnavailable(`seat create answered ${created.status}`);
}

export async function cancelSeat(input: {
  accountId: string;
  workspaceId: string;
  memberId: string;
  subscriptionId: string | null;
}): Promise<void> {
  const bundleKey = `${input.workspaceId}:${input.memberId}`;
  const bundles = await listBundles(input.accountId);
  const target = input.subscriptionId ?? activeSubscriptionIn(bundles, bundleKey);
  if (!target) return;
  const response = await call('DELETE', `/1.0/kb/subscriptions/${target}`);
  if (response.status !== 204 && response.status !== 200 && response.status !== 404) {
    throw new BillingUnavailable(`seat cancel answered ${response.status}`);
  }
}
