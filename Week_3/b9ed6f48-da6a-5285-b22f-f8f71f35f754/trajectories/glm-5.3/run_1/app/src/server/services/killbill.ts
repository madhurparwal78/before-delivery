import type { Config } from '../config.ts';

/** Kill Bill REST client. Server side only. */

export interface KbInvoice {
  invoiceId: string;
  accountId: string;
  status: string;
  amount: number;
  balance: number;
  currency: string;
  invoiceNumber: string;
  invoiceDate: string;
  targetDate: string;
  items: Array<{ invoiceItemId: string; amount: number; description: string | null; itemType: string }>;
}

export interface KbPayment {
  paymentId: string;
  paymentNumber: number;
  purchasedAmount: number;
  refundedAmount: number;
  currency: string;
  accountId: string;
  paymentMethodId: string;
  transactions: Array<{
    transactionId: string;
    transactionType: string;
    amount: number;
    processedAmount: number;
    currency: string;
    status: string;
    effectiveDate: string;
  }>;
}

export interface KbAccount {
  accountId: string;
  externalKey: string;
  name: string;
  email: string;
  currency: string;
}

export interface KbSubscription {
  subscriptionId: string;
  bundleId: string;
  state: string;
  planName: string;
  productName: string;
  chargedThroughDate: string | null;
  cancelledDate: string | null;
  startDate: string;
  events: Array<{ eventType: string; effectiveDate: string; plan: string | null }>;
}

export class KillBillUnavailable extends Error {}

export class KillBillApi {
  constructor(private config: Config) {}

  private headers(extra?: Record<string, string>): Record<string, string> {
    const auth = Buffer.from(`${this.config.killbillUsername}:${this.config.killbillPassword}`).toString('base64');
    return {
      Authorization: `Basic ${auth}`,
      'X-Killbill-ApiKey': this.config.killbillApiKey,
      'X-Killbill-ApiSecret': this.config.killbillApiSecret,
      'X-Killbill-CreatedBy': 'sightline',
      ...extra,
    };
  }

  async request<T>(method: string, path: string, body?: unknown, contentType?: string): Promise<{ status: number; body: T | null; headers: Record<string, string> }> {
    const url = `${this.config.killbillUrl}${path}`;
    const extraHeaders: Record<string, string> = {};
    if (contentType) extraHeaders['Content-Type'] = contentType;
    else if (body !== undefined) extraHeaders['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: this.headers(extraHeaders),
        body: body === undefined ? null : ((typeof body === 'string' ? body : JSON.stringify(body)) as BodyInit),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new KillBillUnavailable('Kill Bill unreachable');
    }
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    const text = await res.text();
    let parsed: T | null = null;
    if (text) {
      try {
        parsed = JSON.parse(text) as T;
      } catch {
        parsed = null;
      }
    }
    return { status: res.status, body: parsed, headers };
  }

  async ensureCatalog(catalogXml: string): Promise<void> {
    // Read the existing versions; upload our full catalog only if the current
    // version does not already contain our plans.
    let versions: string[] = [];
    try {
      const res = await this.request<string[]>('GET', '/1.0/kb/catalog/versions');
      versions = (res.body as unknown as string[]) ?? [];
    } catch {
      throw new KillBillUnavailable('Kill Bill unreachable');
    }
    const existing = await this.readCurrentCatalog();
    if (existing && catalogXmlMatches(existing, catalogXml)) return;
    const effectiveDate = nextCatalogDate(versions);
    const xml = catalogXml.replace('__EFFECTIVE_DATE__', effectiveDate);
    const res = await this.request<unknown>('POST', '/1.0/kb/catalog/xml', xml, 'text/xml');
    if (res.status !== 201) {
      // maybe another instance raced us; re-read and check
      const again = await this.readCurrentCatalog();
      if (again && catalogXmlMatches(again, catalogXml)) return;
      throw new KillBillUnavailable('catalog upload failed');
    }
  }

