import type { Settings } from '../config.js';

const CATALOG_XML = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd ">
  <effectiveDate>2020-01-01T00:00:00.000Z</effectiveDate>
  <catalogName>lockset</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies>
    <currency>USD</currency>
  </currencies>
  <products>
    <product name="Lockset-Seat">
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
        <alignment>START_OF_SUBSCRIPTION</alignment>
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
        <alignment>BUNDLE</alignment>
      </billingAlignmentCase>
    </billingAlignment>
    <priceList>
      <priceListCase>
        <toPriceList>DEFAULT</toPriceList>
      </priceListCase>
    </priceList>
  </rules>
  <plans>
    <plan name="lockset-seat-annual">
      <product>Lockset-Seat</product>
      <finalPhase type="EVERGREEN">
        <duration>
          <unit>UNLIMITED</unit>
        </duration>
        <recurring>
          <billingPeriod>ANNUAL</billingPeriod>
          <recurringPrice>
            <price>
              <currency>USD</currency>
              <value>48.00</value>
            </price>
          </recurringPrice>
        </recurring>
      </finalPhase>
    </plan>
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT">
      <plans>
        <plan>lockset-seat-annual</plan>
      </plans>
    </defaultPriceList>
  </priceLists>
</catalog>`;

export interface KbSubscription {
  subscriptionId: string;
  state: string;
  chargedThroughDate: string | null;
  billingEndDate: string | null;
  bundleExternalKey: string | null;
}

export interface BillingFigures {
  seats: number;
  nextInvoiceDate: string | null;
  nextInvoiceAmount: string | null;
  licenceTermEndsOn: string | null;
  subscriptions: KbSubscription[];
}

/** Kill Bill client: catalog, the office account, and per-seat subscriptions, with explicit timeouts. */
export class KillBillClient {
  constructor(private readonly settings: Settings) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: 'Basic ' + Buffer.from(`${this.settings.killbillUsername}:${this.settings.killbillPassword}`).toString('base64'),
      'X-Killbill-ApiKey': this.settings.killbillApiKey,
      'X-Killbill-ApiSecret': this.settings.killbillApiSecret,
      'X-Killbill-CreatedBy': 'lockset',
      ...extra
    };
  }

  private url(path: string): string {
    return `${this.settings.killbillUrl}${path}`;
  }

  private async call(path: string, init: RequestInit, timeoutMs: number): Promise<Response | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(this.url(path), { ...init, signal: controller.signal });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Make sure the tenant catalog holds the seat plan. A catalog that already holds it is not an error. */
  async ensureCatalog(): Promise<boolean> {
    const check = await this.call('/1.0/kb/catalog', { headers: this.headers() }, 8000);
    if (check === null) return false;
    if (check.ok) {
      try {
        const versions = (await check.json()) as Array<Record<string, unknown>>;
        if (JSON.stringify(versions).includes('lockset-seat-annual')) return true;
      } catch {
        // fall through to upload
      }
    }
    const upload = await this.call(
      '/1.0/kb/catalog',
      { method: 'POST', headers: this.headers({ 'Content-Type': 'text/xml' }), body: CATALOG_XML },
      8000
    );
    if (upload === null) return false;
    if (upload.ok) return true;
    // A catalog already holding the plan may have been uploaded by another office.
    const recheck = await this.call('/1.0/kb/catalog', { headers: this.headers() }, 8000);
    if (recheck === null || !recheck.ok) return false;
    try {
      const versions = (await recheck.json()) as Array<Record<string, unknown>>;
      return JSON.stringify(versions).includes('lockset-seat-annual');
    } catch {
      return false;
    }
  }

  /** Find or create the office account; returns its Kill Bill account id, or null when unreachable. */
  async ensureAccount(): Promise<string | null> {
    const officeKey = this.settings.officeKey;
    const search = await this.call(
      `/1.0/kb/accounts/search/${encodeURIComponent(officeKey)}`,
      { headers: this.headers() },
      8000
    );
    if (search !== null && search.ok) {
      const accounts = (await search.json().catch(() => [])) as Array<{ accountId: string; externalKey: string }>;
      const found = accounts.find((account) => account.externalKey === officeKey);
      if (found) return found.accountId;
    }
    if (search === null) return null;
    const created = await this.call(
      '/1.0/kb/accounts',
      {
        method: 'POST',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name: 'Brannock & Lyle', externalKey: officeKey, currency: 'USD' })
      },
      8000
    );
    if (created === null) return null;
    if (created.ok || created.status === 201) {
      const location = created.headers.get('Location');
      if (location) {
        const id = location.split('/').filter(Boolean).pop() ?? '';
        if (id) return id;
      }
    }
    const retry = await this.call(
      `/1.0/kb/accounts/search/${encodeURIComponent(officeKey)}`,
      { headers: this.headers() },
      8000
    );
    if (retry === null || !retry.ok) return null;
    const accounts = (await retry.json().catch(() => [])) as Array<{ accountId: string; externalKey: string }>;
    const found = accounts.find((account) => account.externalKey === officeKey);
    return found ? found.accountId : null;
  }

  bundleExternalKey(handle: string): string {
    return `${this.settings.officeKey}-seat-${handle}`;
  }

  /** Look up the office account's seat subscriptions; only this office's bundles count. */
  async officeSubscriptions(accountId: string): Promise<KbSubscription[] | null> {
    const response = await this.call(
      `/1.0/kb/accounts/${accountId}/bundles?externalKeyPrefix=${encodeURIComponent(this.settings.officeKey)}&includedDeleted=true`,
      { headers: this.headers() },
      8000
    );
    if (response === null) return null;
    if (!response.ok) {
      // Fallback: fetch all bundles and filter by the office prefix.
      const all = await this.call(`/1.0/kb/accounts/${accountId}/bundles?includedDeleted=true`, { headers: this.headers() }, 8000);
      if (all === null || !all.ok) return null;
      const bundles = (await all.json().catch(() => [])) as Array<Record<string, unknown>>;
      return this.extractSubscriptions(bundles);
    }
    const bundles = (await response.json().catch(() => [])) as Array<Record<string, unknown>>;
    return this.extractSubscriptions(bundles);
  }

  private extractSubscriptions(bundles: Array<Record<string, unknown>>): KbSubscription[] {
    const out: KbSubscription[] = [];
    for (const bundle of bundles) {
      const externalKey = typeof bundle.externalKey === 'string' ? bundle.externalKey : null;
      if (!externalKey || !externalKey.startsWith(`${this.settings.officeKey}-seat-`)) continue;
      const subs = Array.isArray(bundle.subscriptions) ? (bundle.subscriptions as Array<Record<string, unknown>>) : [];
      for (const sub of subs) {
        out.push({
          subscriptionId: String(sub.subscriptionId ?? ''),
          state: String(sub.state ?? ''),
          chargedThroughDate: typeof sub.chargedThroughDate === 'string' ? sub.chargedThroughDate : null,
          billingEndDate: typeof sub.billingEndDate === 'string' ? sub.billingEndDate : null,
          bundleExternalKey: externalKey
        });
      }
    }
    return out;
  }

  /** Create a seat subscription on the office account inside its own bundle. */
  async createSeat(accountId: string, handle: string): Promise<KbSubscription | null | 'unreachable'> {
    const bundleKey = this.bundleExternalKey(handle);
    const existing = await this.call(`/1.0/kb/bundles?externalKey=${encodeURIComponent(bundleKey)}`, { headers: this.headers() }, 8000);
    if (existing === null) return 'unreachable';
    if (existing.ok) {
      const bundles = (await existing.json().catch(() => [])) as Array<Record<string, unknown>>;
      const subs = this.extractSubscriptions(bundles);
      const active = subs.find((sub) => sub.state === 'ACTIVE');
      if (active) return active;
    }
    const created = await this.call(
      '/1.0/kb/subscriptions',
      {
        method: 'POST',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ accountId, planName: 'lockset-seat-annual', bundleExternalKey: bundleKey })
      },
      8000
    );
    if (created === null) return 'unreachable';
    if (!created.ok) {
      const body = (await created.json().catch(() => ({}))) as { errorMessage?: string };
      if (/already exists/i.test(body.errorMessage ?? '')) {
        const again = await this.call(`/1.0/kb/bundles?externalKey=${encodeURIComponent(bundleKey)}`, { headers: this.headers() }, 8000);
        if (again !== null && again.ok) {
          const subs = this.extractSubscriptions((await again.json().catch(() => [])) as Array<Record<string, unknown>>);
          const active = subs.find((sub) => sub.state === 'ACTIVE');
          if (active) return active;
        }
      }
      return 'unreachable';
    }
    const location = created.headers.get('Location');
    const subscriptionId = location ? (location.split('/').filter(Boolean).pop() ?? '') : '';
    return {
      subscriptionId,
      state: 'PENDING',
      chargedThroughDate: null,
      billingEndDate: null,
      bundleExternalKey: bundleKey
    };
  }

  /** Fetch one subscription by id. */
  async subscription(subscriptionId: string): Promise<KbSubscription | null> {
    const response = await this.call(`/1.0/kb/subscriptions/${subscriptionId}`, { headers: this.headers() }, 8000);
    if (response === null || !response.ok) return null;
    const sub = (await response.json()) as Record<string, unknown>;
    return {
      subscriptionId: String(sub.subscriptionId ?? subscriptionId),
      state: String(sub.state ?? ''),
      chargedThroughDate: typeof sub.chargedThroughDate === 'string' ? sub.chargedThroughDate : null,
      billingEndDate: typeof sub.billingEndDate === 'string' ? sub.billingEndDate : null,
      bundleExternalKey: typeof sub.bundleExternalKey === 'string' ? sub.bundleExternalKey : null
    };
  }

  /** Cancel a subscription: entitlement ends now, billing ends at the paid term's end. */
  async cancelSeat(subscriptionId: string): Promise<KbSubscription | null | 'unreachable'> {
    const response = await this.call(
      `/1.0/kb/subscriptions/${subscriptionId}`,
      { method: 'DELETE', headers: this.headers() },
      8000
    );
    if (response === null) return 'unreachable';
    if (!response.ok) return 'unreachable';
    const sub = await this.subscription(subscriptionId);
    return sub;
  }

  /** Derive the published billing figures from the office account's active seat subscriptions. */
  figures(subscriptions: KbSubscription[]): BillingFigures {
    const active = subscriptions.filter((sub) => sub.state === 'ACTIVE' && sub.chargedThroughDate);
    const seats = active.length;
    if (seats === 0) {
      return { seats: 0, nextInvoiceDate: null, nextInvoiceAmount: null, licenceTermEndsOn: null, subscriptions };
    }
    const earliest = active.reduce((min, sub) => (sub.chargedThroughDate! < min ? sub.chargedThroughDate! : min), active[0].chargedThroughDate!);
    const withEarliest = active.filter((sub) => sub.chargedThroughDate === earliest);
    return {
      seats,
      nextInvoiceDate: earliest,
      nextInvoiceAmount: (48.0 * withEarliest.length).toFixed(2),
      licenceTermEndsOn: earliest,
      subscriptions
    };
  }
}
