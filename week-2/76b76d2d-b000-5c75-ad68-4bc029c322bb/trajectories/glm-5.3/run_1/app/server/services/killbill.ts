import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Config } from '../config';

export type KbHealth = 'up' | 'down';

export interface KbItem {
  itemType: string;
  description: string;
  amountCents: number;
}

export interface KbInvoice {
  id: string;
  number: string;
  amountCents: number;
  balanceCents: number;
  creditAppliedCents: number;
  items: KbItem[];
  status: string;
  invoiceDate: string;
}

interface InvoiceItemJson {
  itemType: string | null;
  description: string | null;
  amount: number | null;
}

interface InvoiceJson {
  invoiceId: string;
  invoiceNumber: string;
  amount: number | null;
  balance: number | null;
  status: string | null;
  invoiceDate: string | null;
  items: InvoiceItemJson[] | null;
}

export class KillBillError extends Error {
  constructor(message: string, readonly unreachable: boolean) {
    super(message);
  }
}

/** The Kill Bill client for the one system of record of money. */
export class KillBillClient {
  private readonly cfg: Config;
  private _health: KbHealth;

  constructor(cfg: Config, initialHealth: KbHealth = 'down') {
    this.cfg = cfg;
    this._health = initialHealth;
  }

  get health(): KbHealth { return this._health; }

  private headers(): Record<string, string> {
    const basic = Buffer.from(
      `${this.cfg.killbillUsername}:${this.cfg.killbillPassword}`,
      'utf8',
    ).toString('base64');
    return {
      Authorization: `Basic ${basic}`,
      'X-Killbill-ApiKey': this.cfg.killbillApiKey,
      'X-Killbill-ApiSecret': this.cfg.killbillApiSecret,
      'X-Killbill-CreatedBy': 'halide-box-office',
    };
  }

