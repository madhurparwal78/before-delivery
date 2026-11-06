// Kill Bill client: one account and one committed, paid invoice per top-up.
import { S3StatusError } from "./storage.js";

export interface KillBillConfig {
  url: string;
  username: string;
  password: string;
  apiKey: string;
  apiSecret: string;
}

export interface TopUpBillingResult {
  accountId: string;
  invoiceId: string;
  paymentId: string;
}

export class BillingUnavailableError extends Error {}
export class BillingRejectedError extends Error {}
export class BillingTimeoutError extends BillingUnavailableError {}

interface KbInvoiceItem {
  invoiceId: string;
}
interface KbPayment {
  paymentId: string;
}
interface KbAccount {
  accountId: string;
}

export class KillBill {
  constructor(private cfg: KillBillConfig) {}

  private async call(method: string, path: string, body?: unknown, timeoutMs = 10_000): Promise<{ status: number; json: unknown; location?: string }> {
    const auth = Buffer.from(`${this.cfg.username}:${this.cfg.password}`).toString("base64");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.cfg.url}${path}`, {
        method,
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Killbill-ApiKey": this.cfg.apiKey,
          "X-Killbill-ApiSecret": this.cfg.apiSecret,
          "X-Killbill-CreatedBy": "dispatch",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        redirect: "manual",
      });
    } catch (e) {
      throw new BillingUnavailableError(`killbill unreachable: ${String(e)}`);
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 500 || res.status === 429) throw new BillingUnavailableError(`killbill status ${res.status}`);
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json, location: res.headers.get("location") ?? undefined };
  }

  /** The account for a team, created on first use. */
  async accountFor(teamId: string, teamName: string): Promise<string> {
    const found = await this.call("GET", `/1.0/kb/accounts?externalKey=${encodeURIComponent(teamId)}`);
    if (found.status === 404) {
      const created = await this.call("POST", "/1.0/kb/accounts", { externalKey: teamId, name: teamName, currency: "USD" });
      if (created.status >= 400) throw new BillingRejectedError(`account create failed: ${JSON.stringify(created.json)}`);
      const loc = created.location;
      if (!loc) throw new BillingRejectedError("account create returned no location");
      return loc.substring(loc.lastIndexOf("/") + 1);
    }
    if (found.status >= 400) throw new BillingRejectedError(`account lookup failed`);
    const acct = found.json as KbAccount;
    if (!acct?.accountId) throw new BillingRejectedError("account lookup returned no id");
    return acct.accountId;
  }

  /** An existing invoice described "Dispatch credits <top-up id>" on the account, if any. */
  async findInvoiceByDescription(accountId: string, topUpId: string): Promise<{ invoiceId: string; paid: boolean } | null> {
    const res = await this.call("GET", `/1.0/kb/accounts/${accountId}/invoices`);
    if (res.status >= 400) throw new BillingRejectedError("invoice lookup failed");
    const invoices = res.json as { invoiceId: string }[];
    if (!Array.isArray(invoices)) return null;
    const wanted = `Dispatch credits ${topUpId}`;
    for (const inv of invoices) {
      const full = await this.call("GET", `/1.0/kb/invoices/${inv.invoiceId}`);
      const detail = full.json as { items: { description: string }[] } | null;
      if (detail && Array.isArray(detail.items) && detail.items.some((it) => it.description === wanted)) {
        const payments = await this.invoicePayments(inv.invoiceId);
        return { invoiceId: inv.invoiceId, paid: payments.length > 0 };
      }
    }
    return null;
  }

  async invoicePayments(invoiceId: string): Promise<KbPayment[]> {
    const res = await this.call("GET", `/1.0/kb/invoices/${invoiceId}/payments`);
    if (res.status >= 400) return [];
    const p = res.json as KbPayment[];
    return Array.isArray(p) ? p : [];
  }

  /** One committed external-charge invoice of the given amount, described with the top-up id. */
  async createInvoice(accountId: string, topUpId: string, amountUsd: string): Promise<string> {
    const res = await this.call(
      "POST",
      `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`,
      [{ amount: Number(amountUsd), currency: "USD", description: `Dispatch credits ${topUpId}` }],
    );
    if (res.status >= 400) throw new BillingRejectedError(`invoice create failed: ${JSON.stringify(res.json)}`);
    const items = res.json as KbInvoiceItem[];
    if (!Array.isArray(items) || items.length === 0 || !items[0].invoiceId) {
      throw new BillingRejectedError("invoice create returned no invoice");
    }
    return items[0].invoiceId;
  }

  /** Pay the invoice in full with one successful PURCHASE payment. */
  async payInvoice(accountId: string, invoiceId: string): Promise<string> {
    const methodId = await this.externalPaymentMethod(accountId);
    const query = methodId ? `?paymentMethodId=${methodId}` : "";
    const pay = await this.call("POST", `/1.0/kb/invoices/${invoiceId}/payments${query}`, { accountId });
    if (pay.status >= 400) throw new BillingRejectedError(`payment failed: ${JSON.stringify(pay.json)}`);
    const loc = pay.location;
    if (!loc) throw new BillingRejectedError("payment returned no location");
    return loc.replace(/\/+$/, "").split("/").pop() as string;
  }

  /** The account's external payment method, created on first use. */
  private async externalPaymentMethod(accountId: string): Promise<string> {
    const list = await this.call("GET", `/1.0/kb/accounts/${accountId}/paymentMethods`);
    if (list.status < 400) {
      const methods = list.json as { paymentMethodId: string; pluginName?: string; isDefault?: boolean }[];
      if (Array.isArray(methods) && methods.length > 0) {
        const external = methods.find((m) => m.pluginName === "__EXTERNAL_PAYMENT__");
        return (external ?? methods[0]).paymentMethodId;
      }
    }
    const pm = await this.call("POST", `/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`, {
      accountId,
      isDefault: true,
      pluginName: "__EXTERNAL_PAYMENT__",
    });
    if (pm.status >= 400) throw new BillingRejectedError(`payment method failed: ${JSON.stringify(pm.json)}`);
    const loc = pm.location;
    if (!loc) throw new BillingRejectedError("payment method returned no location");
    return loc.substring(loc.lastIndexOf("/") + 1);
  }

  /** The full top-up flow: account, one invoice, one successful purchase payment. */
  async recordTopUp(teamId: string, teamName: string, topUpId: string, amountUsd: string): Promise<TopUpBillingResult> {
    const accountId = await this.accountFor(teamId, teamName);
    const existing = await this.findInvoiceByDescription(accountId, topUpId);
    let invoiceId: string;
    let paid: boolean;
    if (existing) {
      invoiceId = existing.invoiceId;
      paid = existing.paid;
    } else {
      invoiceId = await this.createInvoice(accountId, topUpId, amountUsd);
      paid = false;
    }
    let paymentId: string;
    if (paid) {
      const payments = await this.invoicePayments(invoiceId);
      paymentId = payments[0]?.paymentId ?? "";
    } else {
      paymentId = await this.payInvoice(accountId, invoiceId);
    }
    return { accountId, invoiceId, paymentId };
  }
}

// Re-export so callers can pattern-match storage/billing errors uniformly.
export { S3StatusError };
