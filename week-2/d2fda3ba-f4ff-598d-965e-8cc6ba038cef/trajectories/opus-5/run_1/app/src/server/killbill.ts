import type { AddonName, SubscriptionFacts } from '../shared/addons';
import type { KillBillConfig } from './config';

export class BillingUnavailableError extends Error {
  constructor(reason: string) {
    super(`billing unavailable: ${reason}`);
  }
}

export const PLAN_NAMES: Record<AddonName, string> = {
  sync: 'cairn-sync-monthly',
  publish: 'cairn-publish-monthly',
};

export const PRODUCT_NAMES: Record<AddonName, string> = {
  sync: 'CairnSync',
  publish: 'CairnPublish',
};

export interface KillBillAccountInput {
  accountId: string;
  displayName: string;
  email: string;
  timeZone: string;
}

export interface SubscriptionRecord extends SubscriptionFacts {
  subscriptionId: string | null;
}

interface KbSubscription {
  subscriptionId: string;
  productName: string;
  planName: string;
  state: string;
  startDate: string | null;
  billingEndDate: string | null;
  chargedThroughDate: string | null;
}

interface KbBundle {
  subscriptions: KbSubscription[];
}

const READ_TIMEOUT_MS = 5000;
const WRITE_TIMEOUT_MS = 12000;

