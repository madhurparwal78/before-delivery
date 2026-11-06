import type { Config } from '../config.js';

// Kill Bill client. Real HTTP calls; health probed by the background task.

export interface KillbillTransaction {
  transactionId: string;
  transactionExternalKey: string;
  transactionType: string;
  amount: number;
  currency: string;
  status: string;
  processedAmount: number | null;
}

export interface KillbillPayment {
  paymentId: string;
  accountId: string;
  transactions: KillbillTransaction[];
  refundedAmount: number;
}

export class KillbillError extends Error {
  constructor(public kind: 'unreachable' | 'refused', public status: number) {
    super(kind);
  }
}

export class Killbill {
  constructor(private config: Config) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const c = this.config;
    const auth = Buffer.from(`${c.killbillUsername}:${c.killbillPassword}`).toString('base64');
    return {
      'Authorization': `Basic ${auth}`,
      'X-Killbill-ApiKey': c.killbillApiKey,
      'X-Killbill-ApiSecret': c.killbillApiSecret,
      'X-Killbill-CreatedBy': 'ommezwaai-feeler',
      'Content-Type': 'application/json',
      ...extra,
    };
  }

  private async request(method: string, path: string, body?: unknown, timeoutMs = 10000): Promise<{ status: number; json: unknown; location: string | null }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const init: RequestInit = { method, headers: this.headers(), signal: controller.signal };
      if (body !== undefined) init.body = JSON.stringify(body);
      const res = await fetch(`${this.config.killbillUrl}${path}`, init);
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { status: res.status, json, location: res.headers.get('location') };
    } catch {
      throw new KillbillError('unreachable', 0);
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<boolean> {
    try {
      const r = await this.request('GET', '/1.0/kb/healthcheck', undefined, 4000);
      return r.status < 500;
    } catch {
      return false;
    }
  }

  async accountByExternalKey(externalKey: string): Promise<string | null> {
    try {
      const r = await this.request('GET', `/1.0/kb/accounts/search/${encodeURIComponent(externalKey)}`, undefined, 6000);
      if (r.status !== 200) return null;
      const list = r.json as { accountId: string }[];
      return list?.[0]?.accountId ?? null;
    } catch {
      throw new KillbillError('unreachable', 0);
    }
  }

  async createAccount(externalKey: string, name: string, email: string): Promise<string> {
    const r = await this.request('POST', '/1.0/kb/accounts', { name, email, currency: 'EUR', externalKey });
    if (r.status >= 500) throw new KillbillError('unreachable', r.status);
    if (r.status >= 400) throw new KillbillError('refused', r.status);
    const loc = r.json as { accountId?: string } | null;
    if (loc?.accountId) return loc.accountId;
    const found = await this.accountByExternalKey(externalKey);
    if (found) return found;
    throw new KillbillError('refused', r.status);
  }

  async addExternalPaymentMethod(accountId: string): Promise<void> {
    const r = await this.request(
      'POST',
      `/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`,
      { pluginName: '__EXTERNAL_PAYMENT__', isDefault: true },
    );
    if (r.status >= 500) throw new KillbillError('unreachable', r.status);
    if (r.status >= 400) {
      const msg = (r.json as { message?: string })?.message ?? '';
      if (!msg.includes('already exists')) throw new KillbillError('refused', r.status);
    }
  }

  async purchase(accountId: string, euros: string, externalKey: string): Promise<{ paymentId: string; transactionId: string; status: string }> {
    const r = await this.request('POST', `/1.0/kb/accounts/${accountId}/payments`, {
      transactionType: 'PURCHASE',
      amount: euros,
      currency: 'EUR',
      transactionExternalKey: externalKey,
    }, 15000);
    if (r.status >= 500) throw new KillbillError('unreachable', r.status);
    if (r.status >= 400) {
      // A retry with the same external key adopts whichever transaction exists.
      const msg = (r.json as { message?: string } | null)?.message ?? '';
      if (msg.includes('already exists')) {
        const adopted = await this.findTransaction(accountId, externalKey);
        if (adopted) return adopted;
      }
      throw new KillbillError('refused', r.status);
    }
    // The purchase response body is empty; the payment is named by Location.
    const paymentId = r.location?.match(/\/payments\/([0-9a-f-]+)/)?.[1]
      ?? (r.json as { paymentId?: string } | null)?.paymentId
      ?? null;
    if (!paymentId) throw new KillbillError('refused', r.status);
    const payment = await this.getPayment(paymentId);
    const txn = payment?.transactions.find((t) => t.transactionExternalKey === externalKey);
    return {
      paymentId,
      transactionId: txn?.transactionId ?? '',
      status: txn?.status ?? 'UNKNOWN',
    };
  }

  // Find the payment and transaction carrying this external key on the account.
  private async findTransaction(accountId: string, externalKey: string): Promise<{ paymentId: string; transactionId: string; status: string } | null> {
    try {
      const r = await this.request('GET', `/1.0/kb/accounts/${accountId}/payments`, undefined, 8000);
      if (r.status !== 200) return null;
      const payments = r.json as KillbillPayment[];
      for (const p of payments ?? []) {
        const txn = p.transactions?.find((t) => t.transactionExternalKey === externalKey);
        if (txn) {
          return { paymentId: p.paymentId, transactionId: txn.transactionId, status: txn.status };
        }
      }
      return null;
    } catch {
      throw new KillbillError('unreachable', 0);
    }
  }

  async refundPayment(paymentId: string, euros: string, externalKey: string): Promise<void> {
    const r = await this.request('POST', `/1.0/kb/payments/${paymentId}/refunds`, {
      amount: euros,
      currency: 'EUR',
      transactionExternalKey: externalKey,
    }, 15000);
    if (r.status >= 500) throw new KillbillError('unreachable', r.status);
    if (r.status >= 400) throw new KillbillError('refused', r.status);
  }

  async getPayment(paymentId: string): Promise<KillbillPayment | null> {
    try {
      const r = await this.request('GET', `/1.0/kb/payments/${paymentId}`, undefined, 6000);
      if (r.status === 404) return null;
      if (r.status >= 500) throw new KillbillError('unreachable', r.status);
      if (r.status >= 400) return null;
      return r.json as KillbillPayment;
    } catch (e) {
      if (e instanceof KillbillError) throw e;
      throw new KillbillError('unreachable', 0);
    }
  }

  async registerCallback(url: string): Promise<void> {
    const r = await this.request('POST', `/1.0/kb/tenants/registerNotificationCallback?cb=${encodeURIComponent(url)}`, undefined);
    if (r.status >= 500) throw new KillbillError('unreachable', r.status);
    if (r.status >= 400) throw new KillbillError('refused', r.status);
  }

  async listCallbacks(): Promise<string[]> {
    const r = await this.request('GET', '/1.0/kb/tenants/registerNotificationCallback');
    if (r.status >= 500) throw new KillbillError('unreachable', r.status);
    if (r.status >= 400) throw new KillbillError('refused', r.status);
    const j = r.json as { values?: string[] };
    return j?.values ?? [];
  }
}
