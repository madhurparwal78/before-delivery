import { OFFICE_NAME, SEAT_CURRENCY, SEAT_PLAN, config } from '../config.js';

const TIMEOUT_MS = 5_000;

export class BillingUnreachable extends Error {}

const SEAT_CATALOG = `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>2020-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>Lockset</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies><currency>USD</currency></currencies>
  <products><product name="Lockset-Seat"><category>BASE</category></product></products>
  <rules>
    <changePolicy><changePolicyCase><policy>IMMEDIATE</policy></changePolicyCase></changePolicy>
    <changeAlignment><changeAlignmentCase><alignment>START_OF_SUBSCRIPTION</alignment></changeAlignmentCase></changeAlignment>
    <cancelPolicy><cancelPolicyCase><policy>IMMEDIATE</policy></cancelPolicyCase></cancelPolicy>
    <createAlignment><createAlignmentCase><alignment>START_OF_BUNDLE</alignment></createAlignmentCase></createAlignment>
    <billingAlignment><billingAlignmentCase><alignment>SUBSCRIPTION</alignment></billingAlignmentCase></billingAlignment>
    <priceList><priceListCase><toPriceList>DEFAULT</toPriceList></priceListCase></priceList>
  </rules>
  <plans>
    <plan name="${SEAT_PLAN}">
      <product>Lockset-Seat</product>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <recurring>
          <billingPeriod>ANNUAL</billingPeriod>
          <recurringPrice><price><currency>USD</currency><value>48.00</value></price></recurringPrice>
        </recurring>
      </finalPhase>
    </plan>
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT"><plans><plan>${SEAT_PLAN}</plan></plans></defaultPriceList>
  </priceLists>
</catalog>`;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64')}`,
    'X-Killbill-ApiKey': config.killbill.apiKey,
    'X-Killbill-ApiSecret': config.killbill.apiSecret,
    'X-Killbill-CreatedBy': 'lockset',
    accept: 'application/json',
    ...extra,
  };
}

async function call(path: string, init: RequestInit = {}, timeoutMs = TIMEOUT_MS): Promise<Response> {
  try {
    return await fetch(`${config.killbill.url}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new BillingUnreachable('Kill Bill is unreachable.');
  }
}

export type SeatSubscription = {
  subscriptionId: string;
  bundleExternalKey: string;
  state: string;
  chargedThroughDate: string | null;
  billingEndDate: string | null;
};

type KbSubscription = {
  subscriptionId: string;
  bundleExternalKey: string;
  planName: string;
  state: string;
  chargedThroughDate: string | null;
  billingEndDate: string | null;
};

type KbBundle = { bundleId: string; externalKey: string; subscriptions: KbSubscription[] };

function seatOf(subscription: KbSubscription): SeatSubscription {
  return {
    subscriptionId: subscription.subscriptionId,
    bundleExternalKey: subscription.bundleExternalKey,
    state: subscription.state,
    chargedThroughDate: subscription.chargedThroughDate,
    billingEndDate: subscription.billingEndDate === null ? null : subscription.billingEndDate.slice(0, 10),
  };
}

export function bundleKeyFor(handle: string): string {
  return `${config.officeKey}-seat-${handle}`;
}

export async function ensureCatalog(): Promise<void> {
  const existing = await call('/1.0/kb/catalog', { headers: headers() });
  if (existing.ok) {
    // A catalog already holding the seat plan, whoever uploaded it, is enough.
    const catalogs = (await existing.json().catch(() => [])) as {
      products?: { plans?: { name: string }[] }[];
    }[];
    const hasPlan = catalogs.some((entry) =>
      (entry.products ?? []).some((product) => (product.plans ?? []).some((plan) => plan.name === SEAT_PLAN)),
    );
    if (hasPlan) return;
  }
  const uploaded = await call(
    '/1.0/kb/catalog/xml',
    { method: 'POST', headers: headers({ 'content-type': 'text/xml' }), body: SEAT_CATALOG },
    15_000,
  );
  if (!uploaded.ok) throw new BillingUnreachable('Kill Bill refused the catalog.');
}

/** The office account is the only account Lockset ever counts. */
export async function ensureAccount(): Promise<string> {
  const found = await call(`/1.0/kb/accounts?externalKey=${encodeURIComponent(config.officeKey)}`, {
    headers: headers(),
  });
  if (found.ok) {
    const account = (await found.json().catch(() => null)) as { accountId?: string } | null;
    if (account !== null && typeof account.accountId === 'string') return account.accountId;
  }
  const created = await call('/1.0/kb/accounts', {
    method: 'POST',
    headers: headers({ 'content-type': 'application/json' }),
    body: JSON.stringify({ externalKey: config.officeKey, name: OFFICE_NAME, currency: SEAT_CURRENCY }),
  });
  if (created.status !== 201) {
    const retry = await call(`/1.0/kb/accounts?externalKey=${encodeURIComponent(config.officeKey)}`, {
      headers: headers(),
    });
    const account = retry.ok ? ((await retry.json().catch(() => null)) as { accountId?: string } | null) : null;
    if (account !== null && typeof account.accountId === 'string') return account.accountId;
    throw new BillingUnreachable('Kill Bill refused the office account.');
  }
  const location = created.headers.get('location');
  const id = location === null ? null : (location.split('/').pop() ?? null);
  if (id === null) throw new BillingUnreachable('Kill Bill gave no account id.');
  return id;
}

/** Looked up on the office account, which also keeps cancelled seats in view. */
export async function findSeatByBundleKey(accountId: string, bundleKey: string): Promise<SeatSubscription | null> {
  const seats = (await listSeats(accountId)).filter((seat) => seat.bundleExternalKey === bundleKey);
  return seats.find((seat) => seat.state !== 'CANCELLED') ?? seats[seats.length - 1] ?? null;
}

export async function purchaseSeat(accountId: string, bundleKey: string): Promise<void> {
  const response = await call('/1.0/kb/subscriptions', {
    method: 'POST',
    headers: headers({ 'content-type': 'application/json' }),
    body: JSON.stringify({ accountId, bundleExternalKey: bundleKey, planName: SEAT_PLAN }),
  });
  if (response.status !== 201 && response.status !== 202) {
    throw new BillingUnreachable('Kill Bill refused the seat purchase.');
  }
}

export async function cancelSeat(subscriptionId: string): Promise<void> {
  const response = await call(
    `/1.0/kb/subscriptions/${subscriptionId}?entitlementPolicy=IMMEDIATE&billingPolicy=END_OF_TERM`,
    { method: 'DELETE', headers: headers() },
  );
  if (response.status !== 204 && response.status !== 200) {
    throw new BillingUnreachable('Kill Bill refused the seat release.');
  }
}

/** Every seat subscription on the office account, whatever its state. */
export async function listSeats(accountId: string): Promise<SeatSubscription[]> {
  const response = await call(`/1.0/kb/accounts/${accountId}/bundles`, { headers: headers() });
  if (!response.ok) throw new BillingUnreachable('Kill Bill refused the bundle list.');
  const bundles = (await response.json().catch(() => [])) as KbBundle[];
  const seats: SeatSubscription[] = [];
  for (const bundle of bundles) {
    for (const subscription of bundle.subscriptions ?? []) {
      if (subscription.planName === SEAT_PLAN) seats.push(seatOf(subscription));
    }
  }
  return seats;
}
