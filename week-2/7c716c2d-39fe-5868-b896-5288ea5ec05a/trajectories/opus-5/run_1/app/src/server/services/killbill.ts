import { config } from '../config.js';
import { ApiError } from '../errors.js';

const timeoutMs = 5000;

const catalogXml = `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>2020-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>Tallyroom</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies>
    <currency>USD</currency>
  </currencies>
  <products>
    <product name="Seat">
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
    <plan name="tallyroom-seat-monthly">
      <product>Seat</product>
      <finalPhase type="EVERGREEN">
        <duration>
          <unit>UNLIMITED</unit>
        </duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice>
            <price>
              <currency>USD</currency>
              <value>8.00</value>
            </price>
          </recurringPrice>
        </recurring>
      </finalPhase>
    </plan>
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT">
      <plans>
        <plan>tallyroom-seat-monthly</plan>
      </plans>
    </defaultPriceList>
  </priceLists>
</catalog>
`;

function authHeaders(contentType: string): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${config.killbillUsername}:${config.killbillPassword}`).toString('base64')}`,
    'X-Killbill-ApiKey': config.killbillApiKey,
    'X-Killbill-ApiSecret': config.killbillApiSecret,
    'X-Killbill-CreatedBy': 'tallyroom',
    'Content-Type': contentType,
  };
}

type Call = { status: number; location: string | null; json: unknown };

