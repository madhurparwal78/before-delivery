import type { AppConfig } from './config.js';
import { AppError } from './errors.js';

export interface KbAccount {
  accountId: string;
  externalKey: string;
  name?: string;
  email: string;
  currency: string;
}

export interface KbPayment {
  paymentId: string;
  externalKey: string;
  transactions: { transactionId: string; externalKey: string; status: string; transactionType: string; amount?: string; currency?: string }[];
}

export interface KbInvoice {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  balance?: number;
  amount?: number;
  currency: string;
  items: { description?: string; amount: number; startDate: string; endDate: string; planName?: string }[];
  status?: string;
}

export interface KbSubscription {
  subscriptionId: string;
  accountId?: string;
  bundleExternalKey?: string;
  externalKey?: string;
  planName: string;
  productName: string;
  state: string;
  chargedThroughDate?: string;
  phaseType: string;
}

export class KillBillClient {
  constructor(private readonly config: AppConfig) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: 'Basic ' + Buffer.from(`${this.config.killbill.username}:${this.config.killbill.password}`).toString('base64'),
      'X-Killbill-Apikey': this.config.killbill.apiKey,
      'X-Killbill-Apisecret': this.config.killbill.apiSecret,
      'Content-Type': 'application/json',
      'X-Killbill-CreatedBy': 'plumtide-venue',
      ...extra,
    };
  }

  private url(path: string): string {
    return `${this.config.killbill.url.replace(/\/$/, '')}/1.0/kb/${path.replace(/^\//, '')}`;
  }

  async request(path: string, init: RequestInit = {}, timeoutMs = 10000): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const merged = { ...this.headers(), ...(init.headers as Record<string, string> | undefined) };
      return await fetch(this.url(path), { ...init, headers: merged, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async getAccountByExternalKey(externalKey: string): Promise<KbAccount | null> {
    const res = await this.request(`accounts?externalKey=${encodeURIComponent(externalKey)}`);
    if (res.status === 404 || res.status === 3003) return null;
    if (!res.ok) throw new AppError(503, { error: 'payments_unavailable' });
    const data = (await res.json()) as KbAccount | { className?: string };
    if (!('accountId' in data)) return null;
    return data;
  }

  async createAccount(externalKey: string, name: string, email: string): Promise<KbAccount> {
    const body = JSON.stringify({ externalKey, name, email, currency: 'USD' });
    const res = await this.request('accounts', { method: 'POST', body, headers: { 'X-Killbill-CreatedBy': 'plumtide-venue' } });
    if (!res.ok) {
      const text = await res.text();
      throw new AppError(503, { error: 'payments_unavailable', detail: text.slice(0, 200) });
    }
    const location = res.headers.get('Location');
    if (!location) throw new AppError(503, { error: 'payments_unavailable' });
    const accountId = location.split('/').pop() ?? '';
    return { accountId, externalKey, name, email, currency: 'USD' };
  }

  async ensureAccount(externalKey: string, name: string, email: string): Promise<KbAccount> {
    const existing = await this.getAccountByExternalKey(externalKey);
    if (existing) return existing;
    return this.createAccount(externalKey, name, email);
  }

  async setExternalPaymentMethod(accountId: string, cardLast4: string): Promise<void> {
    const body = JSON.stringify({
      externalKey: `pm-${accountId}`,
      pluginName: '__EXTERNAL_PAYMENT__',
      pluginInfo: { properties: [{ key: 'cardLast4', value: cardLast4 }] },
    });
    const res = await this.request(`accounts/${accountId}/paymentMethods?pluginName=__EXTERNAL_PAYMENT__&isDefault=true`, { method: 'POST', body });
    if (!res.ok) throw new AppError(503, { error: 'payments_unavailable' });
  }

  async defaultPaymentMethodId(accountId: string): Promise<string | null> {
    const res = await this.request(`accounts/${accountId}/paymentMethods`);
    if (!res.ok) throw new AppError(503, { error: 'payments_unavailable' });
    const methods = (await res.json()) as { paymentMethodId: string; isDefault: boolean }[];
    return methods.find((m) => m.isDefault)?.paymentMethodId ?? methods[0]?.paymentMethodId ?? null;
  }

  async createPurchase(accountId: string, externalKey: string, transactionExternalKey: string, amountUsd: string, cardLast4: string): Promise<KbPayment> {
    let methodId = await this.defaultPaymentMethodId(accountId).catch(() => null);
    if (!methodId) {
      await this.setExternalPaymentMethod(accountId, cardLast4);
      methodId = await this.defaultPaymentMethodId(accountId);
    }
    if (!methodId) throw new AppError(503, { error: 'payments_unavailable' });
    const body = JSON.stringify({
      paymentExternalKey: externalKey,
      transactionExternalKey,
      transactionType: 'PURCHASE',
      amount: amountUsd,
      currency: 'USD',
    });
    const res = await this.request(`accounts/${accountId}/payments?paymentMethodId=${methodId}`, { method: 'POST', body });
    if (!res.ok) throw new AppError(503, { error: 'payments_unavailable' });
    const location = res.headers.get('Location');
    if (location) {
      const paymentId = location.replace(/\/$/, '').split('/').pop() ?? '';
      return await this.getPayment(paymentId);
    }
    return (await res.json()) as KbPayment;
  }

  async getPayment(paymentId: string): Promise<KbPayment> {
    const res = await this.request(`payments/${paymentId}`);
    if (!res.ok) throw new AppError(503, { error: 'payments_unavailable' });
    return (await res.json()) as KbPayment;
  }

  async createRefund(paymentId: string, transactionExternalKey: string, amountUsd: string): Promise<KbPayment> {
    const body = JSON.stringify({ transactionType: 'REFUND', amount: amountUsd, currency: 'USD', transactionExternalKey });
    const res = await this.request(`payments/${paymentId}/refunds`, { method: 'POST', body });
    if (!res.ok) throw new AppError(503, { error: 'payments_unavailable' });
    const location = res.headers.get('Location');
    if (location) {
      const payment = await this.getPayment(paymentId);
      return payment;
    }
    return (await res.json()) as KbPayment;
  }

  async invoicesForAccount(accountId: string): Promise<KbInvoice[]> {
    const res = await this.request(`accounts/${accountId}/invoices?withItems=true`);
    if (!res.ok) throw new AppError(503, { error: 'billing_unavailable' });
    const data = (await res.json()) as { invoices?: KbInvoice[] } | KbInvoice[];
    return Array.isArray(data) ? data : data.invoices ?? [];
  }

  async unpaidInvoices(accountId: string): Promise<KbInvoice[]> {
    const res = await this.request(`accounts/${accountId}/invoices?status=UNPAID&withItems=true`);
    if (!res.ok) throw new AppError(503, { error: 'billing_unavailable' });
    const data = (await res.json()) as { invoices?: KbInvoice[] } | KbInvoice[];
    return Array.isArray(data) ? data : data.invoices ?? [];
  }

  async payInvoice(accountId: string, invoiceId: string, externalKey: string): Promise<KbPayment> {
    const body = JSON.stringify({ transactionType: 'PURCHASE', transactionExternalKey: externalKey });
    const res = await this.request(`accounts/${accountId}/invoices/${invoiceId}/payments`, { method: 'POST', body });
    if (!res.ok) throw new AppError(503, { error: 'billing_unavailable' });
    const location = res.headers.get('Location');
    if (location) {
      const paymentId = location.replace(/\/$/, '').split('/').pop() ?? '';
      return this.getPayment(paymentId);
    }
    return (await res.json()) as KbPayment;
  }

  async bundleByExternalKey(externalKey: string): Promise<{ accountId?: string; subscriptions?: KbSubscription[] }[] | null> {
    const res = await this.request(`bundles?externalKey=${encodeURIComponent(externalKey)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new AppError(503, { error: 'billing_unavailable' });
    return (await res.json()) as { accountId?: string; subscriptions?: KbSubscription[] }[];
  }

  async subscriptionsForAccount(accountId: string): Promise<KbSubscription[]> {
    // The account subscriptions resource 404s for accounts with cancelled-only
    // bundles, so the bundles collection is the reliable lookup.
    const res = await this.request(`accounts/${accountId}/bundles`);
    if (!res.ok) throw new AppError(503, { error: 'billing_unavailable' });
    const bundles = (await res.json()) as { subscriptions?: KbSubscription[] }[];
    return bundles.flatMap((bundle) => bundle.subscriptions ?? []);
  }

  async getAccountBundleByExternalKey(accountId: string, externalKey: string): Promise<KbSubscription | null> {
    const subs = await this.subscriptionsForAccount(accountId);
    return subs.find((s) => s.bundleExternalKey === externalKey || s.externalKey === externalKey) ?? null;
  }

  async createSubscription(accountId: string, bundleKey: string, planName: string, startDate?: string): Promise<KbSubscription> {
    const body = JSON.stringify({
      accountId,
      bundleExternalKey: bundleKey,
      externalKey: bundleKey,
      planName,
      phaseType: startDate ? 'EVERGREEN' : undefined,
      startDate,
    });
    const res = await this.request('subscriptions', { method: 'POST', body });
    if (!res.ok) {
      const text = await res.text();
      throw new AppError(503, { error: 'billing_unavailable', detail: text.slice(0, 200) });
    }
    const location = res.headers.get('Location');
    if (location) {
      const subId = location.replace(/\/$/, '').split('/').pop() ?? '';
      const subs = await this.subscriptionsForAccount(accountId);
      const found = subs.find((s) => s.subscriptionId === subId);
      if (found) return found;
    }
    return (await res.json()) as KbSubscription;
  }

  async changePlan(subscriptionId: string, planName: string, effectiveDate?: string): Promise<KbSubscription> {
    // The plan goes in the body; the effective date is the requestedDate query.
    const query = effectiveDate ? `?requestedDate=${encodeURIComponent(effectiveDate)}` : '';
    const body = JSON.stringify({ planName });
    const res = await this.request(`subscriptions/${subscriptionId}${query}`, { method: 'PUT', body });
    if (!res.ok) {
      const text = await res.text();
      throw new AppError(503, { error: 'billing_unavailable', detail: text.slice(0, 200) });
    }
    const got = await this.request(`subscriptions/${subscriptionId}`);
    if (!got.ok) throw new AppError(503, { error: 'billing_unavailable' });
    return (await got.json()) as KbSubscription;
  }

  async ensureCatalog(): Promise<void> {
    const res = await this.request('catalog');
    if (!res.ok) throw new AppError(503, { error: 'billing_unavailable' });
    const versions = (await res.json()) as { products?: { name: string }[] }[];
    const hasProduct = versions.some((version) => version.products?.some((p) => p.name === 'BuilderApi'));
    if (hasProduct) return;
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <effectiveDate>2020-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>Plumtide</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies>
    <currency>USD</currency>
  </currencies>
  <products>
    <product name="BuilderApi">
      <category>STANDALONE</category>
    </product>
  </products>
  <rules>
    <changePolicy>
      <changePolicyCase>
        <policy>IMMEDIATE</policy>
      </changePolicyCase>
    </changePolicy>
    <changeAlignment>
      <changeAlignmentCase>
        <alignment>START_OF_SUBSCRIPTION</alignment>
      </changeAlignmentCase>
    </changeAlignment>
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
    <billingAlignment>
      <billingAlignmentCase>
        <alignment>ACCOUNT</alignment>
      </billingAlignmentCase>
    </billingAlignment>
    <priceList>
      <priceListCase>
        <fromPriceList>DEFAULT</fromPriceList>
        <toPriceList>DEFAULT</toPriceList>
      </priceListCase>
    </priceList>
  </rules>
  <plans>
    <plan name="sandbox-monthly">
      <product>BuilderApi</product>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice><price><currency>USD</currency><value>0</value></price></recurringPrice>
        </recurring>
      </finalPhase>
    </plan>
    <plan name="builder-monthly">
      <product>BuilderApi</product>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice><price><currency>USD</currency><value>49</value></price></recurringPrice>
        </recurring>
      </finalPhase>
    </plan>
    <plan name="desk-monthly">
      <product>BuilderApi</product>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice><price><currency>USD</currency><value>249</value></price></recurringPrice>
        </recurring>
      </finalPhase>
    </plan>
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT">
      <plans>
        <plan>sandbox-monthly</plan>
        <plan>builder-monthly</plan>
        <plan>desk-monthly</plan>
      </plans>
    </defaultPriceList>
  </priceLists>
</catalog>`;
    const upload = await fetch(`${this.config.killbill.url.replace(/\/$/, '')}/1.0/kb/catalog/xml`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'text/xml' }),
      body: xml,
    });
    if (!upload.ok) {
      const text = await upload.text();
      throw new Error(`Catalog upload failed ${upload.status}: ${text.slice(0, 300)}`);
    }
  }

  async ensureOverdueConfig(): Promise<void> {
    const res = await fetch(`${this.config.killbill.url.replace(/\/$/, '')}/1.0/kb/overdue`, {
      headers: this.headers({ Accept: 'text/xml' }),
    });
    if (res.ok) {
      const xml = await res.text();
      if (xml.includes('WARNING') && xml.includes('DOWNGRADED')) return;
    }
    const xml = `<overdueConfig>
  <accountOverdueStates>
    <state name="DOWNGRADED">
      <condition>
        <numberOfUnpaidInvoicesEqualsOrExceeds>2</numberOfUnpaidInvoicesEqualsOrExceeds>
      </condition>
      <externalMessage>Reached DOWNGRADED</externalMessage>
      <blockChanges>true</blockChanges>
      <disableEntitlementAndChangesBlocked>false</disableEntitlementAndChangesBlocked>
      <autoReevaluationInterval>
        <unit>DAYS</unit><number>1</number>
      </autoReevaluationInterval>
    </state>
    <state name="WARNING">
      <condition>
        <numberOfUnpaidInvoicesEqualsOrExceeds>1</numberOfUnpaidInvoicesEqualsOrExceeds>
      </condition>
      <externalMessage>Reached WARNING</externalMessage>
      <blockChanges>true</blockChanges>
      <disableEntitlementAndChangesBlocked>false</disableEntitlementAndChangesBlocked>
      <autoReevaluationInterval>
        <unit>DAYS</unit><number>1</number>
      </autoReevaluationInterval>
    </state>
  </accountOverdueStates>
</overdueConfig>`;
    const upload = await fetch(`${this.config.killbill.url.replace(/\/$/, '')}/1.0/kb/overdue/xml`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'text/xml' }),
      body: xml,
    });
    if (!upload.ok) {
      const text = await upload.text();
      throw new Error(`Overdue upload failed ${upload.status}: ${text.slice(0, 300)}`);
    }
  }

  async accountOverdueState(accountId: string): Promise<string | null> {
    const res = await this.request(`accounts/${accountId}/overdue`);
    if (res.status === 404) return null;
    if (!res.ok) throw new AppError(503, { error: 'billing_unavailable' });
    const data = (await res.json()) as { name?: string } | null;
    // Kill Bill reports the clear state under either name.
    const name = data?.name;
    if (!name || name === 'Clear' || name.startsWith('__KILLBILL__CLEAR')) return null;
    return name;
  }
}
