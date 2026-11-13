import type { Config } from '../config.js';

export interface KbInvoiceItem {
  description: string;
  amountCents: number;
  startDate: string;
  endDate?: string | null;
}

export interface KbInvoice {
  invoiceId: string;
  invoiceNumber: string;
  amountCents: number;
  balanceCents: number;
  status: string;
  items: KbInvoiceItem[];
}

export class KillBillError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export class KillBillUnavailable extends Error {}

export class KillBill {
  constructor(private cfg: Config) {}

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      authorization: 'Basic ' + Buffer.from(`${this.cfg.killbillUsername}:${this.cfg.killbillPassword}`).toString('base64'),
      'x-killbill-apikey': this.cfg.killbillApiKey,
      'x-killbill-apisecret': this.cfg.killbillApiSecret,
      'x-killbill-createdby': 'spindrift-app',
      ...extra,
    };
  }

  async available(): Promise<boolean> {
    // The tenant lookup doubles as the health probe in this deployment.
    try {
      const res = await fetch(
        `${this.cfg.killbillUrl}/1.0/kb/tenants?apiKey=${encodeURIComponent(this.cfg.killbillApiKey)}`,
        { headers: this.headers(), signal: AbortSignal.timeout(3000) },
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  async ensureTenant(): Promise<void> {
    const res = await fetch(`${this.cfg.killbillUrl}/1.0/kb/tenants?apiKey=${encodeURIComponent(this.cfg.killbillApiKey)}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new KillBillUnavailable('tenant lookup failed');
  }

  /** Uploads the maintenance catalog if absent, idempotently at every boot. */
  async ensureCatalog(): Promise<void> {
    const cat = await this.callJson<Array<{ products?: Array<{ plans?: Array<{ name: string }> }> }>>('catalog', 'GET');
    const plans = new Set<string>();
    for (const version of cat ?? []) {
      for (const product of version.products ?? []) {
        for (const plan of product.plans ?? []) plans.add(plan.name);
      }
    }
    const needed: Array<[string, number]> = [
      ['maintenance-essential-monthly', 24000],
      ['maintenance-priority-monthly', 48000],
    ];
    for (const [planId, amount] of needed) {
      if (plans.has(planId)) continue;
      const res = await this.request('catalog/simplePlan', 'POST', {
        planId,
        productName: 'Maintenance',
        productCategory: 'BASE',
        currency: 'USD',
        amount,
        billingPeriod: 'MONTHLY',
      });
      if (!res.ok) throw new KillBillUnavailable(`catalog upload failed ${res.status}`);
    }
  }

  private async request(path: string, method: string, body?: unknown, params?: Record<string, string>, timeoutMs = 10_000): Promise<Response> {
    const url = new URL(`${this.cfg.killbillUrl}/1.0/kb/${path}`);
    for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
    let res: Response;
    try {
      const init: RequestInit = {
        method,
        headers: this.headers(body === undefined ? undefined : { 'content-type': 'application/json' }),
        signal: AbortSignal.timeout(timeoutMs),
      };
      if (body !== undefined) init.body = JSON.stringify(body);
      res = await fetch(url, init);
    } catch {
      throw new KillBillUnavailable('killbill unreachable');
    }
    if (res.status >= 502) throw new KillBillUnavailable(`killbill ${res.status}`);
    return res;
  }

  private async callJson<T>(path: string, method: string, body?: unknown, params?: Record<string, string>): Promise<T> {
    const res = await this.request(path, method, body, params);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new KillBillError(res.status, text.slice(0, 300));
    }
    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  async ensureAccount(externalKey: string, name: string, email: string): Promise<string> {
    const found = await this.callJson<{ accountId: string }>(`accounts?externalKey=${encodeURIComponent(externalKey)}`, 'GET').catch(() => undefined);
    if (found?.accountId) return found.accountId;
    const res = await this.request('accounts', 'POST', { name, email, currency: 'USD', externalKey });
    if (!res.ok) throw new KillBillError(res.status, await res.text().catch(() => ''));
    const location = res.headers.get('location');
    if (location) {
      const id = location.split('/').pop() ?? '';
      if (id) return id;
    }
    const again = await this.callJson<{ accountId: string }>(`accounts?externalKey=${encodeURIComponent(externalKey)}`, 'GET');
    if (!again?.accountId) throw new KillBillUnavailable('account not created');
    return again.accountId;
  }

  async createInvoice(accountId: string, title: string, label: string, subtotalCents: number, taxCents: number, targetDate: string): Promise<KbInvoice> {
    const res = await this.request(`invoices/charges/${accountId}`, 'POST', [
      { description: `${title} — ${label} — work`, amount: subtotalCents, currency: 'USD' },
      { description: `${title} — ${label} — sales tax`, amount: taxCents, currency: 'USD' },
    ], { autoCommit: 'true' });
    if (!res.ok) throw new KillBillError(res.status, await res.text().catch(() => ''));
    const itemsRaw = (await res.json()) as Array<{ invoiceId: string }>;
    const invoiceId = itemsRaw[0]?.invoiceId ?? '';
    return this.getInvoice(invoiceId);
  }

  async getInvoice(invoiceId: string): Promise<KbInvoice> {
    const inv = await this.callJson<{ invoiceId: string; invoiceNumber: string; amount: number; balance: number; status: string; items?: Array<{ description: string; amount: number; startDate: string; endDate?: string | null }> }>(`invoices/${invoiceId}`, 'GET');
    return {
      invoiceId: inv.invoiceId,
      invoiceNumber: String(inv.invoiceNumber),
      amountCents: Math.round(inv.amount),
      balanceCents: Math.round(inv.balance),
      status: inv.status,
      items: (inv.items ?? []).map((i) => ({
        description: i.description,
        amountCents: Math.round(i.amount),
        startDate: i.startDate,
        endDate: i.endDate ?? null,
      })),
    };
  }

  async payInvoice(accountId: string, invoiceId: string, amountCents: number, transactionExternalKey: string, paymentExternalKey: string): Promise<{ paymentId: string }> {
    const res = await this.request(`invoices/${invoiceId}/payments`, 'POST', {
      accountId,
      targetInvoiceId: invoiceId,
      purchasedAmount: amountCents,
      currency: 'USD',
      paymentExternalKey,
    }, { externalPayment: 'true', paymentExternalKey, transactionExternalKey });
    if (!res.ok) throw new KillBillError(res.status, await res.text().catch(() => ''));
    const bodyText = await res.text().catch(() => '');
    if (bodyText) {
      try {
        const parsed = JSON.parse(bodyText) as { paymentId?: string };
        if (parsed.paymentId) return { paymentId: parsed.paymentId };
      } catch {
        // 201 with empty body: fall through to the lookup.
      }
    }
    const found = await this.findPaymentByExternalKey(paymentExternalKey);
    if (found) return { paymentId: found.paymentId };
    const location = res.headers.get('location');
    if (location) return { paymentId: location.split('/').pop() ?? '' };
    throw new KillBillUnavailable('payment id unavailable');
  }

  async findPaymentByExternalKey(paymentExternalKey: string): Promise<{ paymentId: string; amount: number; status: string } | null> {
    const found = await this.callJson<{ paymentId: string; purchasedAmount: number; transactions?: Array<{ status: string; transactionExternalKey?: string }> }>(`payments?externalKey=${encodeURIComponent(paymentExternalKey)}`, 'GET').catch(() => undefined);
    if (!found?.paymentId) return null;
    const status = found.transactions?.[0]?.status ?? 'SUCCESS';
    return { paymentId: found.paymentId, amount: found.purchasedAmount, status };
  }

  /** Finds a payment whose transaction carries the given external key. */
  async findPaymentByTransactionKey(transactionExternalKey: string): Promise<{ paymentId: string; amount: number; status: string } | null> {
    const res = await this.request(`payments?externalKey=${encodeURIComponent(transactionExternalKey)}`, 'GET');
    if (!res.ok) return null;
    const found = (await res.json().catch(() => null)) as { paymentId: string; purchasedAmount: number; transactions?: Array<{ status: string; transactionExternalKey?: string }> } | null;
    if (!found?.paymentId) return null;
    const tx = found.transactions?.find((t) => t.transactionExternalKey === transactionExternalKey);
    if (!tx) return null;
    return { paymentId: found.paymentId, amount: found.purchasedAmount, status: tx.status };
  }

  async createSubscription(accountId: string, planId: string, externalKey: string): Promise<{ subscriptionId: string }> {
    // A subscription with this external key may already exist from an earlier
    // attempt whose database write did not land; it is reused.
    const existing = await this.findSubscriptionByExternalKey(externalKey);
    if (existing) return { subscriptionId: existing.subscriptionId };
    const res = await this.request('subscriptions', 'POST', { accountId, planName: planId, externalKey });
    if (!res.ok) throw new KillBillError(res.status, await res.text().catch(() => ''));
    const found = await this.findSubscriptionByExternalKey(externalKey);
    if (!found) throw new KillBillUnavailable('subscription not created');
    return { subscriptionId: found.subscriptionId };
  }

  async findSubscriptionByExternalKey(externalKey: string): Promise<{ subscriptionId: string; planName: string; chargedThroughDate: string | null; state: string } | null> {
    // Kill Bill answers with a single subscription object for a unique external key.
    const found = await this.callJson<{ subscriptionId: string; planName: string; chargedThroughDate: string | null; state: string } | Array<{ subscriptionId: string; planName: string; chargedThroughDate: string | null; state: string }>>(`subscriptions?externalKey=${encodeURIComponent(externalKey)}`, 'GET').catch(() => undefined);
    if (!found) return null;
    if (Array.isArray(found)) return found[0] ?? null;
    return found;
  }

  async changePlan(subscriptionId: string, planId: string, requestedDate: string): Promise<void> {
    const res = await this.request(`subscriptions/${subscriptionId}`, 'PUT', { planName: planId }, { billingPolicy: 'IMMEDIATE' });
    if (!res.ok) throw new KillBillError(res.status, await res.text().catch(() => ''));
  }

  async subscription(accountId: string, externalKey: string): Promise<{ subscriptionId: string; planName: string; chargedThroughDate: string | null; state: string } | null> {
    return this.findSubscriptionByExternalKey(externalKey);
  }

  async accountInvoices(accountId: string): Promise<KbInvoice[]> {
    const list = await this.callJson<Array<{ invoiceId: string }>>(`accounts/${accountId}/invoices`, 'GET').catch(() => []);
    const invoices: KbInvoice[] = [];
    for (const item of list ?? []) {
      const inv = await this.getInvoice(item.invoiceId).catch(() => null);
      if (inv) invoices.push(inv);
    }
    return invoices;
  }
}
