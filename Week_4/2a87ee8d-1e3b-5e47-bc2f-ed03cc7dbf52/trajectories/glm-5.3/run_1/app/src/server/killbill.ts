/**
 * Kill Bill REST client. Only this file talks to Kill Bill.
 * Amounts are converted to integer cents exactly at this boundary.
 */
import type { Config } from './config.js';
import { CATALOG_XML } from './catalog.js';

export interface KbInvoiceItem {
  invoiceItemId: string;
  description: string | null;
  amount: number;
  itemType: string;
}

export interface KbInvoice {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  amount: number;
  balance: number;
  currency: string;
  status: string;
  items: KbInvoiceItem[];
}

export interface KbSubscriptionEvent {
  eventType: string;
  effectiveDate: string;
  plan: string | null;
}

export interface KbSubscription {
  subscriptionId: string;
  planName: string;
  state: string;
  chargedThroughDate: string | null;
  events: KbSubscriptionEvent[];
}

export interface KbAccount {
  accountId: string;
  externalKey: string;
  currency: string;
  timeZone: string;
}

function headers(cfg: Config, extra: Record<string, string> = {}): Record<string, string> {
  const basic = Buffer.from(`${cfg.killbill.username}:${cfg.killbill.password}`).toString('base64');
  return {
    Authorization: `Basic ${basic}`,
    // Kill Bill matches these header names case-sensitively.
    'X-Killbill-Apikey': cfg.killbill.apiKey,
    'X-Killbill-Apisecret': cfg.killbill.apiSecret,
    'X-Killbill-CreatedBy': 'lanternfold-rooms',
    'X-Killbill-Reason': 'app',
    ...extra,
  };
}

