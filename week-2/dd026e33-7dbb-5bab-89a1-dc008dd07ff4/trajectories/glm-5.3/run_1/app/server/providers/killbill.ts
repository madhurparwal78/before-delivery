import type { Env } from '../env.ts';

/** The app's single integration point with Kill Bill. */
export interface KillBillPlan {
  productId: string;
  planId: string;
  price: string;
}

export const BAY_PLANS: Record<string, KillBillPlan> = {
  standard: { productId: 'bay-standard', planId: 'bay-standard-monthly', price: '480.00' },
  covered_lift: { productId: 'bay-covered-lift', planId: 'bay-covered-lift-monthly', price: '690.00' },
  sealed_capsule: { productId: 'bay-sealed-capsule', planId: 'bay-sealed-capsule-monthly', price: '950.00' },
};

export class KillBillError extends Error {
  constructor(public status: number, public body: string) {
    super(`KillBill ${status}`);
  }
  get isUnavailable(): boolean {
    return this.status === 0;
  }
}

export interface KillBillSubscription {
  subscriptionId: string;
  chargedThroughDate: string | null;
  billingEndDate: string | null;
  state: string;
}

export interface KillBillInvoiceInfo {
  invoiceId: string;
  balance: string;
}

export interface KillBillPayment {
  paymentId: string;
  amount: string;
  refundedAmount: string;
  effectiveDate: string;
}

const CATALOG_XML = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
    <effectiveDate>2013-02-08T00:00:00+00:00</effectiveDate>
    <catalogName>lacquer</catalogName>
    <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
    <currencies>
        <currency>CHF</currency>
    </currencies>
    <products>
        <product name="bay-standard"><category>BASE</category></product>
        <product name="bay-covered-lift"><category>BASE</category></product>
        <product name="bay-sealed-capsule"><category>BASE</category></product>
    </products>
    <rules>
        <changePolicy><changePolicyCase><policy>IMMEDIATE</policy></changePolicyCase></changePolicy>
        <cancelPolicy><cancelPolicyCase><policy>IMMEDIATE</policy></cancelPolicyCase></cancelPolicy>
    </rules>
    <plans>
        <plan name="bay-standard-monthly">
            <product>bay-standard</product>
            <finalPhase type="EVERGREEN">
                <duration><unit>UNLIMITED</unit></duration>
                <recurring>
                    <billingPeriod>MONTHLY</billingPeriod>
                    <recurringPrice>
                        <price><currency>CHF</currency><value>480.00</value></price>
                    </recurringPrice>
                </recurring>
            </finalPhase>
        </plan>
        <plan name="bay-covered-lift-monthly">
            <product>bay-covered-lift</product>
            <finalPhase type="EVERGREEN">
                <duration><unit>UNLIMITED</unit></duration>
                <recurring>
                    <billingPeriod>MONTHLY</billingPeriod>
                    <recurringPrice>
                        <price><currency>CHF</currency><value>690.00</value></price>
                    </recurringPrice>
                </recurring>
            </finalPhase>
        </plan>
        <plan name="bay-sealed-capsule-monthly">
            <product>bay-sealed-capsule</product>
            <finalPhase type="EVERGREEN">
                <duration><unit>UNLIMITED</unit></duration>
                <recurring>
                    <billingPeriod>MONTHLY</billingPeriod>
                    <recurringPrice>
                        <price><currency>CHF</currency><value>950.00</value></price>
                    </recurringPrice>
                </recurring>
            </finalPhase>
        </plan>
    </plans>
    <priceLists>
        <defaultPriceList name="DEFAULT">
            <plans>
                <plan>bay-standard-monthly</plan>
                <plan>bay-covered-lift-monthly</plan>
                <plan>bay-sealed-capsule-monthly</plan>
            </plans>
        </defaultPriceList>
    </priceLists>
