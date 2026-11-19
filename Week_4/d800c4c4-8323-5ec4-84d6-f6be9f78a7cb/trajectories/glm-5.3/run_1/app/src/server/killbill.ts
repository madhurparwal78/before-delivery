// Kill Bill REST client: memberships, fees, payments and waiver credits.
// The one ledger for money. All-or-nothing helpers wrap its calls.

export interface KillBillConfig {
  url: string;
  username: string;
  password: string;
  apiKey: string;
  apiSecret: string;
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
  state: string;
  planName: string;
  billingEndDate: string | null;
  chargedThroughDate: string | null;
}

export interface KbInvoice {
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
  balance: number;
  status: string;
  items: { itemType: string; amount: number; description: string }[];
}

export interface KbPayment {
  paymentId: string;
  paymentExternalKey: string;
  purchasedAmount: number;
  transactions: { status: string; transactionType: string }[];
}

export const TIER_PLANS: Record<string, string> = {
  'pay-what-you-can': 'pegworth-pay-what-you-can-annual',
  standard: 'pegworth-standard-annual',
  supporter: 'pegworth-supporter-annual',
};

export class KillBillError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`killbill ${status}`);
  }
}

export class KillBillDown extends KillBillError {
  constructor(readonly cause: Error) {
    super(0, cause.message);
    this.name = 'KillBillDown';
  }
}

export class KillBillClient {
  constructor(private readonly config: KillBillConfig) {}

  async ensureCatalog(): Promise<void> {
    const plans = await this.availableBasePlans();
    const present = new Set(plans.map((p) => p.plan));
    const wanted = Object.values(TIER_PLANS);
    if (wanted.every((plan) => present.has(plan))) return;
    await this.uploadCatalog();
  }

  async availableBasePlans(): Promise<{ product: string; plan: string; priceList: string; finalPhaseBillingPeriod: string; finalPhaseRecurringPrice: { currency: string; value: number }[] }[]> {
    const res = await this.request('GET', '/1.0/kb/catalog/availableBasePlans');
    return res.json();
  }

  async findAccount(externalKey: string): Promise<KbAccount | null> {
    const res = await this.request('GET', `/1.0/kb/accounts/search/${encodeURIComponent(externalKey)}`);
    const list: KbAccount[] = await res.json();
    const hit = list.find((a) => a.externalKey === externalKey);
    return hit ?? null;
  }

  async createAccount(externalKey: string, name: string, email: string): Promise<KbAccount> {
    // The 201 answer carries the new account in the Location header, not the body.
    const res = await this.request(
      'POST',
      '/1.0/kb/accounts',
      JSON.stringify({ externalKey, name, email, currency: 'USD' }),
      { 'Content-Type': 'application/json' },
    );
    const location = res.headers.get('Location') ?? '';
    const accountId = location.split('/').filter((part) => part !== '').pop() ?? '';
    await this.request(
      'POST',
      `/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`,
      JSON.stringify({ externalKey: `pegworth-pm-${externalKey}`, isDefault: true, pluginName: '__EXTERNAL_PAYMENT__' }),
      { 'Content-Type': 'application/json' },
    );
    const tags = await this.tagDefinitionIds();
    await this.request('POST', `/1.0/kb/accounts/${accountId}/tags`, JSON.stringify([tags['AUTO_PAY_OFF']]), {
      'Content-Type': 'application/json',
    });
    const account = await this.getAccount(accountId);
    return account;
  }

  async getAccount(accountId: string): Promise<KbAccount> {
    const res = await this.request('GET', `/1.0/kb/accounts/${accountId}`);
    return res.json();
  }

  async tagDefinitionIds(): Promise<Record<string, string>> {
    const res = await this.request('GET', '/1.0/kb/tagDefinitions');
    const defs: { id: string; name: string }[] = await res.json();
    const out: Record<string, string> = {};
    for (const d of defs) out[d.name] = d.id;
    return out;
  }

  /** The member's ACTIVE subscription to the tier's plan, if any. */
  async findActiveSubscription(accountId: string, planName: string): Promise<KbSubscription | null> {
    const res = await this.request('GET', `/1.0/kb/accounts/${accountId}/bundles`);
    const bundles: { subscriptions: KbSubscription[] }[] = await res.json();
    for (const bundle of bundles) {
      for (const sub of bundle.subscriptions ?? []) {
        if (sub.planName === planName) return sub;
      }
    }
    return null;
  }