async function kbFetch<T>(cfg: Config, method: string, path: string, opts: {
  body?: unknown; contentType?: string; query?: Record<string, string | null>;
  timeoutMs?: number;
} = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 12000);
  try {
    let url = `${cfg.killbill.url}${path}`;
    if (opts.query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.query)) if (v !== null) qs.set(k, v);
      const s = qs.toString();
      if (s.length > 0) url = `${url}?${s}`;
    }
    let body: string | undefined;
    const hdrs = headers(cfg);
    if (opts.body !== undefined) {
      body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
      hdrs['Content-Type'] = opts.contentType ?? 'application/json';
    }
    const res = await fetch(url, { method, headers: hdrs, body, signal: controller.signal });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`killbill ${res.status}: ${text.slice(0, 400)}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return (text.length === 0 ? undefined : JSON.parse(text)) as T;
  } finally {
    clearTimeout(timer);
  }
}

export class KillBillClient {
  private cfg: Config;
  private tenantReady = false;
  private catalogReady = false;

  constructor(cfg: Config) {
    this.cfg = cfg;
  }

  /** The tenant and the catalog, made sure once per tenant (idempotent). */
  async ensureTenantAndCatalog(): Promise<void> {
    if (!this.tenantReady) {
      // a catalog read with these credentials succeeds only when the tenant exists
      try {
        await kbFetch<unknown[]>(this.cfg, 'GET', '/1.0/kb/catalog');
      } catch (e) {
        const err = e as Error & { status?: number };
        if (err.status === 401 || err.status === 404) {
          await kbFetch(this.cfg, 'POST', '/1.0/kb/tenants', {
            body: { apiKey: this.cfg.killbill.apiKey, apiSecret: this.cfg.killbill.apiSecret },
          });
        } else {
          throw e;
        }
      }
      this.tenantReady = true;
    }
    if (!this.catalogReady) {
      const catalog = await kbFetch<unknown[]>(this.cfg, 'GET', '/1.0/kb/catalog');
      if (!Array.isArray(catalog) || catalog.length === 0) {
        await kbFetch(this.cfg, 'POST', '/1.0/kb/catalog', { body: CATALOG_XML, contentType: 'text/xml' });
      }
      this.catalogReady = true;
    }
  }

  async getAccountByKey(key: string): Promise<KbAccount | null> {
    try {
      return await kbFetch<KbAccount>(this.cfg, 'GET', `/1.0/kb/accounts`, { query: { externalKey: key } });
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 404) return null;
      throw e;
    }
  }

  async createAccount(body: { externalKey: string; name: string; email: string; currency: string; timeZone: string }): Promise<KbAccount> {
    await kbFetch(this.cfg, 'POST', '/1.0/kb/accounts', { body });
    const acct = await this.getAccountByKey(body.externalKey);
    if (!acct) throw new Error('killbill account creation lost');
    return acct;
  }

  async getAccount(accountId: string): Promise<KbAccount> {
    return kbFetch<KbAccount>(this.cfg, 'GET', `/1.0/kb/accounts/${accountId}`);
  }

  async addExternalPaymentMethod(accountId: string): Promise<void> {
    const created = await kbFetch<{ paymentMethodId: string }>(this.cfg, 'POST', `/1.0/kb/accounts/${accountId}/paymentMethods`, {
      body: { accountId, pluginName: '__EXTERNAL_PAYMENT__', isDefault: true },
    });
    if (created?.paymentMethodId) {
      await kbFetch(this.cfg, 'PUT', `/1.0/kb/accounts/${accountId}/paymentMethods/${created.paymentMethodId}/setDefault`);
    }
  }

  async addAutoPayOffTag(accountId: string): Promise<void> {
    await kbFetch(this.cfg, 'POST', `/1.0/kb/accounts/${accountId}/tags`, {
      query: { tagDefId: '00000000-0000-0000-0000-000000000001' },
      body: [],
    });
  }

  async getSubscriptions(accountId: string): Promise<KbSubscription[]> {
    interface Bundle { subscriptions: KbSubscription[] }
    const bundles = await kbFetch<Bundle[]>(this.cfg, 'GET', `/1.0/kb/accounts/${accountId}/bundles`);
    return bundles?.flatMap((b) => b.subscriptions ?? []) ?? [];
  }

  async createSubscription(accountId: string, planName: string, externalKey: string): Promise<void> {
    await kbFetch(this.cfg, 'POST', '/1.0/kb/subscriptions', {
      body: { accountId, planName, externalKey },
    });
  }

  async changePlan(subscriptionId: string, planName: string): Promise<void> {
    await kbFetch(this.cfg, 'PUT', `/1.0/kb/subscriptions/${subscriptionId}`, { body: { planName } });
  }

  async getInvoicesWithItems(accountId: string): Promise<KbInvoice[]> {
    const metas = await kbFetch<Array<{ invoiceId: string; invoiceNumber: string; invoiceDate: string }>>(
      this.cfg, 'GET', `/1.0/kb/accounts/${accountId}/invoices`, { query: { withItems: 'false' } });
    const out: KbInvoice[] = [];
    for (const meta of metas ?? []) {
      out.push(await kbFetch<KbInvoice>(this.cfg, 'GET', `/1.0/kb/invoices/${meta.invoiceId}`));
    }
    return out;
  }

  async getInvoice(invoiceId: string): Promise<KbInvoice> {
    return kbFetch<KbInvoice>(this.cfg, 'GET', `/1.0/kb/invoices/${invoiceId}`);
  }

  /** Pay one invoice with the account's default (external) payment method. */
  async payInvoice(accountId: string, invoiceId: string, amountCents: number, paymentKey: string): Promise<void> {
    const amount = amountCents / 100;
    await kbFetch(this.cfg, 'POST', `/1.0/kb/invoices/${invoiceId}/payments`, {
      query: {
        externalPayment: 'true',
        paymentMethodId: 'null',
        paymentId: 'null',
        paymentExternalKey: paymentKey,
        transactionExternalKey: `${paymentKey}-tx`,
        currency: 'EUR',
        transactionType: 'PURCHASE',
      },
      body: {
        purchasedAmount: amount,
        currency: 'EUR',
        paymentExternalKey: paymentKey,
        accountId,
        targetInvoiceId: invoiceId,
      },
    });
  }

  /** One external charge, invoiced at once. */
  async createExternalCharge(accountId: string, amountCents: number, description: string): Promise<{ invoiceId: string; invoiceItemId: string }> {
    const res = await kbFetch<Array<{ invoiceId: string; invoiceItemId: string }>>(this.cfg, 'POST', `/1.0/kb/invoices/charges/${accountId}`, {
      query: { autoCommit: 'true' },
      body: [{ accountId, amount: amountCents / 100, currency: 'EUR', description }],
    });
    const item = res?.[0];
    if (!item) throw new Error('killbill charge lost');
    return item;
  }
}
