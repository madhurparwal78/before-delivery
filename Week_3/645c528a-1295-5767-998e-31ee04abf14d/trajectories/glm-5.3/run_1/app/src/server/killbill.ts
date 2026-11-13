import type { Config } from './config.js';
import { logger } from './logger.js';

export interface KillBillPayment {
  paymentId: string;
}

export interface KillBillPort {
  purchase(externalKey: string, email: string, amountUsd: string): Promise<KillBillPayment | null>;
  reachable(): Promise<boolean>;
}

const TIMEOUT_MS = 5_000;

export function createKillBillPort(config: Config): KillBillPort {
  const auth = 'Basic ' + Buffer.from(`${config.killbillUsername}:${config.killbillPassword}`).toString('base64');
  const baseHeaders: Record<string, string> = {
    Authorization: auth,
    'X-Killbill-ApiKey': config.killbillApiKey,
    'X-Killbill-ApiSecret': config.killbillApiSecret,
    'X-Killbill-CreatedBy': 'long-rail-headstring',
    'Content-Type': 'application/json',
  };

  async function fetchJson(path: string, init: RequestInit): Promise<{ status: number; json: unknown } | null> {
    if (!config.killbillUrl) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${config.killbillUrl}${path}`, { ...init, signal: controller.signal, headers: { ...baseHeaders, ...((init.headers as Record<string, string>) ?? {}) } });
      const text = await res.text();
      let json: unknown = null;
      if (text) {
        try { json = JSON.parse(text); } catch { json = null; }
      }
      return { status: res.status, json };
    } catch (err) {
      logger.warn(`killbill request failed for ${path}: ${(err as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function findAccountId(externalKey: string): Promise<string | null> {
    const bySearch = await fetchJson(`/1.0/kb/accounts/pagination?searchKey=${encodeURIComponent(externalKey)}`, { method: 'GET' });
    if (bySearch) {
      const list = (bySearch.json as { accountId?: string; externalKey?: string }[] | null) ?? [];
      const hit = list.find((row) => row.externalKey === externalKey);
      if (hit?.accountId) return hit.accountId;
    }
    return null;
  }

  async function ensureAccount(externalKey: string, email: string): Promise<string | null> {
    const existing = await findAccountId(externalKey);
    if (existing) return existing;
    const created = await fetchJson('/1.0/kb/accounts', {
      method: 'POST',
      body: JSON.stringify({ name: email, email, currency: 'USD', externalKey }),
    });
    if (!created) return null;
    if (created.status !== 201) return null;
    return await findAccountId(externalKey);
  }

  return {
    async purchase(externalKey: string, email: string, amountUsd: string) {
      const accountId = await ensureAccount(externalKey, email);
      if (!accountId) return null;

      let methods = await fetchJson(`/1.0/kb/accounts/${accountId}/paymentMethods`, { method: 'GET' });
      if (!methods) return null;
      let list = (methods.json as { paymentMethodId?: string }[] | null) ?? [];
      if (list.length === 0) {
        const created = await fetchJson(`/1.0/kb/accounts/${accountId}/paymentMethods`, {
          method: 'POST',
          body: JSON.stringify({ pluginName: '__EXTERNAL_PAYMENT__', isDefault: true }),
        });
        if (!created || created.status >= 300) return null;
        methods = await fetchJson(`/1.0/kb/accounts/${accountId}/paymentMethods`, { method: 'GET' });
        if (!methods) return null;
        list = (methods.json as { paymentMethodId?: string }[] | null) ?? [];
      }
      let paymentMethodId = list[0]?.paymentMethodId;
      if (!paymentMethodId) return null;

      const account = await fetchJson(`/1.0/kb/accounts/${accountId}`, { method: 'GET' });
      const defaultId = (account?.json as { paymentMethodId?: string } | null)?.paymentMethodId;
      if (!defaultId) {
        await fetchJson(`/1.0/kb/accounts/${accountId}/paymentMethods/${paymentMethodId}/setDefault`, { method: 'PUT' });
      } else {
        paymentMethodId = defaultId;
      }

      const payment = await fetchJson(`/1.0/kb/accounts/${accountId}/payments`, {
        method: 'POST',
        body: JSON.stringify({ transactionType: 'PURCHASE', amount: amountUsd, currency: 'USD' }),
      });
      if (!payment || payment.status !== 201) return null;
      const list2 = await fetchJson(`/1.0/kb/accounts/${accountId}/payments`, { method: 'GET' });
      const payments = ((list2?.json as { paymentId?: string; transactions?: { status?: string; amount?: number }[]; purchasedAmount?: number }[] | null) ?? []);
      // The newest successful PURCHASE for this amount is this purchase.
      const match = payments.find((p) => (p.purchasedAmount ?? 0) === Number(amountUsd)
        && (p.transactions ?? []).some((tx) => tx.status === 'SUCCESS'));
      if (!match) return null;
      return match.paymentId ? { paymentId: match.paymentId } : null;
    },

    async reachable() {
      if (!config.killbillUrl) return false;
      const res = await fetchJson('/1.0/kb/accounts/pagination', { method: 'GET' });
      return res !== null;
    },
  };
}
