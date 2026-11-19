// Kill Bill client. Kill Bill is the source of truth for each workspace's plan.

import type { Config } from '../config.js';
import { billingUnavailable } from '../errors.js';

interface SubscriptionJson {
  subscriptionId: string;
  bundleId: string;
  bundleExternalKey: string | null;
  externalKey: string | null;
  planName: string;
  state: string;
  phaseType: string;
}

interface BundleJson {
  bundleId: string;
  externalKey: string;
  subscriptions: SubscriptionJson[];
}

interface AccountJson {
  accountId: string;
  name: string;
  externalKey: string;
}

export class KillBill {
  private readonly cfg: Config['killbill'];

  constructor(cfg: Config['killbill']) {
    this.cfg = cfg;
  }

  private headers(): Record<string, string> {
    return {
      'X-Killbill-ApiKey': this.cfg.apiKey,
      'X-Killbill-ApiSecret': this.cfg.apiSecret,
      Authorization: `Basic ${Buffer.from(`${this.cfg.username}:${this.cfg.password}`).toString('base64')}`,
      'X-Killbill-CreatedBy': 'rushes',
    };
  }

  async request<T>(
    method: string,
    path: string,
    body?: string,
    contentType = 'application/json',
  ): Promise<{ status: number; data: T | null; location: string | null }> {
    const url = `${this.cfg.url.replace(/\/$/, '')}/1.0/kb${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          ...this.headers(),
          ...(body !== undefined ? { 'Content-Type': contentType } : {}),
        },
        body,
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw billingUnavailable();
    }
    if (res.status === 404) {
      return { status: 404, data: null, location: null };
    }
    if (!res.ok) {
      throw billingUnavailable();
    }
    const text = await res.text();
    let data: T | null = null;
    if (text) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        data = null;
      }
    }
    return { status: res.status, data, location: res.headers.get('location') };
  }

  async findAccountByExternalKey(externalKey: string): Promise<string | null> {
    const r = await this.request<AccountJson>('GET', `/accounts?externalKey=${encodeURIComponent(externalKey)}`);
    return r.data?.accountId ?? null;
  }

  async createAccount(externalKey: string, name: string): Promise<string> {
    const r = await this.request<Record<string, unknown>>('POST', '/accounts', JSON.stringify({ name, externalKey, currency: 'USD' }));
    if (r.data && typeof r.data.accountId === 'string') return r.data.accountId;
    if (r.location) {
      const m = /accounts\/([0-9a-f-]{36})/.exec(r.location);
      if (m?.[1]) return m[1];
    }
    const found = await this.findAccountByExternalKey(externalKey);
    if (found) return found;
    throw billingUnavailable();
  }

  private async bundlesForAccount(accountId: string): Promise<BundleJson[]> {
    const r = await this.request<BundleJson[]>('GET', `/accounts/${accountId}/bundles`);
    return r.data ?? [];
  }

  async findSubscription(workspaceSlug: string): Promise<{ accountId: string; subscriptionId: string; plan: string } | null> {
    const accountId = await this.findAccountByExternalKey(`rushes-ws-${workspaceSlug}`);
    if (!accountId) return null;
    const bundles = await this.bundlesForAccount(accountId);
    for (const b of bundles) {
      if (b.externalKey !== `rushes-seats-${workspaceSlug}`) continue;
      for (const s of b.subscriptions) {
        if (s.state === 'ACTIVE') {
          return { accountId, subscriptionId: s.subscriptionId, plan: s.planName };
        }
      }
    }
    return null;
  }

  async ensureAccountAndSubscription(
    workspaceSlug: string,
    workspaceName: string,
    plan: string,
  ): Promise<{ accountId: string; subscriptionId: string; plan: string }> {
    let accountId = await this.findAccountByExternalKey(`rushes-ws-${workspaceSlug}`);
    if (!accountId) {
      accountId = await this.createAccount(`rushes-ws-${workspaceSlug}`, workspaceName);
    }
    const bundles = await this.bundlesForAccount(accountId);
    let found: { subscriptionId: string; plan: string } | null = null;
    for (const b of bundles) {
      if (b.externalKey !== `rushes-seats-${workspaceSlug}`) continue;
      for (const s of b.subscriptions) {
        if (s.state === 'ACTIVE') {
          found = { subscriptionId: s.subscriptionId, plan: s.planName };
        }
      }
    }
    if (!found) {
      await this.request(
        'POST',
        '/subscriptions',
        JSON.stringify({
          accountId,
          bundleExternalKey: `rushes-seats-${workspaceSlug}`,
          externalKey: `rushes-seats-${workspaceSlug}`,
          planName: plan,
        }),
      );
      for (let i = 0; i < 20 && !found; i++) {
        const sub = await this.findSubscription(workspaceSlug);
        if (sub) {
          found = { subscriptionId: sub.subscriptionId, plan: sub.plan };
        } else {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      if (!found) throw billingUnavailable();
    }
    return { accountId, ...found };
  }

  async changePlan(subscriptionId: string, plan: string): Promise<void> {
    await this.request('PUT', `/subscriptions/${subscriptionId}`, JSON.stringify({ planName: plan }));
  }

  async readPlan(workspaceSlug: string): Promise<{ plan: string } | null> {
    const sub = await this.findSubscription(workspaceSlug);
    return sub ? { plan: sub.plan } : null;
  }

  async uploadCatalog(xml: string): Promise<void> {
    await this.request('POST', '/catalog', xml, 'text/xml');
  }

  async currentPlanNames(): Promise<string[]> {
    const r = await this.request<unknown>('GET', '/catalog');
    const data = r.data;
    if (!Array.isArray(data)) return [];
    return data
      .map((p) => (typeof p === 'object' && p !== null && 'name' in p ? String((p as { name: unknown }).name) : ''))
      .filter(Boolean);
  }
}