</catalog>`;

export class KillBill {
  constructor(private env: Env) {}

  private headers(extra?: Record<string, string>): Record<string, string> {
    const auth = Buffer.from(`${this.env.killbill.username}:${this.env.killbill.password}`).toString('base64');
    return {
      Authorization: `Basic ${auth}`,
      'X-Killbill-Apikey': this.env.killbill.apiKey,
      'X-Killbill-Apisecret': this.env.killbill.apiSecret,
      'X-Killbill-CreatedBy': 'lacquer',
      ...extra,
    };
  }

  private async call(
    method: string,
    path: string,
    options?: { body?: unknown; contentType?: string; timeoutMs?: number },
  ): Promise<{ status: number; json: unknown; text: string; location: string | null }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? 10_000);
    try {
      const response = await fetch(`${this.env.killbill.url}${path}`, {
        method,
        headers: this.headers(
          options?.body !== undefined ? { 'Content-Type': options.contentType ?? 'application/json' } : undefined,
        ),
        body:
          options?.body === undefined
            ? undefined
            : typeof options.body === 'string'
              ? options.body
              : JSON.stringify(options.body),
        signal: controller.signal,
      });
      const text = await response.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { status: response.status, json, text, location: response.headers.get('location') };
    } catch (err) {
      if (err instanceof KillBillError) throw err;
      throw new KillBillError(0, String(err));
    } finally {
      clearTimeout(timer);
    }
  }

  private async ok(
    method: string,
    path: string,
    options?: { body?: unknown; contentType?: string },
  ): Promise<{ json: unknown; location: string | null }> {
    const response = await this.call(method, path, options);
    if (response.status >= 400 || response.status === 0) {
      throw new KillBillError(response.status, response.text);
    }
    return { json: response.json, location: response.location };
  }

  async health(): Promise<boolean> {
    try {
      const response = await this.call('GET', '/1.0/healthcheck', { timeoutMs: 2000 });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  async ensureCatalog(): Promise<void> {
    const existing = await this.call('GET', '/1.0/kb/catalog');
    if (existing.status === 200 && Array.isArray(existing.json)) {
      const names = (existing.json as { name?: string }[]).map((catalog) => catalog.name);
      if (names.includes('lacquer')) return;
    }
    const created = await this.call('POST', '/1.0/kb/catalog', {
      body: CATALOG_XML,
      contentType: 'text/xml',
    });
    if (created.status >= 400) {
      throw new KillBillError(created.status, created.text);
    }
  }

  async ensureAccount(externalKey: string, name: string, email: string): Promise<string> {
    const found = await this.call('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`);
    if (found.status === 200) {
      const json = found.json as { accountId?: string };
      if (json.accountId) return json.accountId;
    }
    const created = await this.call('POST', '/1.0/kb/accounts', {
      body: { externalKey, name, email, currency: 'CHF', timeZone: 'Europe/Zurich' },
    });
    if (created.location) {
      const id = created.location.split('/accounts/')[1];
      if (id) return id.replace(/\/$/, '');
    }
    if (created.status >= 400) {
      throw new KillBillError(created.status, created.text);
    }
    const again = await this.ok('GET', `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`);
    const json = again.json as { accountId?: string };
    if (!json.accountId) throw new KillBillError(500, 'account creation failed');
    return json.accountId;
  }

  async findSubscriptionByExternalKey(externalKey: string): Promise<KillBillSubscription | null> {
    const found = await this.call('GET', `/1.0/kb/subscriptions?externalKey=${encodeURIComponent(externalKey)}`);
    if (found.status >= 400) return null;
    const json = found.json as {
      subscriptionId: string;
      chargedThroughDate?: string | null;
      billingEndDate?: string | null;
      state?: string;
    };
    return {
      subscriptionId: json.subscriptionId,
      chargedThroughDate: json.chargedThroughDate ?? null,
      billingEndDate: json.billingEndDate ? json.billingEndDate.slice(0, 10) : null,
      state: json.state ?? 'ACTIVE',
    };
  }

  async createSubscription(accountId: string, externalKey: string, planId: string): Promise<KillBillSubscription> {
    const created = await this.call('POST', `/1.0/kb/subscriptions?accountId=${accountId}&callDryRun=false`, {
      body: { externalKey, accountId, planName: planId },
    });
    let subscriptionId: string | null = null;
    if (created.location) {
      subscriptionId = created.location.split('/subscriptions/')[1]?.replace(/\/$/, '') ?? null;
    }
    if (!subscriptionId) {
      if (created.status >= 400) {
        throw new KillBillError(created.status, created.text);
      }
      const found = await this.findSubscriptionByExternalKey(externalKey);
      if (!found) throw new KillBillError(500, 'subscription creation failed');
      return found;
    }
    return this.getSubscription(subscriptionId);
  }

  async getSubscription(subscriptionId: string): Promise<KillBillSubscription> {
    const response = await this.ok('GET', `/1.0/kb/subscriptions/${subscriptionId}`);
    const json = response.json as {
      subscriptionId: string;
      chargedThroughDate?: string | null;
      billingEndDate?: string | null;
      state?: string;
    };
    return {
      subscriptionId: json.subscriptionId,
      chargedThroughDate: json.chargedThroughDate ?? null,
      billingEndDate: json.billingEndDate ? json.billingEndDate.slice(0, 10) : null,
      state: json.state ?? 'ACTIVE',
    };
  }

  async cancelSubscriptionEndOfTerm(subscriptionId: string): Promise<KillBillSubscription> {
    const response = await this.call('DELETE', `/1.0/kb/subscriptions/${subscriptionId}?callDryRun=false&billingPolicy=END_OF_TERM`);
    if (response.status >= 400) {
      throw new KillBillError(response.status, response.text);
    }
    return this.getSubscription(subscriptionId);
  }

  /** One external charge; Kill Bill commits it as an invoice of that amount. */
  async createCharge(accountId: string, amount: string, description: string): Promise<KillBillInvoiceInfo> {
    const response = await this.ok('POST', `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`, {
      body: [{ amount: Number(amount), currency: 'CHF', description }],
    });
    const items = response.json as { invoiceId?: string }[];
    const invoiceId = items?.[0]?.invoiceId;
    if (!invoiceId) throw new KillBillError(500, 'charge invoice missing');
    return this.getInvoice(invoiceId);
  }

  async getInvoice(invoiceId: string): Promise<KillBillInvoiceInfo> {
    const response = await this.ok('GET', `/1.0/kb/invoices/${invoiceId}`);
    const json = response.json as { invoiceId: string; balance: number };
    return { invoiceId: json.invoiceId, balance: json.balance.toFixed(2) };
  }

  async createExternalPayment(
    accountId: string,
    invoiceId: string,
    amount: string,
    bankReference: string,
  ): Promise<KillBillPayment> {
    const created = await this.call('POST', `/1.0/kb/invoices/${invoiceId}/payments?externalPayment=true`, {
      body: {
        accountId,
        purchasedAmount: Number(amount),
        currency: 'CHF',
      },
    });
    let paymentId: string | null = null;
    if (created.location) {
      paymentId = created.location.split('/invoicePayments/')[1]?.replace(/\/$/, '') ?? null;
    }
    if (!paymentId) {
      if (created.status >= 400) throw new KillBillError(created.status, created.text);
      const payments = await this.listPayments(invoiceId);
      paymentId = payments[payments.length - 1]?.paymentId ?? null;
    }
    if (!paymentId) throw new KillBillError(500, 'payment id missing');
    await this.ok('POST', `/1.0/kb/payments/${paymentId}/customFields`, {
      body: [{ name: 'bank_reference', value: bankReference }],
    });
    return {
      paymentId,
      amount,
      refundedAmount: '0.00',
      effectiveDate: new Date().toISOString(),
    };
  }

  async listPayments(invoiceId: string): Promise<KillBillPayment[]> {
    const response = await this.ok('GET', `/1.0/kb/invoices/${invoiceId}/payments`);
    const json = response.json as Array<{
      paymentId: string;
      purchasedAmount?: number;
      refundedAmount?: number;
      effectiveDate?: string;
    }>;
    const arr = Array.isArray(json) ? json : [];
    return arr
      .filter((payment) => payment.paymentId)
      .map((payment) => ({
        paymentId: payment.paymentId,
        amount: (payment.purchasedAmount ?? 0).toFixed(2),
        refundedAmount: (payment.refundedAmount ?? 0).toFixed(2),
        effectiveDate: payment.effectiveDate ?? new Date().toISOString(),
      }))
      .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  }
}
