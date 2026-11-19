import type { Config } from './config.js';
import { DAYBOOK_PLAN } from '../src-shared/constants.js';

export type KillBillFailure = 'unreachable';

export class KillBillError extends Error {
  constructor(message: string, readonly failure: KillBillFailure = 'unreachable') {
    super(message);
  }
}

const TIMEOUT_MS = 5_000;

interface KbRequest {
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
  readonly query?: Record<string, string>;
  readonly accept?: string;
}

interface KbResult {
  readonly status: number;
  readonly body: unknown;
  readonly location: string | null;
}

/**
 * Calls the Kill Bill API. Network failures and timeouts throw KillBillError;
 * HTTP answers are returned for the caller to interpret.
 */
export class KillBillClient {
  private readonly cfg: Config['killbill'];
  private readonly serverId: string;
  private catalogChecked = false;

  constructor(cfg: Config['killbill'], serverId: string) {
    this.cfg = cfg;
    this.serverId = serverId;
  }

  private async call(req: KbRequest): Promise<KbResult> {
    const base = this.cfg.url.replace(/\/$/, '');
    const url = new URL(base + req.path);
    for (const [k, v] of Object.entries(req.query ?? {})) url.searchParams.set(k, v);
    const headers: Record<string, string> = {
      Authorization: 'Basic ' + Buffer.from(`${this.cfg.username}:${this.cfg.password}`).toString('base64'),
      'X-Killbill-ApiKey': this.cfg.apiKey,
      'X-Killbill-ApiSecret': this.cfg.apiSecret,
      'X-Killbill-CreatedBy': 'tidemark-daybook',
      Accept: req.accept ?? 'application/json',
    };
    let bodyText: string | undefined;
    if (req.body !== undefined) {
      bodyText = JSON.stringify(req.body);
      headers['Content-Type'] = 'application/json';
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { method: req.method, headers, body: bodyText, signal: controller.signal });
      const text = await res.text();
      let parsed: unknown = null;
      if (text.length > 0) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }
      return { status: res.status, body: parsed, location: res.headers.get('location') };
    } catch {
      throw new KillBillError('Kill Bill is unreachable');
    } finally {
      clearTimeout(timer);
    }
  }

  async ping(): Promise<boolean> {
    if (this.cfg.url === '') return false;
    try {
      await this.call({ method: 'GET', path: '/1.0/kb/tenants' });
      return true;
    } catch {
      return false;
    }
  }

  /** Makes sure the tenant catalog holds the Daybook seat plan; never replaces one that has it. */
  async ensureCatalog(): Promise<void> {
    if (this.catalogChecked) return;
    const xml = await this.call({ method: 'GET', path: '/1.0/kb/catalog/xml', accept: 'text/xml' });
    if (typeof xml.body === 'string' && xml.body.includes(DAYBOOK_PLAN.planName)) {
      this.catalogChecked = true;
      return;
    }
    const created = await this.call({
      method: 'POST',
      path: '/1.0/kb/catalog/simplePlan',
      body: {
        planId: DAYBOOK_PLAN.planName,
        productName: DAYBOOK_PLAN.product,
        productCategory: 'BASE',
        currency: DAYBOOK_PLAN.currency,
        billingPeriod: 'MONTHLY',
        amount: Number(DAYBOOK_PLAN.monthlyPrice),
        trialLength: DAYBOOK_PLAN.trialPhaseDays,
        trialTimeUnit: 'DAYS',
      },
    });
    if (created.status >= 400) throw new KillBillError('catalog registration failed');
    this.catalogChecked = true;
  }

  /** Creates the workspace account if it does not exist. */
  async ensureAccount(workspaceId: string, workspaceName: string, ownerEmail: string): Promise<void> {
    const found = await this.call({ method: 'GET', path: '/1.0/kb/accounts', query: { externalKey: workspaceId } });
    if (found.status !== 404) return;
    const created = await this.call({
      method: 'POST',
      path: '/1.0/kb/accounts',
      body: {
        externalKey: workspaceId,
        name: workspaceName,
        email: ownerEmail,
        currency: DAYBOOK_PLAN.currency,
        locale: 'en-GB',
      },
    });
    if (created.status >= 400 && created.status !== 409) {
      const detail = typeof created.body === 'object' && created.body !== null ? JSON.stringify(created.body).slice(0, 200) : String(created.body).slice(0, 200);
      throw new KillBillError(`account creation failed (${created.status}): ${detail}`);
    }
  }

  /** Creates a seat subscription in its own bundle if it does not exist. */
  async ensureSeat(workspaceId: string, memberId: string): Promise<void> {
    const bundleKey = `${workspaceId}:${memberId}`;
    if (await this.seatSubscriptionId(workspaceId, bundleKey) !== null) return;
    const account = await this.call({ method: 'GET', path: '/1.0/kb/accounts', query: { externalKey: workspaceId } });
    const body = account.body as { accountId?: string } | null;
    const accountId = body?.accountId;
    if (typeof accountId !== 'string' || accountId.length === 0) {
      throw new KillBillError('Kill Bill account is missing');
    }
    const created = await this.call({
      method: 'POST',
      path: '/1.0/kb/subscriptions',
      body: {
        bundleExternalKey: bundleKey,
        externalKey: bundleKey,
        accountId,
        planName: DAYBOOK_PLAN.planName,
        startDate: new Date().toISOString().slice(0, 10),
        phaseType: 'TRIAL',
      },
    });
    if (created.status >= 400 && created.status !== 409) {
      const detail = typeof created.body === 'object' && created.body !== null ? JSON.stringify(created.body).slice(0, 160) : String(created.body).slice(0, 160);
      throw new KillBillError(`seat creation failed (${created.status}): ${detail}`);
    }
  }

  /** The active Daybook seat subscription for a bundle key, or null. */
  private async seatSubscriptionId(workspaceId: string, bundleKey: string): Promise<string | null> {
    const account = await this.call({ method: 'GET', path: '/1.0/kb/accounts', query: { externalKey: workspaceId } });
    const accountId = (account.body as { accountId?: string } | null)?.accountId;
    if (typeof accountId !== 'string' || accountId.length === 0) return null;
    const bundles = await this.call({ method: 'GET', path: `/1.0/kb/accounts/${accountId}/bundles` });
    const body = bundles.body;
    const list = Array.isArray(body) ? body : [body];
    for (const bundle of list) {
      const b = bundle as { externalKey?: string; subscriptions?: Array<{ subscriptionId?: string; state?: string; productName?: string; planName?: string }> };
      if (b.externalKey !== bundleKey) continue;
      const sub = (b.subscriptions ?? []).find((s) => (s.state === 'ACTIVE' || s.state === 'BLOCKED') && (s.planName === DAYBOOK_PLAN.planName || s.productName === DAYBOOK_PLAN.product));
      if (sub?.subscriptionId !== undefined) return sub.subscriptionId;
    }
    return null;
  }

  /** Cancels a member's seat subscription immediately. */
  async cancelSeat(workspaceId: string, memberId: string): Promise<void> {
    const bundleKey = `${workspaceId}:${memberId}`;
    const subscriptionId = await this.seatSubscriptionId(workspaceId, bundleKey);
    if (subscriptionId === null) return;
    const cancelled = await this.call({
      method: 'DELETE',
      path: `/1.0/kb/subscriptions/${subscriptionId}`,
      query: { callCompletion: 'true', useRequestedDateForBilling: 'true', requestedDate: new Date().toISOString().slice(0, 10) },
    });
    if (cancelled.status >= 400) {
      throw new KillBillError(`seat cancellation failed (${cancelled.status})`);
    }
  }

  /** The number of active seat subscriptions for a workspace account. */
  async activeSeats(workspaceId: string): Promise<number> {
    try {
      const res = await this.call({ method: 'GET', path: `/1.0/kb/accounts/${workspaceId}/bundles` });
      let count = 0;
      const body = res.body;
      if (Array.isArray(body)) {
        for (const bundle of body) {
          const subs = (bundle as { subscriptions?: Array<{ state?: string; productName?: string }> }).subscriptions;
          if (Array.isArray(subs)) {
            for (const s of subs) {
              if (s.state === 'ACTIVE' && s.productName === DAYBOOK_PLAN.product) count++;
            }
          }
        }
      }
      return count;
    } catch {
      throw new KillBillError('Kill Bill is unreachable');
    }
  }
}