async function call(method: string, path: string, body?: unknown, contentType = 'application/json'): Promise<Call> {
  let response: Response;
  try {
    response = await fetch(`${config.killbillUrl}${path}`, {
      method,
      headers: authHeaders(contentType),
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ApiError('billing_unavailable');
  }
  if (response.status >= 500) {
    await response.text();
    throw new ApiError('billing_unavailable');
  }
  const text = await response.text();
  let json: unknown = null;
  if (text !== '') {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  return { status: response.status, location: response.headers.get('location'), json };
}

export async function killbillReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${config.killbillUrl}/1.0/healthcheck`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    await response.text();
    return response.ok;
  } catch {
    return false;
  }
}

let catalogReady = false;

export async function ensureCatalog(): Promise<void> {
  if (catalogReady) return;
  const existing = await call('GET', '/1.0/kb/catalog');
  const versions = Array.isArray(existing.json) ? (existing.json as Record<string, unknown>[]) : [];
  const hasPlan = versions.some((version) => {
    const products = version.products;
    if (!Array.isArray(products)) return false;
    return products.some((product) => {
      const entry = product as { name?: unknown; plans?: unknown };
      if (entry.name !== 'Seat' || !Array.isArray(entry.plans)) return false;
      return entry.plans.some((plan) => (plan as { name?: unknown }).name === 'tallyroom-seat-monthly');
    });
  });
  if (!hasPlan) {
    const uploaded = await call('POST', '/1.0/kb/catalog/xml', catalogXml, 'text/xml');
    if (uploaded.status >= 400) throw new ApiError('billing_unavailable');
  }
  catalogReady = true;
}

type Resources = { accountId: string; subscriptionId: string };

const resources = new Map<string, Resources>();

type CustomField = { customFieldId: string; name: string; value: string };

async function customFields(subscriptionId: string): Promise<CustomField[]> {
  const response = await call('GET', `/1.0/kb/subscriptions/${subscriptionId}/customFields`);
  if (response.status === 404) throw new ApiError('billing_unavailable');
  return Array.isArray(response.json) ? (response.json as CustomField[]) : [];
}

async function putField(subscriptionId: string, fields: CustomField[], name: string, value: string): Promise<void> {
  const existing = fields.find((field) => field.name === name);
  const response =
    existing === undefined
      ? await call('POST', `/1.0/kb/subscriptions/${subscriptionId}/customFields`, [{ name, value }])
      : await call('PUT', `/1.0/kb/subscriptions/${subscriptionId}/customFields`, [
          { customFieldId: existing.customFieldId, name, value },
        ]);
  if (response.status >= 400) throw new ApiError('billing_unavailable');
}

async function deleteField(subscriptionId: string, fields: CustomField[], name: string): Promise<void> {
  const existing = fields.find((field) => field.name === name);
  if (existing === undefined) return;
  const response = await call(
    'DELETE',
    `/1.0/kb/subscriptions/${subscriptionId}/customFields?customField=${existing.customFieldId}`,
  );
  if (response.status >= 400) throw new ApiError('billing_unavailable');
}

export function accountExternalKey(workspaceId: string): string {
  return `tallyroom-${workspaceId}`;
}

function bundleExternalKey(workspaceId: string): string {
  return `tallyroom-${workspaceId}-seats`;
}

/** The one Kill Bill account and per-seat subscription of a workspace. */
async function ensureResources(
  workspaceId: string,
  workspaceName: string,
  initialSeats: number,
): Promise<Resources> {
  const cached = resources.get(workspaceId);
  if (cached !== undefined) return cached;
  await ensureCatalog();
  const externalKey = accountExternalKey(workspaceId);
  let accountId: string;
  const lookup = await call('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  if (lookup.status === 200 && lookup.json !== null && typeof lookup.json === 'object') {
    accountId = String((lookup.json as { accountId: string }).accountId);
  } else {
    const created = await call('POST', '/1.0/kb/accounts', {
      externalKey,
      name: workspaceName,
      currency: 'USD',
    });
    if (created.location === null) throw new ApiError('billing_unavailable');
    accountId = created.location.split('/accounts/')[1] ?? '';
  }

  const bundleKey = bundleExternalKey(workspaceId);
  const bundles = await call(
    'GET',
    `/1.0/kb/accounts/${accountId}/bundles?externalKey=${encodeURIComponent(bundleKey)}`,
  );
  let subscriptionId: string | undefined;
  if (Array.isArray(bundles.json)) {
    for (const bundle of bundles.json as { subscriptions?: { subscriptionId: string; planName: string }[] }[]) {
      for (const subscription of bundle.subscriptions ?? []) {
        if (subscription.planName === 'tallyroom-seat-monthly') subscriptionId = subscription.subscriptionId;
      }
    }
  }
  if (subscriptionId === undefined) {
    const created = await call('POST', '/1.0/kb/subscriptions?callCompletion=true&callTimeoutSec=4', {
      accountId,
      bundleExternalKey: bundleKey,
      planName: 'tallyroom-seat-monthly',
    });
    if (created.location === null) throw new ApiError('billing_unavailable');
    subscriptionId = created.location.split('/subscriptions/')[1] ?? '';
    const fields = await customFields(subscriptionId);
    await putField(subscriptionId, fields, 'seats', String(initialSeats));
  }
  const resource: Resources = { accountId, subscriptionId };
  resources.set(workspaceId, resource);
  return resource;
}

export type SeatRecord = {
  limit: number;
  scheduledLimit: number | null;
  scheduledOn: string | null;
  chargedThroughDate: string | null;
  subscriptionId: string;
};

function parseSchedule(value: string | undefined): { limit: number; on: string } | null {
  if (value === undefined) return null;
  const [limitText, date] = value.split('@');
  const limit = Number(limitText);
  if (!Number.isInteger(limit) || date === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { limit, on: date };
}

/** Reads the confirmed seat count, the schedule and the charged-through date. */
export async function readSeatRecord(
  workspaceId: string,
  workspaceName: string,
  initialSeats: number,
): Promise<SeatRecord> {
  const { subscriptionId } = await ensureResources(workspaceId, workspaceName, initialSeats);
  const fields = await customFields(subscriptionId);
  const seatsField = fields.find((field) => field.name === 'seats');
  if (seatsField === undefined) {
    await putField(subscriptionId, fields, 'seats', String(initialSeats));
  }
  const limit = Number(seatsField?.value ?? initialSeats);
  if (!Number.isInteger(limit) || limit < 1) throw new ApiError('billing_unavailable');
  const schedule = parseSchedule(fields.find((field) => field.name === 'seats_scheduled')?.value);
  const subscription = await call('GET', `/1.0/kb/subscriptions/${subscriptionId}`);
  if (subscription.status !== 200 || subscription.json === null) throw new ApiError('billing_unavailable');
  const chargedThroughDate = (subscription.json as { chargedThroughDate: string | null }).chargedThroughDate;
  return {
    limit,
    scheduledLimit: schedule?.limit ?? null,
    scheduledOn: schedule?.on ?? null,
    chargedThroughDate,
    subscriptionId,
  };
}

/** Rewrites the seat count and reads it back, so a raise counts only once confirmed. */
export async function writeSeats(subscriptionId: string, seats: number): Promise<number> {
  const fields = await customFields(subscriptionId);
  await putField(subscriptionId, fields, 'seats', String(seats));
  await deleteField(subscriptionId, fields, 'seats_scheduled');
  const readBack = await customFields(subscriptionId);
  const value = Number(readBack.find((field) => field.name === 'seats')?.value);
  if (value !== seats) throw new ApiError('billing_unavailable');
  return value;
}

export async function writeSchedule(subscriptionId: string, seats: number, onDate: string): Promise<void> {
  const fields = await customFields(subscriptionId);
  await putField(subscriptionId, fields, 'seats_scheduled', `${seats}@${onDate}`);
  const readBack = await customFields(subscriptionId);
  const stored = parseSchedule(readBack.find((field) => field.name === 'seats_scheduled')?.value);
  if (stored === null || stored.limit !== seats || stored.on !== onDate) throw new ApiError('billing_unavailable');
}

export async function clearSchedule(subscriptionId: string): Promise<void> {
  const fields = await customFields(subscriptionId);
  await deleteField(subscriptionId, fields, 'seats_scheduled');
}
