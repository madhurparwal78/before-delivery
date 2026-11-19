// Kill Bill client: catalog, accounts, subscriptions, usage records and plan changes.

import type { Config } from './config';

const KB_HEADERS_JSON = { 'Content-Type': 'application/json' } as const;
const KB_HEADERS_XML = { 'Content-Type': 'text/xml' } as const;

export class KillBillClient {
  constructor(private cfg: Config) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const kb = this.cfg.killbill;
    return {
      'X-Killbill-ApiKey': kb.apiKey,
      'X-Killbill-ApiSecret': kb.apiSecret,
      Authorization: `Basic ${Buffer.from(`${kb.username}:${kb.password}`).toString('base64')}`,
      'X-Killbill-CreatedBy': 'lowfield',
      Accept: 'application/json',
      ...extra,
    };
  }

  private url(path: string): string {
    return `${this.cfg.killbill.url}/1.0/kb${path}`;
  }

  async request(method: string, path: string, body?: unknown, contentType?: 'json' | 'xml'): Promise<{ status: number; text: string }> {
    const headers = this.headers(contentType === 'xml' ? KB_HEADERS_XML : contentType === 'json' ? KB_HEADERS_JSON : {});
    const init: RequestInit = { method, headers: headers as Record<string, string> };
    if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
    const res = await fetch(this.url(path), init);
    return { status: res.status, text: await res.text() };
  }

  /** A cheap liveness probe. */
  async reachable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.cfg.killbill.url}/1.0/kb/tenants`, { headers: this.headers() as Record<string, string> });
      return res.status < 500;
    } catch {
      return false;
    }
  }

  async hasCatalog(): Promise<boolean> {
    try {
      const { status, text } = await this.request('GET', '/catalog');
      if (status !== 200) return false;
      const versions = JSON.parse(text) as unknown[];
      return Array.isArray(versions) && versions.length > 0;
    } catch {
      return false;
    }
  }

  async uploadCatalog(catalogXml: string): Promise<void> {
    const { status, text } = await this.request('POST', '/catalog', catalogXml, 'xml');
    if (status !== 201) throw new Error(`catalog upload failed: ${status} ${text.slice(0, 200)}`);
  }

  async findAccountByExternalKey(externalKey: string): Promise<{ accountId: string } | null> {
    try {
      const { status, text } = await this.request('GET', `/accounts?externalKey=${encodeURIComponent(externalKey)}`);
      if (status === 200) {
        const j = JSON.parse(text) as { accountId: string };
        return { accountId: j.accountId };
      }
      return null;
    } catch {
      return null;
    }
  }

  async createAccount(name: string, externalKey: string, referenceTime: string): Promise<{ accountId: string } | null> {
    try {
      const { status } = await this.request('POST', '/accounts', {
        name,
        externalKey,
        currency: 'USD',
        country: 'US',
        timeZone: 'UTC',
        referenceTime,
      }, 'json');
      if (status === 201) {
        const found = await this.findAccountByExternalKey(externalKey);
        return found;
      }
      return null;
    } catch {
      return null;
    }
  }

  async findSubscription(accountId: string, subExternalKey: string): Promise<{ subscriptionId: string; planName: string } | null> {
    try {
      const { status, text } = await this.request('GET', `/accounts/${accountId}/bundles`);
      if (status !== 200) return null;
      const bundles = JSON.parse(text) as { subscriptions: { subscriptionId: string; externalKey: string; planName: string; state: string }[] }[];
      for (const b of bundles) {
        for (const s of b.subscriptions) {
          if (s.externalKey === subExternalKey && s.state === 'ACTIVE') return { subscriptionId: s.subscriptionId, planName: s.planName };
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  async createSubscription(accountId: string, subExternalKey: string, planName: string): Promise<{ subscriptionId: string } | null> {
    try {
      const { status, text } = await this.request('POST', '/subscriptions', { accountId, externalKey: subExternalKey, planName }, 'json');
      if (status === 201) {
        const found = await this.findSubscription(accountId, subExternalKey);
        if (found) return { subscriptionId: found.subscriptionId };
        // The create returns the subscription JSON directly too.
        const j = JSON.parse(text) as { subscriptionId?: string };
        if (j.subscriptionId) return { subscriptionId: j.subscriptionId };
      }
      return null;
    } catch {
      return null;
    }
  }

  async recordUsage(subscriptionId: string, trackingId: string, recordDate: string, amount: number): Promise<'accepted' | 'duplicate' | 'unavailable'> {
    try {
      const { status, text } = await this.request('POST', '/usages', {
        subscriptionId,
        trackingId,
        unitUsageRecords: [{ unitType: 'billable-second', usageRecords: [{ recordDate, amount }] }],
      }, 'json');
      if (status === 201) return 'accepted';
      if (status === 400 && text.includes('tracking ID') && text.includes('already exists')) return 'duplicate';
      return 'unavailable';
    } catch {
      return 'unavailable';
    }
  }

  async changePlan(subscriptionId: string, planName: string): Promise<boolean> {
    try {
      const { status } = await this.request('PUT', `/subscriptions/${subscriptionId}`, { planName }, 'json');
      return status === 204;
    } catch {
      return false;
    }
  }

  async readSubscriptionPlan(accountId: string, subExternalKey: string): Promise<string | null> {
    const found = await this.findSubscription(accountId, subExternalKey);
    return found?.planName ?? null;
  }
}