  private async request(
    method: string,
    urlPath: string,
    options: { body?: unknown; contentType?: string; timeoutMs?: number; raw?: string } = {},
  ): Promise<Response> {
    const timeoutMs = options.timeoutMs ?? 10000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = this.headers();
      if (options.body !== undefined || options.raw !== undefined) {
        headers['Content-Type'] = options.contentType ?? 'application/json';
      }
      return await fetch(`${this.cfg.killbillUrl}${urlPath}`, {
        method,
        headers,
        body: options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
        signal: controller.signal,
      });
    } catch (err) {
      this._health = 'down';
      throw new KillBillError('killbill-unreachable', true);
    } finally {
      clearTimeout(timer);
    }
  }

  /** A health probe; also the recovery path for the 5-second probe loop. */
  async probe(): Promise<KbHealth> {
    try {
      const res = await this.request('GET', '/1.0/healthcheck', { timeoutMs: 10000 });
      this._health = res.ok ? 'up' : 'down';
    } catch {
      this._health = 'down';
    }
    return this._health;
  }

  private async ensureOk(res: Response, what: string): Promise<Response> {
    if (!res.ok) {
      throw new KillBillError(`${what}:${res.status}`, false);
    }
    return res;
  }

  async hasCatalogue(): Promise<boolean> {
    const res = await this.request('GET', '/1.0/kb/catalog/versions');
    if (!res.ok) throw new KillBillError('catalog-versions', false);
    const versions = (await res.json()) as unknown[];
    return versions.length > 0;
  }

  /** Uploads the CAD catalogue once if it is missing. */
  async ensureCatalogue(): Promise<void> {
    if (await this.hasCatalogue()) return;
    const xml = fs.readFileSync(path.join(__dirname, '../data/catalog-template.xml'), 'utf8');
    const res = await this.request('POST', '/1.0/kb/catalog/xml', {
      raw: xml,
      contentType: 'text/xml',
      timeoutMs: 15000,
    });
    if (!res.ok) {
      throw new KillBillError(`catalog-upload:${res.status}`, false);
    }
  }

  async getAccountByExternalKey(externalKey: string): Promise<{ accountId: string } | null> {
    const res = await this.request('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new KillBillError(`account-lookup:${res.status}`, false);
    const json = (await res.json()) as { accountId: string };
    return { accountId: json.accountId };
  }

  async createAccount(input: {
    externalKey: string; name: string; email: string; locale: 'en' | 'fr';
  }): Promise<{ accountId: string }> {
    const body = {
      name: input.name,
      externalKey: input.externalKey,
      email: input.email,
      currency: 'CAD',
      locale: input.locale === 'en' ? 'en_CA' : 'fr_CA',
      timeZone: 'America/Toronto',
    };
    const res = await this.request('POST', '/1.0/kb/accounts', { body });
    await this.ensureOk(res, 'account-create');
    const location = res.headers.get('Location') ?? '';
    const accountId = location.split('/').filter(Boolean).pop() ?? '';
    if (accountId) return { accountId };
    const found = await this.getAccountByExternalKey(input.externalKey);
    if (!found) throw new KillBillError('account-missing', false);
    return found;
  }

  async addExternalPaymentMethod(accountId: string): Promise<void> {
    const res = await this.request('POST', `/1.0/kb/accounts/${accountId}/paymentMethods`, {
      body: { pluginName: '__EXTERNAL_PAYMENT__', accountId, isDefault: true },
    });
    await this.ensureOk(res, 'payment-method');
  }

  /** One invoice per paid booking, gift or membership charge, with the published items. */
  async createChargeInvoice(accountId: string, items: KbItem[]): Promise<KbInvoice> {
    const body = items.map(i => ({
      accountId,
      itemType: i.itemType,
      description: i.description,
      amount: i.amountCents / 100,
      currency: 'CAD',
    }));
    const res = await this.request('POST', `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`, { body });
    await this.ensureOk(res, 'invoice-create');
    const json = (await res.json()) as { invoiceId: string }[];
    const invoiceId = json[0].invoiceId;
    return this.getInvoice(invoiceId);
  }

  async getInvoice(invoiceId: string): Promise<KbInvoice> {
    const res = await this.request('GET', `/1.0/kb/invoices/${invoiceId}`);
    await this.ensureOk(res, 'invoice-get');
    return this.parseInvoice((await res.json()) as InvoiceJson);
  }

  private parseInvoice(json: InvoiceJson): KbInvoice {
    const items = (json.items ?? []).map(i => ({
      itemType: i.itemType ?? '',
      description: i.description ?? '',
      amountCents: Math.round((i.amount ?? 0) * 100),
    }));
    const creditApplied = items
      .filter(i => i.itemType === 'CBA_ADJ' && i.amountCents < 0)
      .reduce((sum, i) => sum + -i.amountCents, 0);
    return {
      id: json.invoiceId,
      number: String(json.invoiceNumber ?? ''),
      amountCents: Math.round((json.amount ?? 0) * 100),
      balanceCents: Math.round((json.balance ?? 0) * 100),
      creditAppliedCents: creditApplied,
      items,
      status: json.status ?? '',
      invoiceDate: json.invoiceDate ?? '',
    };
  }

  /** One successful purchase payment equal to the amount paid now. */
  async payInvoice(invoiceId: string, accountId: string, amountCents: number): Promise<{ paymentId: string }> {
    const body = {
      accountId,
      targetInvoiceId: invoiceId,
      purchasedAmount: amountCents / 100,
      currency: 'CAD',
    };
    const res = await this.request(
      'POST',
      `/1.0/kb/invoices/${invoiceId}/payments?externalPayment=true&controlPluginName=__EXTERNAL_PAYMENT__`,
      { body },
    );
    await this.ensureOk(res, 'payment');
    const location = res.headers.get('Location') ?? '';
    const fromLocation = location.split('/').filter(Boolean).pop() ?? '';
    if (fromLocation) return { paymentId: fromLocation };
    // Some payments answer 204 with no Location; find the payment on the invoice.
    const deadline = Date.now() + 4000;
    for (;;) {
      const payments = await this.invoicePayments(invoiceId);
      const match = payments.find(p => Math.round(p.purchasedAmount * 100) === amountCents);
      if (match) return { paymentId: match.paymentId };
      if (Date.now() >= deadline) throw new KillBillError('payment-id-missing', false);
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }

  /** The payments recorded against an invoice. */
  async invoicePayments(invoiceId: string): Promise<
    { paymentId: string; purchasedAmount: number }[]
  > {
    const res = await this.request('GET', `/1.0/kb/invoices/${invoiceId}/payments`);
    await this.ensureOk(res, 'invoice-payments');
    const json = (await res.json()) as { paymentId: string; purchasedAmount: number }[];
    return json ?? [];
  }

  async refundPayment(paymentId: string, amountCents: number): Promise<void> {
    const body = { amount: amountCents / 100, currency: 'CAD', isAdjusted: false };
    const res = await this.request(
      'POST',
      `/1.0/kb/invoicePayments/${paymentId}/refunds`,
      { body },
    );
    await this.ensureOk(res, 'refund');
  }

  /** An account credit: goodwill, or the re-credit of a refund's credit portion.
   * Returns the credit invoice id so a failed flow can compensate. */
  async createCredit(accountId: string, description: string, amountCents: number): Promise<string> {
    const body = [{
      accountId,
      itemType: 'CREDIT_ADJ',
      description,
      amount: amountCents / 100,
      currency: 'CAD',
    }];
    const res = await this.request('POST', '/1.0/kb/credits?autoCommit=true', { body });
    await this.ensureOk(res, 'credit');
    const json = (await res.json()) as { invoiceId: string }[];
    return json[0]?.invoiceId ?? '';
  }

  /**
   * Compensation for an account credit that a failed flow created: a charge
   * invoice of the same amount, which the account credit pays itself.
   */
  async reverseCredit(accountId: string, description: string, amountCents: number): Promise<void> {
    await this.createChargeInvoice(accountId, [
      { itemType: 'EXTERNAL_CHARGE', description, amountCents },
    ]);
  }

  async voidInvoice(invoiceId: string): Promise<void> {
    const res = await this.request('PUT', `/1.0/kb/invoices/${invoiceId}/voidInvoice`);
    if (!res.ok && res.status !== 404) throw new KillBillError(`void:${res.status}`, false);
  }

  /** One subscription per join or redemption, on the published plan. */
  async createSubscription(accountId: string, planName: string): Promise<{ subscriptionId: string }> {
    const res = await this.request(
      'POST',
      '/1.0/kb/subscriptions?callCompletionSpec=false',
      { body: { accountId, planName } },
    );
    await this.ensureOk(res, 'subscription-create');
    const location = res.headers.get('Location') ?? '';
    const subscriptionId = location.split('/').filter(Boolean).pop() ?? '';
    if (subscriptionId) return { subscriptionId };
    throw new KillBillError('subscription-id-missing', false);
  }

  /** Changes use IMMEDIATE for upgrades and END_OF_TERM otherwise. */
  async changePlan(subscriptionId: string, planName: string, policy: 'IMMEDIATE' | 'END_OF_TERM'): Promise<void> {
    const res = await this.request(
      'PUT',
      `/1.0/kb/subscriptions/${subscriptionId}?entitlementPolicy=${policy}&billingPolicy=${policy}`,
      { body: { planName } },
    );
    await this.ensureOk(res, 'subscription-change');
  }

  async cancelSubscription(subscriptionId: string, policy: 'END_OF_TERM'): Promise<void> {
    const res = await this.request('DELETE', `/1.0/kb/subscriptions/${subscriptionId}?policy=${policy}`);
    if (!res.ok && res.status !== 404) throw new KillBillError(`subscription-cancel:${res.status}`, false);
  }

  async getSubscription(subscriptionId: string): Promise<{
    subscriptionId: string; planName: string; state: string; chargedThroughDate: string | null;
  } | null> {
    const res = await this.request('GET', `/1.0/kb/subscriptions/${subscriptionId}`);
    if (res.status === 404) return null;
    await this.ensureOk(res, 'subscription-get');
    const json = (await res.json()) as { subscriptionId: string; planName: string; state: string; chargedThroughDate: string | null };
    return json;
  }

  /** The newest committed invoice for an account (used after a plan change). */
  async latestInvoice(accountId: string, afterInvoiceNumber: string): Promise<KbInvoice | null> {
    const res = await this.request('GET', `/1.0/kb/accounts/${accountId}/invoices?limit=100`);
    await this.ensureOk(res, 'invoice-list');
    const json = (await res.json()) as { invoiceId: string; invoiceNumber: string }[];
    const after = Number(afterInvoiceNumber);
    const newer = json.filter(i => Number(i.invoiceNumber) > after);
    if (newer.length === 0) return null;
    const newest = newer.reduce((a, b) => (Number(a.invoiceNumber) > Number(b.invoiceNumber) ? a : b));
    return this.getInvoice(newest.invoiceId);
  }

  /** Successful PURCHASE and REFUND amounts with effective dates, for reconciliation. */
  async accountTransactions(accountId: string, fromIso: string, toIso: string): Promise<{
    paymentsCents: number; refundsCents: number;
  }> {
    const res = await this.request('GET', `/1.0/kb/accounts/${accountId}/payments?limit=100&withPluginInfo=false`);
    await this.ensureOk(res, 'payment-list');
    type PaymentJson = {
      transactions: { transactionType: string; amount: number; status: string; effectiveDate: string }[] | null;
    };
    const payments = (await res.json()) as PaymentJson[];
    let paymentsCents = 0;
    let refundsCents = 0;
    for (const p of payments) {
      for (const t of p.transactions ?? []) {
        if (t.status !== 'SUCCESS' || !t.effectiveDate) continue;
        if (t.effectiveDate >= fromIso && t.effectiveDate < toIso) {
          if (t.transactionType === 'PURCHASE') paymentsCents += Math.round(t.amount * 100);
          if (t.transactionType === 'REFUND') refundsCents += Math.round(t.amount * 100);
        }
      }
    }
    return { paymentsCents, refundsCents };
  }

  /** The account's invoices, oldest first by invoice number. */
  async accountInvoices(accountId: string): Promise<{ invoiceId: string; invoiceNumber: string }[]> {
    const res = await this.request('GET', `/1.0/kb/accounts/${accountId}/invoices?limit=100`);
    await this.ensureOk(res, 'invoice-list');
    const json = (await res.json()) as { invoiceId: string; invoiceNumber: string }[];
    return [...json].sort((a, b) => Number(a.invoiceNumber) - Number(b.invoiceNumber));
  }

  /**
   * Waits for a subscription invoice to appear (Kill Bill generates it through
   * its notification queue), polling briefly.
   */
  async waitForNewInvoice(
    accountId: string,
    afterInvoiceNumber: string,
    timeoutMs = 4000,
  ): Promise<KbInvoice | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const invoices = await this.accountInvoices(accountId);
      const newer = invoices.filter(i => Number(i.invoiceNumber) > Number(afterInvoiceNumber));
      if (newer.length > 0) {
        const newest = newer[newer.length - 1];
        return this.getInvoice(newest.invoiceId);
      }
      if (Date.now() >= deadline) return null;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }

  /** The Kill Bill account credit balance (CBA). */
  async accountCreditBalance(accountId: string): Promise<number> {
    const res = await this.request('GET', `/1.0/kb/accounts/${accountId}?accountWithBalanceAndCBA=true`);
    await this.ensureOk(res, 'account-cba');
    const json = (await res.json()) as { accountCBA: number | null };
    return Math.round((json.accountCBA ?? 0) * 100);
  }

  /** How much of a payment has already been refunded, for resumable refunds. */
  async paymentRefundedCents(paymentId: string): Promise<number> {
    const res = await this.request('GET', `/1.0/kb/invoicePayments/${paymentId}`);
    if (res.status === 404) return 0;
    await this.ensureOk(res, 'payment-get');
    const json = (await res.json()) as { refundedAmount: number | null };
    return Math.round((json.refundedAmount ?? 0) * 100);
  }

  /** Whether the account already holds a credit with this exact description. */
  async hasCreditDescription(accountId: string, description: string): Promise<boolean> {
    const res = await this.request('GET', `/1.0/kb/accounts/${accountId}/invoices?limit=100`);
    await this.ensureOk(res, 'invoice-list');
    const invoices = (await res.json()) as { invoiceId: string }[];
    for (const inv of invoices) {
      const full = await this.getInvoice(inv.invoiceId);
      if (full.items.some(i => i.itemType === 'CREDIT_ADJ' && i.description === description)) {
        return true;
      }
    }
    return false;
  }
}
