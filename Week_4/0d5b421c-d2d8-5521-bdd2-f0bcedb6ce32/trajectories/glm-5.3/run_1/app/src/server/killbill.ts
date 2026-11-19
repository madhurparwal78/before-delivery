import { request } from "undici";
import type { Config } from "./config.js";

/** Kill Bill HTTP client using basic auth and tenant headers. */
export class KillBill {
  private cfg: Config;
  private healthy = true;
  private readonly timeoutMs = 10_000;

  constructor(cfg: Config) {
    this.cfg = cfg;
  }

  private headers(): Record<string, string> {
    const auth = Buffer.from(`${this.cfg.killbillUsername}:${this.cfg.killbillPassword}`).toString("base64");
    return {
      "Authorization": `Basic ${auth}`,
      "X-Killbill-ApiKey": this.cfg.killbillApiKey,
      "X-Killbill-ApiSecret": this.cfg.killbillApiSecret,
      "X-Killbill-CreatedBy": "saffron-slate",
      "Content-Type": "application/json",
    };
  }

  private url(path: string): string {
    return `${this.cfg.killbillUrl}/1.0/kb${path}`;
  }

  private async do<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T | null; location: string | null }> {
    const opts: Record<string, unknown> = {
      method,
      headers: this.headers(),
      bodyTimeout: this.timeoutMs,
      headersTimeout: this.timeoutMs,
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await request(this.url(path), opts);
    const text = await res.body.text();
    const location = typeof res.headers["location"] === "string" ? res.headers["location"] : null;
    let data: T | null = null;
    if (text) {
      try { data = JSON.parse(text) as T; } catch { data = null; }
    }
    this.healthy = true;
    return { status: res.statusCode, data, location };
  }

  async ping(): Promise<boolean> {
    try {
      // A cheap call that requires the tenant to be resolvable.
      const res = await request(this.url("/accounts/pagination?limit=1"), {
        method: "GET",
        headers: this.headers(),
        bodyTimeout: this.timeoutMs,
        headersTimeout: this.timeoutMs,
      });
      await res.body.text();
      this.healthy = res.statusCode < 500;
      return this.healthy;
    } catch {
      this.healthy = false;
      return false;
    }
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  /** Find an account by external key (the lowercased guest email). */
  async findAccount(externalKey: string): Promise<string | null> {
    const { status, data } = await this.do<{ accountId: string }>("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`);
    if (status === 404 || !data) return null;
    if (status !== 200) throw new Error("killbill_error");
    return data.accountId;
  }

  /** Create the guest account; an existing account (by email key) is reused. */
  async createAccount(email: string, name: string): Promise<string> {
    const existing = await this.findAccount(email);
    if (existing) return existing;
    const { status, data, location } = await this.do("POST", "/accounts", {
      name,
      email,
      currency: "EUR",
      externalKey: email,
    });
    if (status === 201) {
      const fromLocation = location ? location.split("/").pop() : null;
      const fromBody = data && typeof data === "object" && "accountId" in (data as Record<string, unknown>)
        ? String((data as Record<string, unknown>).accountId)
        : null;
      const accountId = fromLocation ?? fromBody;
      if (accountId) return accountId;
    }
    // The account may have been created concurrently.
    const after = await this.findAccount(email);
    if (after) return after;
    throw new Error("killbill_error");
  }

  /** Ensure the account has the built-in external payment method set as default. */
  async ensurePaymentMethod(accountId: string): Promise<string> {
    const { status, data } = await this.do<{ paymentMethodId: string | null }>("GET", `/accounts/${accountId}`);
    if (status !== 200 || !data) throw new Error("killbill_error");
    if (data.paymentMethodId) return data.paymentMethodId;
    const res = await this.do("POST", `/accounts/${accountId}/paymentMethods?isDefault=true&pluginName=__EXTERNAL_PAYMENT__`, {
      pluginName: "__EXTERNAL_PAYMENT__",
      pluginInfo: { isDefaultPaymentMethod: true, externalPaymentMethodId: "manual" },
    });
    if (res.status !== 201) throw new Error("killbill_error");
    // Read the account again to get the payment method id.
    const after = await this.do<{ paymentMethodId: string | null }>("GET", `/accounts/${accountId}`);
    if (after.status === 200 && after.data?.paymentMethodId) return after.data.paymentMethodId;
    throw new Error("killbill_error");
  }

  /** One PURCHASE for the deposit. Returns payment and transaction ids. */
  async purchase(
    accountId: string, paymentMethodId: string, reference: string, amountCents: number,
  ): Promise<{ paymentId: string; transactionId: string }> {
    const amount = amountCents / 100;
    const url = `/accounts/${accountId}/payments?paymentMethodId=${paymentMethodId}`;
    const { status, data } = await this.do<{
      paymentId: string; transactions: { transactionId: string; status: string; transactionExternalKey: string }[];
    }>("POST", url, {
      transactionType: "PURCHASE",
      amount,
      currency: "EUR",
      paymentExternalKey: reference,
      transactionExternalKey: `${reference}-deposit`,
    });
    if (status !== 201) {
      if (status === 400 || status === 402 || status === 404) throw new Error("payment_failed");
      throw new Error("killbill_error");
    }
    // The 201 body may be empty; read the payment back by its external key.
    let payment = data;
    if (!payment || !payment.paymentId) {
      payment = await this.do<{ paymentId: string; transactions: { transactionId: string; status: string; transactionExternalKey: string }[] }>(
        "GET", `/payments?externalKey=${encodeURIComponent(reference)}`,
      ).then((r) => r.data);
    }
    if (!payment) throw new Error("killbill_error");
    const txn = (payment.transactions ?? []).find((t) => t.transactionExternalKey === `${reference}-deposit`);
    if (!txn || txn.status !== "SUCCESS") throw new Error("payment_failed");
    return { paymentId: payment.paymentId, transactionId: txn.transactionId };
  }

  /** Refund a payment in full. */
  async refund(paymentId: string, reference: string, amountCents: number): Promise<void> {
    const amount = amountCents / 100;
    const { status } = await this.do("POST", `/payments/${paymentId}/refunds`, {
      amount,
      currency: "EUR",
      transactionExternalKey: `${reference}-refund`,
    });
    if (status === 201) return;
    if (status === 400 || status === 404) throw new Error("payment_failed");
    throw new Error("killbill_error");
  }
}

/** Distinguish "Kill Bill unreachable" (503) from "payment declined" (402). */
export function isUnreachable(e: unknown): boolean {
  return e instanceof Error && (e.message === "killbill_error" || e.message === "valkey_unavailable");
}
