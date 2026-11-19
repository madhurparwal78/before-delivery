import { config } from '../config.js';
import type { Plan } from '../../shared/types.js';
import { catalogPlanName, catalogXml, USAGE_UNIT } from './catalog.js';

const PROBE_MAX_AGE_MS = 5_000;

class BillingUnreachable extends Error {
  constructor() {
    super('Kill Bill is unreachable');
    this.name = 'BillingUnreachable';
  }
}

export const isBillingUnreachable = (error: unknown): boolean => error instanceof BillingUnreachable;

const authHeaders = (): Record<string, string> => ({
  authorization: `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64')}`,
  'x-killbill-apikey': config.killbill.apiKey,
  'x-killbill-apisecret': config.killbill.apiSecret,
  'x-killbill-createdby': 'lowfield-console',
  accept: 'application/json',
});

interface KbResponse {
  readonly status: number;
  readonly text: string;
  readonly location: string | null;
}

const call = async (
  method: string,
  path: string,
  body?: { readonly content: string; readonly contentType: string },
  timeoutMs = 20_000,
): Promise<KbResponse> => {
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}${path}`, {
      method,
      headers: {
        ...authHeaders(),
        ...(body === undefined ? {} : { 'content-type': body.contentType }),
      },
      ...(body === undefined ? {} : { body: body.content }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new BillingUnreachable();
  }
  const text = await response.text();
  if (response.status >= 500) throw new BillingUnreachable();
  return { status: response.status, text, location: response.headers.get('location') };
};

const jsonCall = async (
  method: string,
  path: string,
  payload?: unknown,
  timeoutMs?: number,
): Promise<KbResponse> =>
  call(
    method,
    path,
    payload === undefined ? undefined : { content: JSON.stringify(payload), contentType: 'application/json' },
    timeoutMs,
  );

let probe: { at: number; reachable: boolean } | null = null;

/** `billing_reachable`, from a probe no more than 5 seconds old. */
export const billingReachable = async (): Promise<boolean> => {
  const now = Date.now();
  if (probe !== null && now - probe.at < PROBE_MAX_AGE_MS) return probe.reachable;
  let reachable: boolean;
  try {
    const response = await call('GET', '/1.0/healthcheck', undefined, 4_000);
    reachable = response.status === 200;
  } catch {
    reachable = false;
  }
  probe = { at: Date.now(), reachable };
  return reachable;
};

export const ensureCatalog = async (): Promise<void> => {
  const existing = await call('GET', '/1.0/kb/catalog');
  if (existing.status === 200 && existing.text.includes(catalogPlanName.pilot)) return;
  const uploaded = await call('POST', '/1.0/kb/catalog/xml', { content: catalogXml, contentType: 'text/xml' });
  if (uploaded.status >= 400) throw new Error(`catalog upload refused: ${uploaded.status} ${uploaded.text}`);
};

const idFromLocation = (location: string | null): string => {
  if (location === null) throw new Error('Kill Bill returned no Location header');
  const id = location.split('/').pop();
  if (id === undefined || id === '') throw new Error('Kill Bill returned an unusable Location header');
  return id;
};

export interface BillingAccount {
  readonly accountId: string;
  readonly subscriptionId: string;
}

interface AccountBody {
  readonly accountId: string;
}

interface SubscriptionBody {
  readonly subscriptionId: string;
  readonly planName: string;
  readonly state: string;
}

interface BundleBody {
  readonly subscriptions: readonly SubscriptionBody[];
}

export const externalKeyFor = (slug: string): string => `${config.billingPrefix}-${slug}`;

/** One USD account per organisation, with one subscription on its plan's catalog plan. */
export const ensureAccount = async (orgName: string, slug: string, plan: Plan): Promise<BillingAccount> => {
  const externalKey = externalKeyFor(slug);
  const lookup = await call('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  let accountId: string;
  if (lookup.status === 200) {
    accountId = (JSON.parse(lookup.text) as AccountBody).accountId;
  } else {
    const created = await jsonCall('POST', '/1.0/kb/accounts', {
      name: orgName,
      externalKey,
      currency: 'USD',
    });
    if (created.status >= 400) throw new Error(`account create refused: ${created.status} ${created.text}`);
    accountId = idFromLocation(created.location);
  }

  const bundles = await call('GET', `/1.0/kb/accounts/${accountId}/bundles`);
  if (bundles.status === 200) {
    const parsed = JSON.parse(bundles.text) as readonly BundleBody[];
    for (const bundle of parsed) {
      for (const subscription of bundle.subscriptions) {
        if (subscription.state !== 'CANCELLED') return { accountId, subscriptionId: subscription.subscriptionId };
      }
    }
  }

  const created = await jsonCall(
    'POST',
    '/1.0/kb/subscriptions?callCompletion=true&callTimeoutSec=15',
    { accountId, planName: catalogPlanName[plan] },
    30_000,
  );
  if (created.status >= 400) throw new Error(`subscription create refused: ${created.status} ${created.text}`);
  return { accountId, subscriptionId: idFromLocation(created.location) };
};

export const readSubscriptionPlan = async (subscriptionId: string): Promise<string | null> => {
  const response = await call('GET', `/1.0/kb/subscriptions/${subscriptionId}`);
  if (response.status !== 200) return null;
  return (JSON.parse(response.text) as SubscriptionBody).planName;
};

export const changeSubscriptionPlan = async (subscriptionId: string, plan: Plan): Promise<boolean> => {
  const response = await jsonCall(
    'PUT',
    `/1.0/kb/subscriptions/${subscriptionId}?billingPolicy=IMMEDIATE&callCompletion=true&callTimeoutSec=15`,
    { planName: catalogPlanName[plan] },
    30_000,
  );
  return response.status < 400;
};

/**
 * Records one session's billable seconds against its subscription. Kill Bill
 * reporting that the tracking id already exists also counts as accepted.
 */
export const recordUsage = async (
  subscriptionId: string,
  trackingId: string,
  billableSeconds: number,
  recordDate: Date,
): Promise<boolean> => {
  const response = await jsonCall('POST', '/1.0/kb/usages', {
    subscriptionId,
    trackingId,
    unitUsageRecords: [
      {
        unitType: USAGE_UNIT,
        usageRecords: [{ recordDate: recordDate.toISOString().slice(0, 10), amount: billableSeconds }],
      },
    ],
  });
  if (response.status < 400) return true;
  return response.text.includes('already exists');
};
