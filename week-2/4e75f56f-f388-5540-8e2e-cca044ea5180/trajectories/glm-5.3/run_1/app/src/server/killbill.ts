import type { Config } from "./config.js";
import { billingUnavailable } from "./errors.js";

/**
 * Kill Bill is the source of truth for paid and refunded money. Amounts are
 * integer cents here and decimal dollars on the wire.
 */
export class KillBill {
  constructor(private cfg: Config) {}

  private headers(): Record<string, string> {
    return {
      Authorization: "Basic " + Buffer.from(`${this.cfg.killbillUsername}:${this.cfg.killbillPassword}`).toString("base64"),
      "X-Killbill-ApiKey": this.cfg.killbillApiKey,
      "X-Killbill-ApiSecret": this.cfg.killbillApiSecret,
      "X-Killbill-CreatedBy": "opaline-bench-days",
      "Content-Type": "application/json",
    };
  }

  private url(path: string): string {
    return `${this.cfg.killbillUrl}/1.0/kb${path}`;
  }

  async request<T>(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<{ status: number; data: T | null; location: string | null }> {
    let url = this.url(path);
    if (query) {
      const qs = new URLSearchParams(query).toString();
      if (qs) url += `?${qs}`;
    }
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: this.headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw billingUnavailable();
    }
    const location = res.headers.get("Location");
    const text = await res.text();
    let data: T | null = null;
    if (text) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        data = null;
      }
    }
    if (res.status >= 500) throw billingUnavailable();
    return { status: res.status, data, location };
  }

  async ensureAccount(externalKey: string, name: string, email: string): Promise<string> {
    const found = await this.request<KbAccount[]>("GET", `/accounts/search/${encodeURIComponent(externalKey)}`);
    const exact = found.data?.find((a) => a.externalKey === externalKey && a.accountId);
    if (exact?.accountId) return exact.accountId;
    const created = await this.request<unknown>("POST", "/accounts", {
      externalKey,
      name,
      email,
      currency: "USD",
    });
    if (created.status === 201 && created.location) {
      const id = created.location.split("/").pop();
      if (id) return id;
    }
    // 409 conflict: the account exists; fetch by search again
    const refetch = await this.request<KbAccount[]>("GET", `/accounts/search/${encodeURIComponent(externalKey)}`);
    const match = refetch.data?.find((a) => a.externalKey === externalKey && a.accountId);
    if (!match) throw billingUnavailable();
    return match.accountId;
  }

  async ensureExternalPaymentMethod(accountId: string): Promise<string> {
    const acc = await this.request<{ paymentMethodId: string | null }>("GET", `/accounts/${accountId}`);
    if (acc.data?.paymentMethodId) return acc.data.paymentMethodId;
    const existing = await this.listPaymentMethods(accountId);
    if (existing) return existing;
    const pm = await this.request<unknown>(
      "POST",
      `/accounts/${accountId}/paymentMethods`,
      { pluginName: "__EXTERNAL_PAYMENT__", isDefault: true },
      { pluginName: "__EXTERNAL_PAYMENT__", isDefault: "true" }
    );
    if (pm.status === 400 && (pm.data as { code?: number } | null)?.code === 7023) {
      const found = await this.listPaymentMethods(accountId);
      if (found) return found;
    }
    const found = await this.listPaymentMethods(accountId);
    if (!found) throw billingUnavailable();
    return found;
  }

  private async listPaymentMethods(accountId: string): Promise<string | null> {
    const res = await this.request<{ paymentMethodId: string; pluginName: string }[]>(
      "GET",
      `/accounts/${accountId}/paymentMethods`
    );
    const pm = res.data?.find((p) => p.pluginName === "__EXTERNAL_PAYMENT__") ?? res.data?.[0];
    return pm?.paymentMethodId ?? null;
  }

  /** Creates an invoice of external charges and returns it committed. */
  async createInvoice(accountId: string, items: { description: string; amountCents: number }[]): Promise<{ invoiceId: string; itemIds: string[] }> {
    const res = await this.request<
      { invoiceId: string; invoiceItemId: string }[]
    >("POST", `/invoices/charges/${accountId}`, items.map((i) => ({
      quantity: 1,
      amount: centsToDollars(i.amountCents),
      currency: "USD",
      description: i.description,
      itemType: "EXTERNAL_CHARGE",
    })), { commitInvoice: "true" });
    if (res.status !== 200 && res.status !== 201) throw billingUnavailable();
    const list = res.data ?? [];
    if (list.length !== items.length) throw billingUnavailable();
    const invoiceId = list[0]?.invoiceId ?? "";
    const itemIds = list.map((i) => i.invoiceItemId);
    return { invoiceId, itemIds };
  }

  /** Looks up an invoice item's current amount net of adjustments. */
  async getInvoice(invoiceId: string): Promise<{ amountCents: number; balanceCents: number; status: string; items: { invoiceItemId: string; description: string; amountCents: number }[] } | null> {
    const res = await this.request<KbInvoice>("GET", `/invoices/${invoiceId}`);
    if (res.status !== 200 || !res.data) return null;
    return {
      amountCents: dollarsToCents(res.data.amount),
      balanceCents: typeof res.data.balance === "number" ? dollarsToCents(res.data.balance) : 0,
      status: res.data.status,
      items: (res.data.items ?? []).map((i) => ({
        invoiceItemId: i.invoiceItemId,
        description: i.description,
        amountCents: dollarsToCents(i.amount),
      })),
    };
  }

  /**
   * A PURCHASE against an invoice, idempotent on its transaction external key.
   * Returns the payment id when the transaction is confirmed.
   */
  async purchase(accountId: string, paymentMethodId: string, invoiceId: string, amountCents: number, externalKey: string): Promise<{ paymentId: string; paymentExternalKey: string }> {
    const existing = await this.lookupTransaction(externalKey);
    if (existing) return { paymentId: existing.paymentId, paymentExternalKey: externalKey };
    const res = await this.request<unknown>("POST", `/accounts/${accountId}/payments`, {
      transactionType: "PURCHASE",
      amount: centsToDollars(amountCents),
      currency: "USD",
      transactionExternalKey: externalKey,
      paymentExternalKey: externalKey,
    }, { paymentMethodId, targetInvoiceId: invoiceId });
    if (res.status === 201 || res.status === 200 || res.status === 204) {
      // Kill Bill does not always answer with a Location header here; the
      // confirmed transaction lookup is the reliable source of the payment id.
      const found = await this.lookupTransaction(externalKey);
      if (found) return { paymentId: found.paymentId, paymentExternalKey: externalKey };
      if (res.location) {
        const id = res.location.split("/").pop();
        if (id) return { paymentId: id, paymentExternalKey: externalKey };
      }
    }
    if (res.status === 400 && (res.data as { code?: number } | null)?.code === 7030) {
      const existing2 = await this.lookupTransaction(externalKey);
      if (existing2) return { paymentId: existing2.paymentId, paymentExternalKey: externalKey };
    }
    throw billingUnavailable();
  }

  async lookupTransaction(externalKey: string): Promise<{ paymentId: string; status: string; amountCents: number } | null> {
    const res = await this.request<KbPayment[]>("GET", `/payments/search/${encodeURIComponent(externalKey)}`);
    const payment = res.data?.find((p) => (p.transactions ?? []).some((t) => t.transactionExternalKey === externalKey && t.status === "SUCCESS"));
    if (!payment) return null;
    const txn = (payment.transactions ?? []).find((t) => t.transactionExternalKey === externalKey);
    return { paymentId: payment.paymentId, status: txn?.status ?? "", amountCents: dollarsToCents(txn?.amount ?? 0) };
  }

  private async paymentIdFromTransaction(externalKey: string): Promise<string> {
    const found = await this.lookupTransaction(externalKey);
    if (!found) throw billingUnavailable();
    return found.paymentId;
  }

  async paymentById(paymentId: string): Promise<{ purchasedCents: number; refundedCents: number } | null> {
    const res = await this.request<KbPayment>("GET", `/payments/${paymentId}`);
    if (res.status !== 200 || !res.data) return null;
    return {
      purchasedCents: dollarsToCents(res.data.purchasedAmount ?? 0),
      refundedCents: dollarsToCents(res.data.refundedAmount ?? 0),
    };
  }

  /**
   * A REFUND with an invoice-item adjustment, idempotent on its transaction
   * external key. Returns true when the refund is confirmed.
   */
  async refund(paymentId: string, invoiceItemId: string, amountCents: number, externalKey: string, paymentExternalKey: string): Promise<boolean> {
    const existing = await this.lookupTransaction(externalKey);
    if (existing) return true;
    const res = await this.request<unknown>("POST", `/invoicePayments/${paymentId}/refunds`, {
      transactionType: "REFUND",
      amount: centsToDollars(amountCents),
      currency: "USD",
      transactionExternalKey: externalKey,
      paymentExternalKey: paymentExternalKey,
      adjustments: [{ invoiceItemId, quantity: 1, amount: centsToDollars(amountCents), currency: "USD" }],
    });
    if (res.status === 201 || res.status === 200 || res.status === 204) return true;
    if (res.status === 400 && (res.data as { code?: number } | null)?.code === 7030) return true;
    throw billingUnavailable();
  }

  async isReachable(): Promise<boolean> {
    try {
      const res = await this.request<unknown>("GET", "/accounts/pagination", undefined, { limit: "1" });
      return res.status < 500;
    } catch {
      return false;
    }
  }
}

interface KbAccount {
  accountId: string;
  externalKey: string;
}

interface KbInvoice {
  amount: number;
  balance: number | string;
  status: string;
  items: { invoiceItemId: string; description: string; amount: number }[] | null;
}

interface KbPayment {
  paymentId: string;
  purchasedAmount?: number;
  refundedAmount?: number;
  transactions: { transactionExternalKey: string; status: string; amount: number }[] | null;
}

export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}
