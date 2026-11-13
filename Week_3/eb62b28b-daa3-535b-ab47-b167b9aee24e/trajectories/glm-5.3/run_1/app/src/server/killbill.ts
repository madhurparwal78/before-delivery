import type { Config } from "./config.js";
import { copy } from "../shared/copy.js";
import { ApiError } from "./errors.js";

export type KbAccount = {
  accountId: string;
  name: string | null;
  email: string | null;
  externalKey: string | null;
  currency: string;
  timeZone: string;
  paymentMethodId: string | null;
};

export type KbSubscription = {
  subscriptionId: string;
  accountId: string;
  planName: string;
  state: string;
  chargedThroughDate: string | null;
  cancelledDate: string | null;
};

export type KbInvoice = {
  invoiceId: string;
  amount: number;
  balance: number;
  status: string;
  invoiceNumber: string;
  currency: string;
  items: {
    description: string;
    startDate: string;
    endDate: string | null;
    amount: number;
    itemType: string;
  }[];
};

export type KbPayment = {
  paymentId: string;
  targetInvoiceId: string | null;
  purchasedAmount: number;
  transactions: { transactionId: string; effectiveDate: string; status: string; amount: number }[];
};

export class KillBillClient {
  constructor(private config: Config) {}

  private headers(): Record<string, string> {
    const auth = Buffer.from(
      `${this.config.killbill.username}:${this.config.killbill.password}`
    ).toString("base64");
    return {
      Authorization: `Basic ${auth}`,
      "X-Killbill-ApiKey": this.config.killbill.apiKey,
      "X-Killbill-ApiSecret": this.config.killbill.apiSecret,
      "X-Killbill-CreatedBy": "ocotillo-member-desk",
    };
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    contentType = "application/json",
    timeoutMs = 10000
  ): Promise<{ status: number; data: T | null; location: string | null }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `${this.config.killbill.url}${path}`;
      const init: RequestInit = {
        method,
        headers: { ...this.headers() },
        signal: controller.signal,
      };
      if (body !== undefined) {
        init.body = JSON.stringify(body);
        init.headers = { ...init.headers, "Content-Type": contentType } as Record<string, string>;
      }
      const response = await fetch(url, init);
      const location = response.headers.get("Location");
      const text = await response.text();
      let data: T | null = null;
      if (text.length > 0) {
        try {
          data = JSON.parse(text) as T;
        } catch {
          data = null;
        }
      }
      return { status: response.status, data, location };
    } catch {
      throw new ApiError(503, "payments_unavailable", copy("payments_unavailable"));
    } finally {
      clearTimeout(timer);
    }
  }

  /** Upload the practice catalog if the tenant lacks it. */
  async ensureCatalog(): Promise<void> {
    const existing = await this.request<{ [key: string]: unknown }[] | { [key: string]: unknown } | null>(
      "GET",
      "/1.0/kb/catalog"
    );
    if (existing.status === 200) {
      const raw = existing.data;
      const hasPlans =
        Array.isArray(raw) && (raw as unknown[]).length > 0;
      if (hasPlans) return;
    }
    const catalog = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="https://docs.killbill.io/latest/catalog.xsd">
  <effectiveDate>2026-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>Ocotillo</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies><currency>USD</currency></currencies>
  <products><product name="Plus"><category>BASE</category></product></products>
  <rules>
    <changePolicy><changePolicyCase><policy>END_OF_TERM</policy></changePolicyCase></changePolicy>
    <cancelPolicy><cancelPolicyCase><policy>END_OF_TERM</policy></cancelPolicyCase></cancelPolicy>
  </rules>
  <plans>
    <plan name="plus-six-months"><product>Plus</product><initialPhases></initialPhases><finalPhase type="EVERGREEN"><duration><unit>UNLIMITED</unit></duration><recurring><billingPeriod>BIANNUAL</billingPeriod><recurringPrice><price><currency>USD</currency><value>749.95</value></price></recurringPrice></recurring></finalPhase></plan>
    <plan name="plus-yearly"><product>Plus</product><initialPhases></initialPhases><finalPhase type="EVERGREEN"><duration><unit>UNLIMITED</unit></duration><recurring><billingPeriod>ANNUAL</billingPeriod><recurringPrice><price><currency>USD</currency><value>1274.92</value></price></recurringPrice></recurring></finalPhase></plan>
  </plans>
  <priceLists><defaultPriceList name="DEFAULT"><plans><plan>plus-six-months</plan><plan>plus-yearly</plan></plans></defaultPriceList></priceLists>
</catalog>`;
    await this.request("POST", "/1.0/kb/catalog/xml?language=en-US", catalog, "text/xml");
  }

  async createAccount(member: { id: string; name: string; email: string }): Promise<KbAccount> {
    const result = await this.request<KbAccount>("POST", "/1.0/kb/accounts", {
      externalKey: member.id,
      name: member.name,
      email: member.email,
      currency: "USD",
      timeZone: "America/Phoenix",
    });
    if (result.status >= 200 && result.status < 300) {
      const accountId = result.location?.split("/")?.at(-1);
      if (accountId) {
        const fetched = await this.request<KbAccount>("GET", `/1.0/kb/accounts/${accountId}`);
        if (fetched.data) return fetched.data;
      }
    }
    const existing = await this.request<KbAccount | null>(
      "GET",
      `/1.0/kb/accounts?externalKey=${encodeURIComponent(member.id)}`
    );
    if (existing.status === 200 && existing.data) return existing.data;
    throw new ApiError(503, "payments_unavailable", copy("payments_unavailable"));
  }

  async getAccountByExternalKey(memberId: string): Promise<KbAccount | null> {
    const result = await this.request<KbAccount | null>(
      "GET",
      `/1.0/kb/accounts?externalKey=${encodeURIComponent(memberId)}`
    );
    if (result.status === 404 || !result.data) return null;
    if (result.status >= 400) return null;
    return result.data;
  }

  async ensureExternalPaymentMethod(accountId: string): Promise<void> {
    const list = await this.request<
      { paymentMethodId: string; pluginName: string; isDefault: boolean }[]
    >("GET", `/1.0/kb/accounts/${accountId}/paymentMethods?withPluginInfo=false`);
    if (list.status >= 400 || !list.data) {
      throw new ApiError(503, "payments_unavailable", copy("payments_unavailable"));
    }
    const external = list.data.find((pm) => pm.pluginName === "__EXTERNAL_PAYMENT__");
    if (!external) {
      const created = await this.request<{ paymentMethodId: string }>(
        "POST",
        `/1.0/kb/accounts/${accountId}/paymentMethods`,
        { pluginName: "__EXTERNAL_PAYMENT__", isDefault: true }
      );
      if (created.status >= 400) {
        throw new ApiError(503, "payments_unavailable", copy("payments_unavailable"));
      }
      const createdId =
        created.data?.paymentMethodId ??
        created.location?.split("/")?.at(-1) ??
        null;
      if (createdId) {
        await this.request(
          "PUT",
          `/1.0/kb/accounts/${accountId}/paymentMethods/${createdId}/setDefault`,
          { paymentMethodId: createdId, accountId }
        );
      }
      return;
    }
    if (!external.isDefault) {
      await this.request(
        "PUT",
        `/1.0/kb/accounts/${accountId}/paymentMethods/${external.paymentMethodId}/setDefault`,
        { paymentMethodId: external.paymentMethodId, accountId }
      );
    }
  }

  async createSubscription(accountId: string, planName: string): Promise<KbSubscription> {
    const result = await this.request<KbSubscription>(
      "POST",
      "/1.0/kb/subscriptions",
      { accountId, planName }
    );
    if (result.status >= 400) {
      throw new ApiError(503, "payments_unavailable", copy("payments_unavailable"));
    }
    const subId = result.location?.split("/")?.at(-1);
    if (!subId) {
      throw new ApiError(503, "payments_unavailable", copy("payments_unavailable"));
    }
    const fetched = await this.request<KbSubscription>("GET", `/1.0/kb/subscriptions/${subId}`);
    if (fetched.status >= 400 || !fetched.data) {
      throw new ApiError(503, "payments_unavailable", copy("payments_unavailable"));
    }
    return fetched.data;
  }

  async getSubscription(subscriptionId: string): Promise<KbSubscription | null> {
    const result = await this.request<KbSubscription>("GET", `/1.0/kb/subscriptions/${subscriptionId}`);
    if (result.status === 404 || !result.data) return null;
    return result.data;
  }

  async cancelEndOfTerm(subscriptionId: string): Promise<void> {
    const result = await this.request(
      "DELETE",
      `/1.0/kb/subscriptions/${subscriptionId}?entitlementPolicy=END_OF_TERM&callCompletion=true&callTimeout=10`
    );
    if (result.status >= 400) {
      throw new ApiError(503, "payments_unavailable", copy("payments_unavailable"));
    }
  }

  async uncancel(subscriptionId: string): Promise<void> {
    const result = await this.request(
      "PUT",
      `/1.0/kb/subscriptions/${subscriptionId}/uncancel`,
      {}
    );
    if (result.status >= 400) {
      throw new ApiError(503, "payments_unavailable", copy("payments_unavailable"));
    }
  }

  async changePlanEndOfTerm(subscriptionId: string, planName: string): Promise<void> {
    const result = await this.request(
      "PUT",
      `/1.0/kb/subscriptions/${subscriptionId}?callCompletion=true&callTimeout=10`,
      { planName }
    );
    if (result.status >= 400) {
      throw new ApiError(503, "payments_unavailable", copy("payments_unavailable"));
    }
  }

  async listInvoices(accountId: string): Promise<KbInvoice[]> {
    const result = await this.request<KbInvoice[]>(
      "GET",
      `/1.0/kb/accounts/${accountId}/invoices`
    );
    if (result.status >= 400 || !result.data) {
      throw new ApiError(503, "payments_unavailable", copy("payments_unavailable"));
    }
    return result.data;
  }

  async getInvoice(invoiceId: string): Promise<KbInvoice | null> {
    const result = await this.request<KbInvoice>("GET", `/1.0/kb/invoices/${invoiceId}`);
    if (result.status === 404 || !result.data) return null;
    return result.data;
  }

  async listPaymentsForInvoice(invoiceId: string): Promise<KbPayment[]> {
    const result = await this.request<KbPayment[]>(
      "GET",
      `/1.0/kb/invoices/${invoiceId}/payments`
    );
    if (result.status >= 400 || !result.data) return [];
    return result.data;
  }

  async payInvoice(accountId: string, invoiceId: string, amount: number): Promise<void> {
    const result = await this.request(
      "POST",
      `/1.0/kb/invoices/${invoiceId}/payments?externalPayment=true`,
      { accountId, targetInvoiceId: invoiceId, purchasedAmount: amount, currency: "USD" }
    );
    if (result.status >= 400) {
      throw new ApiError(503, "payments_unavailable", copy("payments_unavailable"));
    }
  }

  async updateAccountContact(
    accountId: string,
    fields: { name?: string; email?: string | null; phone?: string | null }
  ): Promise<void> {
    const body: Record<string, unknown> = {};
    if (fields.name !== undefined) body.name = fields.name;
    if (fields.email !== undefined) body.email = fields.email;
    if (fields.phone !== undefined) body.phone = fields.phone;
    body.currency = "USD";
    const result = await this.request("PUT", `/1.0/kb/accounts/${accountId}`, body);
    if (result.status >= 400) {
      throw new ApiError(503, "payments_unavailable", copy("payments_unavailable"));
    }
  }
}
