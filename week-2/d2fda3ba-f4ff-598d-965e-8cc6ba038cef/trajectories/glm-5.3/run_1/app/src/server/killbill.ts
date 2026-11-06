import { request } from 'http';
import { config } from './config';

export interface KbSubscriptionInfo {
  subscription_id: string | null;
  entitlement_state: string | null;
  billing_end_date: string | null;
}

export interface KbAccountInfo {
  exists: boolean;
  account_id: string | null;
}

export type KbResult<T> = { ok: true; value: T } | { ok: false; error: Error };

async function req<T>(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const url = new URL(config.killbill.url + path);
  const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  return new Promise<T>((resolve, reject) => {
    const r = request(
      {
        host: url.hostname,
        port: url.port || 80,
        path: url.pathname + url.search,
        method,
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64'),
          'X-Killbill-ApiKey': config.killbill.apiKey,
          'X-Killbill-ApiSecret': config.killbill.apiSecret,
          'X-Killbill-CreatedBy': 'cairn',
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
          ...extraHeaders,
        },
        timeout: 8000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode ?? 0;
          if (status >= 400) {
            const err = new Error(`killbill ${status} ${text.slice(0, 200)}`) as Error & { status?: number };
            err.status = status;
            reject(err);
            return;
          }
          if (status === 204 || text === '') resolve(undefined as T);
          else {
            try { resolve(JSON.parse(text) as T); } catch { resolve(undefined as T); }
          }
        });
      },
    );
    r.on('timeout', () => r.destroy(new Error('killbill timeout')));
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const OK = async <T>(p: Promise<T>): Promise<KbResult<T>> => {
  try {
    return { ok: true, value: await p };
  } catch (e) {
    return { ok: false, error: e as Error };
  }
};

interface SubscriptionBody {
  subscriptionId?: string;
  externalKey?: string;
  state?: string;
  cancelledDate?: string | null;
  chargedThroughDate?: string | null;
}

const dateOnly = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return m ? m[1] : null;
};

export const kb = {
  health: async (): Promise<KbResult<unknown>> => OK(req('GET', '/1.0/healthcheck')),

  accountInfo: async (accountId: string): Promise<KbResult<KbAccountInfo>> => {
    const r = await OK(req<Record<string, unknown>>('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(accountId)}`));
    if (!r.ok) {
      const status = (r.error as { status?: number }).status;
      if (status === 404) return { ok: true, value: { exists: false, account_id: null } };
      return { ok: false, error: r.error };
    }
    const id = r.value?.accountId;
    return { ok: true, value: { exists: id !== undefined, account_id: id ? String(id) : null } };
  },

  createAccount: async (
    accountId: string, name: string, email: string, timeZone: string,
  ): Promise<KbResult<KbAccountInfo>> => {
    const r = await OK(
      req('POST', '/1.0/kb/accounts', {
        externalKey: accountId, name, email, currency: 'USD', timeZone,
      }),
    );
    if (!r.ok) return { ok: false, error: r.error };
    return kb.accountInfo(accountId);
  },

  ensureAccount: async (
    accountId: string, name: string, email: string, timeZone: string,
  ): Promise<KbResult<KbAccountInfo>> => {
    const info = await kb.accountInfo(accountId);
    if (!info.ok) return info;
    if (info.value.exists) return info;
    return kb.createAccount(accountId, name, email, timeZone);
  },

  /** The catalog is the two monthly plans, created through simplePlan. A plan that already exists counts as present. */
  ensureCatalog: async (): Promise<KbResult<unknown>> => {
    const plans = [
      { planId: 'cairn-sync-monthly', productName: 'CairnSync', amount: 6.0 },
      { planId: 'cairn-publish-monthly', productName: 'CairnPublish', amount: 9.0 },
    ];
    for (const plan of plans) {
      const r = await OK(
        req('POST', '/1.0/kb/catalog/simplePlan', {
          planId: plan.planId, productName: plan.productName, productCategory: 'BASE',
          currency: 'USD', billingPeriod: 'MONTHLY', amount: plan.amount,
          trialLength: 0, trialTimeUnit: 'UNLIMITED',
        }),
      );
      if (!r.ok) {
        const status = (r.error as { status?: number }).status;
        if (status === 400 || status === 409) continue;
        return r;
      }
    }
    return { ok: true, value: undefined };
  },

  subscribe: async (accountId: string, kbAccountId: string, addon: 'sync' | 'publish'): Promise<KbResult<unknown>> => {
    const plan = addon === 'sync' ? 'cairn-sync-monthly' : 'cairn-publish-monthly';
    const key = `${accountId}-${addon}`;
    return OK(
      req('POST', '/1.0/kb/subscriptions', {
        accountId: kbAccountId,
        externalKey: key,
        bundleExternalKey: key,
        planName: plan,
      }),
    );
  },

  getSubscriptionByExternalKey: async (
    accountId: string, addon: 'sync' | 'publish',
  ): Promise<KbResult<KbSubscriptionInfo>> => {
    const key = `${accountId}-${addon}`;
    const r = await OK(req<SubscriptionBody>('GET', `/1.0/kb/subscriptions?externalKey=${encodeURIComponent(key)}`));
    if (!r.ok) {
      const status = (r.error as { status?: number }).status;
      if (status === 404) return { ok: true, value: { subscription_id: null, entitlement_state: null, billing_end_date: null } };
      return { ok: false, error: r.error };
    }
    const sub = r.value;
    return {
      ok: true,
      value: {
        subscription_id: sub?.subscriptionId ? String(sub.subscriptionId) : null,
        entitlement_state: sub?.state ?? null,
        // the billing end date is the cancelled date; chargedThrough is just the next invoice date
        billing_end_date: dateOnly(sub?.cancelledDate),
      },
    };
  },

  cancelSubscription: async (subscriptionId: string): Promise<KbResult<unknown>> => {
    return OK(
      req('DELETE', `/1.0/kb/subscriptions/${subscriptionId}?useRequestedDateForBilling=true&billingPolicy=END_OF_TERM&entitlementPolicy=END_OF_TERM&callCompletion=false`, undefined, {
        'X-Killbill-Reason': 'subscriber-cancelled',
      }),
    );
  },
};