  async readCurrentCatalog(): Promise<string | null> {
    try {
      const res = await fetch(`${this.config.killbillUrl}/1.0/kb/catalog/xml`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    }
  }

  async findAccountByExternalKey(externalKey: string): Promise<KbAccount | null> {
    const res = await this.request<unknown>('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`);
    if (res.status === 404) return null;
    if (res.status !== 200) throw new KillBillUnavailable('account lookup failed');
    return res.body as KbAccount;
  }

  async createAccount(externalKey: string, name: string, email: string, currency: string): Promise<KbAccount> {
    const res = await this.request<unknown>(
      'POST',
      '/1.0/kb/accounts',
      { externalKey, name, email, currency },
    );
    if (res.status !== 201) {
      if (res.status === 409 || res.status === 400) {
        const existing = await this.findAccountByExternalKey(externalKey);
        if (existing) return existing;
      }
      throw new KillBillUnavailable('account create failed');
    }
    const loc = res.headers['location'] ?? '';
    const accountId = loc.split('/').filter(Boolean).pop() ?? '';
    return { accountId, externalKey, name, email, currency };
  }

  async addAutoPayOff(accountId: string): Promise<void> {
    const res = await this.request<unknown>(
      'POST',
      `/1.0/kb/accounts/${accountId}/tags?tagDefId=00000000-0000-0000-0000-000000000001&createdBy=sightline`,
      [],
    );
    if (res.status !== 201 && res.status !== 200) {
      // Adding the same tag twice answers 400; that is fine.
      if (res.status !== 400) throw new KillBillUnavailable('tag add failed');
    }
  }

  async createExternalChargeInvoice(
    accountId: string,
    amountMajor: string,
    currency: string,
    description: string,
  ): Promise<KbInvoice> {
    // One external charge, then the invoice is committed so it carries a balance.
    const res = await this.request<unknown>(
      'POST',
      `/1.0/kb/invoices/charges/${encodeURIComponent(accountId)}`,
      [{ accountId, amount: Number(amountMajor), currency, description }],
    );
    if (res.status !== 200 || !Array.isArray(res.body) || !res.body.length) throw new KillBillUnavailable('invoice create failed');
    const first = (res.body as Array<{ invoiceId: string }>)[0]!;
    const invoiceId = first.invoiceId;
    const commit = await this.request<null>('PUT', `/1.0/kb/invoices/${invoiceId}/commitInvoice`);
    if (commit.status !== 200 && commit.status !== 204) throw new KillBillUnavailable('invoice commit failed');
    const invoice = await this.request<KbInvoice>('GET', `/1.0/kb/invoices/${invoiceId}`);
    if (invoice.status !== 200 || !invoice.body) throw new KillBillUnavailable('invoice fetch failed');
    return invoice.body;
  }

  async payInvoice(accountId: string, invoiceId: string, amountMajor: string, currency: string): Promise<KbPayment> {
    const res = await this.request<KbPayment | null>(
      'POST',
      `/1.0/kb/invoices/${invoiceId}/payments?externalPayment=true`,
      { accountId, targetInvoiceId: invoiceId, purchasedAmount: Number(amountMajor), currency },
    );    if (res.status !== 201) throw new KillBillUnavailable('payment failed');
    const loc = res.headers['location'] ?? '';
    const paymentId = loc.split('/').filter(Boolean).pop() ?? '';    const pay = await this.request<KbPayment>('GET', `/1.0/kb/invoicePayments/${paymentId}`);    if (pay.status !== 200 || !pay.body) throw new KillBillUnavailable('payment fetch failed');
    return pay.body;
  }

  async refundPayment(paymentId: string, amountMajor: string, currency: string): Promise<KbPayment> {
    const res = await this.request<KbPayment | null>(
      'POST',
      `/1.0/kb/payments/${paymentId}/refunds`,
      { amount: Number(amountMajor), currency },
    );
    if (res.status !== 201) throw new KillBillUnavailable('refund failed');
    const pay = await this.request<KbPayment>('GET', `/1.0/kb/payments/${paymentId}`);
    if (pay.status !== 200 || !pay.body) throw new KillBillUnavailable('payment fetch failed');
    return pay.body;
  }

  async createSubscription(accountId: string, planName: string, bundleKey: string): Promise<KbSubscription> {
    const res = await this.request<KbSubscription | null>(
      'POST',
      `/1.0/kb/subscriptions?callCompletion=true&callTimeoutSec=30`,
      { accountId, planName, bundleExternalKey: bundleKey },
    );
    if (res.status !== 201) throw new KillBillUnavailable('subscription create failed');
    if (res.body && res.body.subscriptionId) return res.body;
    const bundle = await this.request<unknown[]>('GET', `/1.0/kb/bundles?externalKey=${encodeURIComponent(bundleKey)}`);
    const list = (bundle.body as Array<{ subscriptions: KbSubscription[] }>) ?? [];
    if (!list.length || !list[0]!.subscriptions.length) throw new KillBillUnavailable('subscription create failed');
    return list[0]!.subscriptions[0]!;
  }

  async getSubscription(subscriptionId: string): Promise<KbSubscription> {
    const res = await this.request<KbSubscription>('GET', `/1.0/kb/subscriptions/${subscriptionId}`);
    if (res.status !== 200 || !res.body) throw new KillBillUnavailable('subscription fetch failed');
    return res.body;
  }

  async changePlanImmediate(subscriptionId: string, planName: string): Promise<void> {
    const res = await this.request<null>('PUT', `/1.0/kb/subscriptions/${subscriptionId}`, { planName });
    if (res.status !== 204 && res.status !== 200) throw new KillBillUnavailable('plan change failed');
  }

  async changePlanFuture(subscriptionId: string, planName: string, requestedDate: string): Promise<void> {
    const res = await this.request<null>(
      'PUT',
      `/1.0/kb/subscriptions/${subscriptionId}?requestedDate=${requestedDate}&useRequestedDateForBilling=true`,
      { planName },
    );
    if (res.status !== 204 && res.status !== 200) throw new KillBillUnavailable('plan change failed');
  }

  async undoChangePlan(subscriptionId: string): Promise<void> {
    const res = await this.request<null>('PUT', `/1.0/kb/subscriptions/${subscriptionId}/undoChangePlan`);
    if (res.status !== 204 && res.status !== 200) throw new KillBillUnavailable('undo change failed');
  }

  async cancelEndOfTerm(subscriptionId: string, requestedDate: string): Promise<void> {
    const res = await this.request<null>(
      'DELETE',
      `/1.0/kb/subscriptions/${subscriptionId}?requestedDate=${requestedDate}&useRequestedDateForBilling=true&entitlementPolicy=END_OF_TERM&billingPolicy=END_OF_TERM`,
    );
    if (res.status !== 204 && res.status !== 200) throw new KillBillUnavailable('cancel failed');
  }

  async cancelImmediate(subscriptionId: string): Promise<void> {
    const res = await this.request<null>('DELETE', `/1.0/kb/subscriptions/${subscriptionId}`);
    if (res.status !== 204 && res.status !== 200) throw new KillBillUnavailable('cancel failed');
  }

  async uncancel(subscriptionId: string): Promise<void> {
    const res = await this.request<null>('PUT', `/1.0/kb/subscriptions/${subscriptionId}/uncancel`);
    if (res.status !== 204 && res.status !== 200) throw new KillBillUnavailable('uncancel failed');
  }

  async listAccountInvoices(accountId: string): Promise<KbInvoice[]> {
    const res = await this.request<Array<{ invoiceId: string }>>(
      'GET',
      `/1.0/kb/accounts/${accountId}/invoices`,
    );
    if (res.status !== 200 || !Array.isArray(res.body)) throw new KillBillUnavailable('invoice list failed');
    const out: KbInvoice[] = [];
    for (const summary of res.body) {
      const detail = await this.request<KbInvoice>('GET', `/1.0/kb/invoices/${summary.invoiceId}`);
      if (detail.status === 200 && detail.body) out.push(detail.body);
    }
    return out;
  }

  async listAccountPayments(accountId: string): Promise<KbPayment[]> {
    const res = await this.request<KbPayment[]>('GET', `/1.0/kb/accounts/${accountId}/payments`);
    if (res.status !== 200 || !Array.isArray(res.body)) throw new KillBillUnavailable('payment list failed');
    return res.body;
  }

  async listAccountBundles(accountId: string): Promise<KbSubscription[]> {
    const res = await this.request<unknown[]>(
      'GET',
      `/1.0/kb/accounts/${accountId}/bundles?externalKey=&limit=100`,
    );
    if (res.status !== 200 || !Array.isArray(res.body)) throw new KillBillUnavailable('bundle list failed');
    const out: KbSubscription[] = [];
    for (const b of res.body as Array<{ subscriptions: KbSubscription[] }>) {
      for (const s of b.subscriptions) out.push(s);
    }
    return out;
  }

  async listAllPayments(): Promise<KbPayment[]> {
    // Used by reconciliation: all payments on this tenant, filtered by our accounts by the caller.
    const res = await this.request<KbPayment[]>('GET', `/1.0/kb/payments/pagination?limit=1000`);
    if (res.status !== 200 || !Array.isArray(res.body)) throw new KillBillUnavailable('payment pagination failed');
    return res.body;
  }

  async listAllPaymentsByExternalKeys(): Promise<KbPayment[]> {
    const res = await this.request<KbPayment[]>('GET', `/1.0/kb/payments/pagination?limit=1000&withAttempts=false`);
    if (res.status !== 200 || !Array.isArray(res.body)) throw new KillBillUnavailable('payment pagination failed');
    return res.body;
  }
}

/** Compare the currently-live catalog with the one we intend to keep. */
function catalogXmlMatches(current: string, _wanted: string): boolean {
  // The catalog matches when the live XML contains every plan name we ship.
  const plans = ['guided-session-ticket-plan', 'supporter-reader-monthly', 'supporter-fellow-monthly', 'supporter-patron-monthly'];
  return plans.every((p) => current.includes(p));
}

function nextCatalogDate(versions: string[]): string {
  // A new version must be later than every existing effective date.
  let latest = 0;
  for (const v of versions) {
    const t = Date.parse(v);
    if (!Number.isNaN(t) && t > latest) latest = t;
  }
  const next = new Date(Math.max(latest + 86_400_000, Date.now() - 86_400_000));
  return `${next.toISOString().slice(0, 19)}.000Z`;
}
