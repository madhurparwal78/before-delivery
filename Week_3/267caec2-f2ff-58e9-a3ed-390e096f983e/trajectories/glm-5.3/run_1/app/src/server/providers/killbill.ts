import type { Config } from "../config.js";

export class PaymentsUnavailable extends Error {}

interface Invoice {
  invoiceId: string;
  balance: number;
}

interface PaymentResult {
  paymentId: string;
  transactions: { transactionId: string; transactionType: string; status: string; amount: string }[];
}

const TIMEOUT_MS = 5000;

export class KillBillClient {
  private readonly cfg: Config["killbill"];

  constructor(cfg: Config["killbill"]) {
    this.cfg = cfg;
  }

  private headers(extra: Record<string, string>): Record<string, string> {
    const auth = Buffer.from(`${this.cfg.username}:${this.cfg.password}`).toString("base64");
    return {
      Authorization: `Basic ${auth}`,
      "X-Killbill-ApiKey": this.cfg.apiKey,
      "X-Killbill-ApiSecret": this.cfg.apiSecret,
      "X-Killbill-CreatedBy": "cutline-desk",
      Accept: "application/json",
      ...extra,
    };
  }

  private async request<T>(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<{ status: number; data: T | null; location: string | null }> {
    const url = new URL(`${this.cfg.url}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        url.searchParams.set(k, v);
      }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const init: RequestInit = {
        method,
        headers: this.headers(body !== undefined ? { "Content-Type": "application/json" } : {}),
        signal: controller.signal,
      };
      if (body !== undefined) {
        init.body = JSON.stringify(body);
      }
      const response = await fetch(url, init);
      const location = response.headers.get("Location");
      const text = await response.text();
      let data: T | null = null;
      if (text) {
        try {
          data = JSON.parse(text) as T;
        } catch {
          data = null;
        }
      }
      return { status: response.status, data, location };
    } catch {
      throw new PaymentsUnavailable("killbill unreachable");
    } finally {
      clearTimeout(timer);
    }
  }

  private ok(status: number): boolean {
    return status >= 200 && status < 300;
  }

  async ensureAccount(studioId: string, name: string, email: string): Promise<string> {
    const externalKey = `cutline-studio-${studioId}`;
    const existing = await this.request<{ accountId: string }>("GET", "/api/v1/accounts", undefined, { externalKey });
    if (this.ok(existing.status) && existing.data?.accountId) {
      return existing.data.accountId;
    }
    if (existing.status >= 400 && existing.status < 500 && existing.status !== 404) {
      throw new PaymentsUnavailable(`killbill accounts search failed: ${existing.status}`);
    }
    const created = await this.request<never>("POST", "/api/v1/accounts", {
      externalKey,
      name,
      email,
      currency: "USD",
      isNotifiedForInvoices: false,
    });
    if (!this.ok(created.status) && created.status !== 201 && created.status !== 409) {
      throw new PaymentsUnavailable(`killbill account create failed: ${created.status}`);
    }
    const again = await this.request<{ accountId: string }>("GET", "/api/v1/accounts", undefined, { externalKey });
    if (!this.ok(again.status) || !again.data?.accountId) {
      throw new PaymentsUnavailable(`killbill account not found after create: ${again.status}`);
    }
    return again.data.accountId;
  }

  async ensureExternalPaymentMethod(accountId: string): Promise<string> {
    const existing = await this.request<{ paymentMethodId: string }[]>(
      "GET",
      `/api/v1/accounts/${encodeURIComponent(accountId)}/paymentMethods`,
      undefined,
      { withPluginInfo: "false" },
    );
    if (this.ok(existing.status) && Array.isArray(existing.data) && existing.data.length > 0) {
      const external = existing.data.find((pm) => pm.paymentMethodId);
      if (external) {
        return external.paymentMethodId;
      }
    }
    const created = await this.request<never>(
      "POST",
      `/api/v1/accounts/${encodeURIComponent(accountId)}/paymentMethods`,
      { pluginName: "__EXTERNAL_PAYMENT__", isDefault: true },
      { pluginProperty: "isDefault=true" },
    );
    const headers = created.status === 201 && created.location ? created.location : null;
    void headers;
    if (!this.ok(created.status) && created.status !== 201) {
      throw new PaymentsUnavailable(`killbill payment method create failed: ${created.status}`);
    }
    const again = await this.request<{ paymentMethodId: string }[]>(
      "GET",
      `/api/v1/accounts/${encodeURIComponent(accountId)}/paymentMethods`,
      undefined,
      { withPluginInfo: "false" },
    );
    if (!this.ok(again.status) || !Array.isArray(again.data) || again.data.length === 0) {
      throw new PaymentsUnavailable(`killbill payment method not found after create: ${again.status}`);
    }
    return again.data[0].paymentMethodId;
  }

  async createInvoice(accountId: string, amountCents: number, description: string): Promise<Invoice> {
    const response = await this.request<{ invoiceId: string }[]>(
      "POST",
      `/api/v1/accounts/${encodeURIComponent(accountId)}/invoices`,
      { items: [{ amount: amountCents / 100, description, currency: "USD" }], autoCommit: true },
    );
    if (!this.ok(response.status)) {
      throw new PaymentsUnavailable(`killbill invoice create failed: ${response.status}`);
    }
    // The POST returns the created invoice body.
    const data = response.data as unknown;
    const id =
      (Array.isArray(data) && data[0]?.invoiceId) ||
      (data as { invoiceId?: string } | null)?.invoiceId ||
      (response.location ? response.location.split("/").pop() : null);
    if (!id) {
      throw new PaymentsUnavailable("killbill invoice create returned no invoice id");
    }
    const invoice = await this.request<Invoice & { invoiceId: string }>("GET", `/api/v1/invoices/${encodeURIComponent(String(id))}`);
    if (!this.ok(invoice.status) || !invoice.data?.invoiceId) {
      throw new PaymentsUnavailable(`killbill invoice fetch failed: ${invoice.status}`);
    }
    return { invoiceId: invoice.data.invoiceId, balance: Number(invoice.data.balance ?? 0) };
  }

  async createPurchase(accountId: string, paymentMethodId: string, amountCents: number, entryId: string): Promise<PaymentResult> {
    const response = await this.request<PaymentResult>(
      "POST",
      `/api/v1/accounts/${encodeURIComponent(accountId)}/payments`,
      {
        paymentExternalKey: `cutline-entry-${entryId}`,
        pluginName: "__EXTERNAL_PAYMENT__",
        paymentMethodId,
        transactionType: "PURCHASE",
        amount: amountCents / 100,
        currency: "USD",
        transactionExternalKey: `cutline-entry-${entryId}-purchase`,
      },
      { pluginProperty: "control=NO_OP" },
    );
    if (!this.ok(response.status)) {
      throw new PaymentsUnavailable(`killbill payment failed: ${response.status}`);
    }
    return response.data as PaymentResult;
  }

  async createRefund(paymentId: string, amountCents: number, entryId: string): Promise<PaymentResult> {
    const response = await this.request<PaymentResult>(
      "POST",
      `/api/v1/payments/${encodeURIComponent(paymentId)}/refunds`,
      { transactionExternalKey: `cutline-entry-${entryId}-refund`, amount: amountCents / 100, currency: "USD", adjusted: false, paymentId },
    );
    if (!this.ok(response.status)) {
      throw new PaymentsUnavailable(`killbill refund failed: ${response.status}`);
    }
    return response.data as PaymentResult;
  }

  async adjustInvoiceToZero(invoiceId: string): Promise<void> {
    // Best-effort adjustment on the unwind path; the caller ignores failures here.
    try {
      const invoice = await this.request<{ balance: number }>("GET", `/api/v1/invoices/${encodeURIComponent(invoiceId)}`);
      if (this.ok(invoice.status) && Number(invoice.data?.balance ?? 0) > 0) {
        await this.request(
          "POST",
          `/api/v1/invoices/${encodeURIComponent(invoiceId)}/item-adjustments`,
          { amount: -Number(invoice.data?.balance ?? 0), description: "Cutline unwind", currency: "USD" },
        );
      }
    } catch {
      // already unwinding a failed call
    }
  }

  async ping(): Promise<boolean> {
    try {
      const response = await this.request<unknown>("GET", "/api/v1/tenants", undefined, { limit: "1" });
      return this.ok(response.status);
    } catch {
      return false;
    }
  }
}