  async createSubscription(accountId: string, planName: string): Promise<KbSubscription> {
    // The subscription POST can outlive the HTTP call when KB queues it; the subscription
    // is created regardless, so read the created subscription back from the account bundles.
    try {
      const res = await this.request('POST', '/1.0/kb/subscriptions', JSON.stringify({ accountId, planName }), {
        'Content-Type': 'application/json',
      });
      const text = await res.text();
      if (text.trim() !== '') return JSON.parse(text) as KbSubscription;
    } catch {
      // fall through to reading the bundles
    }
    for (let attempt = 0; attempt < 20; attempt++) {
      const sub = await this.findActiveSubscription(accountId, planName);
      if (sub !== null) return sub;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new KillBillError(500, 'subscription not found after create');
  }

  async getSubscription(subscriptionId: string): Promise<KbSubscription> {
    const res = await this.request('GET', `/1.0/kb/subscriptions/${subscriptionId}`);
    return res.json();
  }

  async cancelAtEndOfTerm(subscriptionId: string): Promise<void> {
    await this.request('DELETE', `/1.0/kb/subscriptions/${subscriptionId}?billingPolicy=END_OF_TERM`);
  }

  async accountInvoices(accountId: string): Promise<KbInvoice[]> {
    const res = await this.request('GET', `/1.0/kb/accounts/${accountId}/invoices`);
    return res.json();
  }

  async getInvoice(invoiceId: string): Promise<KbInvoice> {
    const res = await this.request('GET', `/1.0/kb/invoices/${invoiceId}`);
    return res.json();
  }

  /** Create a fee invoice with one external charge per line, in order. Returns the invoice. */
  async createChargeInvoice(accountId: string, lines: { amountCents: number; description: string }[]): Promise<KbInvoice> {
    const body = lines.map((line) => ({ amount: centsToAmount(line.amountCents), currency: 'USD', description: line.description }));
    const res = await this.request('POST', `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`, JSON.stringify(body), {
      'Content-Type': 'application/json',
    });
    const items: { invoiceId: string }[] = await res.json();
    const invoiceId = items.length > 0 ? items[0]!.invoiceId : '';
    if (invoiceId === '') throw new KillBillError(500, 'no invoice id in charge response');
    return this.getInvoice(invoiceId);
  }

  /** One external payment against an invoice, keyed to be idempotent. Returns the payment found or created. */
  async recordPayment(accountId: string, invoiceId: string, amountCents: number, paymentExternalKey: string): Promise<KbPayment> {
    const existing = await this.findPayment(accountId, paymentExternalKey);
    if (existing !== null) return existing;
    const amount = centsToAmount(amountCents);
    const body = JSON.stringify({
      accountId,
      targetInvoiceId: invoiceId,
      purchasedAmount: amount,
      currency: 'USD',
      paymentExternalKey,
      transactions: [{ transactionExternalKey: `${paymentExternalKey}-tx`, transactionType: 'PURCHASE', amount, currency: 'USD' }],
    });
    let res: Response;
    try {
      res = await this.request('POST', `/1.0/kb/invoices/${invoiceId}/payments?externalPayment=true`, body, {
        'Content-Type': 'application/json',
      });
    } catch (err) {
      // A raced duplicate records the payment anyway; re-read before failing.
      const raced = await this.findPayment(accountId, paymentExternalKey).catch(() => null);
      if (raced !== null) return raced;
      throw err;
    }
    void res;
    const created = await this.findPayment(accountId, paymentExternalKey);
    if (created === null) throw new KillBillError(500, 'payment not found after record');
    return created;
  }

  /** Look for the payment with the external key among the account's payments, then by search. */
  async findPayment(accountId: string, paymentExternalKey: string): Promise<KbPayment | null> {
    const res = await this.request('GET', `/1.0/kb/accounts/${accountId}/payments`);
    const list: KbPayment[] = await res.json();
    const hit = list.find((p) => p.paymentExternalKey === paymentExternalKey);
    if (hit !== undefined) return hit;
    const search = await this.request('GET', `/1.0/kb/payments/search/${encodeURIComponent(paymentExternalKey)}`);
    const found: KbPayment[] = await search.json();
    return found.find((p) => p.paymentExternalKey === paymentExternalKey) ?? null;
  }

  /** Look for a credit item with the exact description on any of the account's invoices. */
  async findCreditItem(accountId: string, description: string): Promise<KbInvoice | null> {
    const invoices = await this.accountInvoices(accountId);
    for (const invoiceId of invoices.map((i) => i.invoiceId)) {
      const invoice = await this.getInvoice(invoiceId);
      if (invoice.items.some((it) => it.description === description && it.amount < 0)) return invoice;
    }
    return null;
  }

  /** Post one credit for the fee total; the CBA rebalance clears the target invoice. */
  async postCredit(accountId: string, amountCents: number, description: string): Promise<void> {
    const body = JSON.stringify([{ accountId, amount: centsToAmount(amountCents), currency: 'USD', description }]);
    await this.request('POST', '/1.0/kb/credits?autoCommit=true', body, { 'Content-Type': 'application/json' });
    await this.request('PUT', `/1.0/kb/accounts/${accountId}/cbaRebalancing`);
  }

  async ping(): Promise<void> {
    await this.request('GET', '/1.0/kb/catalog');
  }

  private async uploadCatalog(): Promise<void> {
    const res = await this.request('GET', '/1.0/kb/catalog/xml');
    const text: string = await res.text();
    if (text.includes('pegworth-standard-annual')) return;
    await this.request('POST', '/1.0/kb/catalog/xml', CATALOG_XML, { 'Content-Type': 'text/xml; charset=UTF-8' });
  }

  private async request(method: string, path: string, body?: string, headers: Record<string, string> = {}): Promise<Response> {
    const url = `${this.config.url}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: basicAuth(this.config.username, this.config.password),
          'X-Killbill-Apikey': this.config.apiKey,
          'X-Killbill-Apisecret': this.config.apiSecret,
          'X-Killbill-CreatedBy': 'pegworth-desk',
          ...headers,
        },
        body,
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      throw new KillBillDown(err instanceof Error ? err : new Error(String(err)));
    }
    if (!res.ok) {
      const text = await res.text();
      throw new KillBillError(res.status, text);
    }
    return res;
  }
}

export function centsToAmount(cents: number): number {
  return Math.round(cents) / 100;
}

function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

// A three-product catalog: each product has a single evergreen annual plan, USD, billed in advance, no trial.
const CATALOG_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
    <effectiveDate>2020-01-01T00:00:00+00:00</effectiveDate>
    <catalogName>Pegworth</catalogName>
    <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
    <currencies>
        <currency>USD</currency>
    </currencies>
    <units/>
    <products>
        <product name="PayWhatYouCan">
            <category>BASE</category>
            <included/>
            <available/>
            <limits/>
        </product>
        <product name="Standard">
            <category>BASE</category>
            <included/>
            <available/>
            <limits/>
        </product>
        <product name="Supporter">
            <category>BASE</category>
            <included/>
            <available/>
            <limits/>
        </product>
    </products>
    <rules>
        <changePolicy>
            <changePolicyCase>
                <policy>IMMEDIATE</policy>
            </changePolicyCase>
        </changePolicy>
        <cancelPolicy>
            <cancelPolicyCase>
                <policy>END_OF_TERM</policy>
            </cancelPolicyCase>
        </cancelPolicy>
        <createAlignment>
            <createAlignmentCase>
                <alignment>START_OF_BUNDLE</alignment>
            </createAlignmentCase>
        </createAlignment>
        <priceList>
            <priceListCase>
                <toPriceList>Default</toPriceList>
            </priceListCase>
        </priceList>
    </rules>
    <plans>
        <plan name="pegworth-pay-what-you-can-annual" prettyName="Pay what you can">
            <product>PayWhatYouCan</product>
            <finalPhase type="EVERGREEN">
                <duration>
                    <unit>UNLIMITED</unit>
                    <number>-1</number>
                </duration>
                <recurring>
                    <billingPeriod>ANNUAL</billingPeriod>
                    <recurringPrice>
                        <price>
                            <currency>USD</currency>
                            <value>15</value>
                        </price>
                    </recurringPrice>
                </recurring>
            </finalPhase>
        </plan>
        <plan name="pegworth-standard-annual" prettyName="Standard">
            <product>Standard</product>
            <finalPhase type="EVERGREEN">
                <duration>
                    <unit>UNLIMITED</unit>
                    <number>-1</number>
                </duration>
                <recurring>
                    <billingPeriod>ANNUAL</billingPeriod>
                    <recurringPrice>
                        <price>
                            <currency>USD</currency>
                            <value>40</value>
                        </price>
                    </recurringPrice>
                </recurring>
            </finalPhase>
        </plan>
        <plan name="pegworth-supporter-annual" prettyName="Supporter">
            <product>Supporter</product>
            <finalPhase type="EVERGREEN">
                <duration>
                    <unit>UNLIMITED</unit>
                    <number>-1</number>
                </duration>
                <recurring>
                    <billingPeriod>ANNUAL</billingPeriod>
                    <recurringPrice>
                        <price>
                            <currency>USD</currency>
                            <value>75</value>
                        </price>
                    </recurringPrice>
                </recurring>
            </finalPhase>
        </plan>
    </plans>
    <priceLists>
        <defaultPriceList name="Default">
            <plans>
                <plan>pegworth-pay-what-you-can-annual</plan>
                <plan>pegworth-standard-annual</plan>
                <plan>pegworth-supporter-annual</plan>
            </plans>
        </defaultPriceList>
    </priceLists>
</catalog>
`;