export class KillBillClient {
  constructor(private readonly config: KillBillConfig) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`,
      'x-killbill-apikey': this.config.apiKey,
      'x-killbill-apisecret': this.config.apiSecret,
      'x-killbill-createdby': 'cairn',
      accept: 'application/json',
      ...extra,
    };
  }

  private async request(
    method: string,
    path: string,
    options: { body?: string; contentType?: string } = {},
  ): Promise<Response> {
    try {
      return await fetch(`${this.config.url}${path}`, {
        method,
        headers: this.headers(options.contentType ? { 'content-type': options.contentType } : {}),
        body: options.body,
        signal: AbortSignal.timeout(method === 'GET' ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS),
        redirect: 'follow',
      });
    } catch (error) {
      throw new BillingUnavailableError(error instanceof Error ? error.message : 'request failed');
    }
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T | null> {
    const response = await this.request(method, path, {
      body: body === undefined ? undefined : JSON.stringify(body),
      contentType: body === undefined ? undefined : 'application/json',
    });
    if (response.status === 404) {
      await response.text();
      return null;
    }
    if (!response.ok) {
      const text = await response.text();
      throw new BillingUnavailableError(`${method} ${path} answered ${response.status}: ${text.slice(0, 200)}`);
    }
    const text = await response.text();
    if (text.length === 0) return null;
    return JSON.parse(text) as T;
  }

  async ensureCatalog(catalogXml: string): Promise<void> {
    const existing = await this.json<unknown[]>('GET', '/1.0/kb/catalog');
    if (Array.isArray(existing) && existing.length > 0) return;
    const response = await this.request('POST', '/1.0/kb/catalog/xml', {
      body: catalogXml,
      contentType: 'text/xml',
    });
    const text = await response.text();
    if (!response.ok) {
      throw new BillingUnavailableError(`catalog upload answered ${response.status}: ${text.slice(0, 200)}`);
    }
  }

  async findAccountId(externalKey: string): Promise<string | null> {
    const account = await this.json<{ accountId: string }>(
      'GET',
      `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`,
    );
    return account?.accountId ?? null;
  }

  async ensureAccount(input: KillBillAccountInput): Promise<string> {
    const existing = await this.findAccountId(input.accountId);
    if (existing) return existing;
    const response = await this.request('POST', '/1.0/kb/accounts', {
      body: JSON.stringify({
        externalKey: input.accountId,
        name: input.displayName,
        email: input.email,
        currency: 'USD',
        timeZone: input.timeZone,
      }),
      contentType: 'application/json',
    });
    const text = await response.text();
    if (!response.ok) {
      throw new BillingUnavailableError(`account create answered ${response.status}: ${text.slice(0, 200)}`);
    }
    const created = await this.findAccountId(input.accountId);
    if (!created) throw new BillingUnavailableError('account create did not produce an account');
    return created;
  }

  /** The most recent subscription for each add-on, including cancelled ones. */
  async readSubscriptions(kbAccountId: string): Promise<Record<AddonName, SubscriptionRecord>> {
    const bundles = await this.json<KbBundle[]>('GET', `/1.0/kb/accounts/${kbAccountId}/bundles`);
    const result: Record<AddonName, SubscriptionRecord> = {
      sync: { subscribed: false, billingEndDate: null, subscriptionId: null },
      publish: { subscribed: false, billingEndDate: null, subscriptionId: null },
    };
    const latest: Partial<Record<AddonName, KbSubscription>> = {};
    for (const bundle of bundles ?? []) {
      for (const subscription of bundle.subscriptions ?? []) {
        const addon = (Object.keys(PRODUCT_NAMES) as AddonName[]).find(
          (name) => PRODUCT_NAMES[name] === subscription.productName,
        );
        if (!addon) continue;
        const current = latest[addon];
        if (!current || (subscription.startDate ?? '') >= (current.startDate ?? '')) latest[addon] = subscription;
      }
    }
    for (const addon of Object.keys(PRODUCT_NAMES) as AddonName[]) {
      const subscription = latest[addon];
      if (!subscription) continue;
      result[addon] = {
        subscribed: true,
        billingEndDate: subscription.billingEndDate ?? null,
        subscriptionId: subscription.subscriptionId,
      };
    }
    return result;
  }

  async createSubscription(kbAccountId: string, accountId: string, addon: AddonName): Promise<void> {
    const bundleExternalKey = `${accountId}-${addon}`;
    const response = await this.request('POST', '/1.0/kb/subscriptions', {
      body: JSON.stringify({
        accountId: kbAccountId,
        bundleExternalKey,
        planName: PLAN_NAMES[addon],
      }),
      contentType: 'application/json',
    });
    const text = await response.text();
    if (!response.ok) {
      throw new BillingUnavailableError(`subscription create answered ${response.status}: ${text.slice(0, 200)}`);
    }
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    const response = await this.request(
      'DELETE',
      `/1.0/kb/subscriptions/${subscriptionId}?entitlementPolicy=END_OF_TERM&billingPolicy=END_OF_TERM&useRequestedDateForBilling=false`,
    );
    const text = await response.text();
    if (!response.ok) {
      throw new BillingUnavailableError(`subscription cancel answered ${response.status}: ${text.slice(0, 200)}`);
    }
  }
}

export const CAIRN_CATALOG_XML = `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>2024-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>Cairn</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies>
    <currency>USD</currency>
  </currencies>
  <products>
    <product name="CairnSync">
      <category>BASE</category>
    </product>
    <product name="CairnPublish">
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
    <plan name="cairn-sync-monthly">
      <product>CairnSync</product>
      <finalPhase type="EVERGREEN">
        <duration>
          <unit>UNLIMITED</unit>
        </duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice>
            <price>
              <currency>USD</currency>
              <value>6.00</value>
            </price>
          </recurringPrice>
        </recurring>
      </finalPhase>
    </plan>
    <plan name="cairn-publish-monthly">
      <product>CairnPublish</product>
      <finalPhase type="EVERGREEN">
        <duration>
          <unit>UNLIMITED</unit>
        </duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice>
            <price>
              <currency>USD</currency>
              <value>9.00</value>
            </price>
          </recurringPrice>
        </recurring>
      </finalPhase>
    </plan>
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT">
      <plans>
        <plan>cairn-sync-monthly</plan>
        <plan>cairn-publish-monthly</plan>
      </plans>
    </defaultPriceList>
  </priceLists>
</catalog>
`;
