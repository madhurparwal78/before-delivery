import { AppConfig } from "./config.js";
import { centsToDecimalString, decimalToCents } from "../shared/domain.js";

/**
 * Kill Bill client. Accounts, external charge invoices, payments and read-back.
 * Amounts cross the wire as decimal dollars with exactly two decimals, built
 * from integer cents without floating-point arithmetic (DP: Services/Kill Bill).
 */

export interface KbAccount {
  accountId: string;
  externalKey: string;
  name: string;
  email: string;
  currency: string;
  timeZone: string;
  company: string | null;
  paymentMethodId: string | null;
}

export interface KbInvoice {
  invoiceId: string;
  invoiceNumber: string;
  status: string;
  amountCents: number;
  balanceCents: number;
  currency: string;
  accountId: string;
  itemDescriptions: { description: string; startDate: string; amountCents: number }[];
  itemStartDate: string | null;
}

export interface KbPayment {
  paymentId: string;
  paymentExternalKey: string;
  purchasedAmountCents: number;
}

export class KillBillUnavailable extends Error {
  constructor(public readonly detail: string) {
    super(`Kill Bill unreachable: ${detail}`);
  }
}

export class KillBillError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | null,
    message: string,
  ) {
    super(message);
  }
}

interface KbTransaction {
  transactionType: string;
  status: string;
  amount: number;
}

interface KbPaymentJson {
  paymentId: string;
  paymentExternalKey: string;
  purchasedAmount: number;
  transactions: KbTransaction[];
}

export class KillBill {
  private readonly base: string;

  constructor(private readonly config: AppConfig) {
    this.base = `${config.killbill.url}/1.0/kb`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      "X-Killbill-ApiKey": this.config.killbill.apiKey,
      "X-Killbill-ApiSecret": this.config.killbill.apiSecret,
      Authorization: `Basic ${Buffer.from(
        `${this.config.killbill.username}:${this.config.killbill.password}`,
      ).toString("base64")}`,
      "X-Killbill-CreatedBy": "earshot",
      "Content-Type": "application/json",
      ...extra,
    };
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    query: Record<string, string> = {},
  ): Promise<{ status: number; location: string | null; body: string }> {
    const url = new URL(`${this.base}${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: this.headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      throw new KillBillUnavailable(error instanceof Error ? error.message : String(error));
    }
    const text = await response.text();
    if (response.status >= 500) {
      throw new KillBillUnavailable(`status ${response.status}: ${text.slice(0, 200)}`);
    }
    return {
      status: response.status,
      location: response.headers.get("location"),
      body: text,
    };
  }

  private parse<T>(text: string): T {
    return JSON.parse(text) as T;
  }

  async findAccountByExternalKey(externalKey: string): Promise<KbAccount | null> {
    const response = await this.request("GET", "/accounts", undefined, { externalKey });
    if (response.status === 404) return null;
    if (response.status !== 200) throw this.error(response.status, response.body);
    return this.accountFrom(this.parse<Record<string, unknown>>(response.body));
  }

  async createAccount(input: {
    externalKey: string;
    name: string;
    email: string;
    company: string;
    timeZone: string;
  }): Promise<KbAccount> {
    const response = await this.request("POST", "/accounts", {
      externalKey: input.externalKey,
      name: input.name,
      email: input.email,
      company: input.company,
      currency: "USD",
      timeZone: input.timeZone,
    });
    if (response.status !== 201) throw this.error(response.status, response.body);
    const accountId = response.location ? response.location.split("/").pop() || "" : "";
    return {
      accountId,
      externalKey: input.externalKey,
      name: input.name,
      email: input.email,
      currency: "USD",
      timeZone: input.timeZone,
      company: input.company,
      paymentMethodId: null,
    };
  }

  private async ensureExternalPaymentMethod(accountId: string): Promise<void> {
    // Kill Bill's built-in external payment plugin backs the default payment
    // method. The first external payment auto-creates the method; making it the
    // account default keeps the booking convention on one method.
    const existing = await this.request("GET", `/accounts/${accountId}/paymentMethods`);
    if (existing.status === 200) {
      const methods = this.parse<Array<{ paymentMethodId: string; pluginName: string; isDefault: boolean }>>(
        existing.body,
      );
      const external = methods.find((m) => m.pluginName === "__EXTERNAL_PAYMENT__");
      if (external && !external.isDefault) {
        await this.request(
          "PUT",
          `/accounts/${accountId}/paymentMethods/${external.paymentMethodId}/setDefault`,
          undefined,
          { payAllUnpaidInvoices: "false" },
        );
      }
      if (external) return;
    }
    const created = await this.request(
      "POST",
      `/accounts/${accountId}/paymentMethods`,
      { accountId, pluginName: "__EXTERNAL_PAYMENT__", isDefault: true },
      { isDefault: "true" },
    );
    if (created.status >= 400) {
      // The external payment method may already exist from an earlier external
      // charge; that is fine because the method exists either way.
      const recheck = await this.request("GET", `/accounts/${accountId}/paymentMethods`);
      if (recheck.status !== 200) {
        throw this.error(created.status, created.body);
      }
    }
  }

  async ensureAccount(input: {
    externalKey: string;
    name: string;
    email: string;
    company: string;
    timeZone: string;
  }): Promise<KbAccount> {
    const existing = await this.findAccountByExternalKey(input.externalKey);
    if (existing) return existing;
    try {
      const account = await this.createAccount(input);
      await this.ensureExternalPaymentMethod(account.accountId);
      return account;
    } catch (error) {
      if (error instanceof KillBillError && error.status === 409) {
        const retry = await this.findAccountByExternalKey(input.externalKey);
        if (retry) return retry;
      }
      throw error;
    }
  }

  async createExternalChargeInvoice(input: {
    accountId: string;
    description: string;
    amountCents: number;
    startDate: string;
    autoCommit: boolean;
  }): Promise<KbInvoice> {
    const response = await this.request(
      "POST",
      `/invoices/charges/${input.accountId}`,
      [
        {
          description: input.description,
          amount: centsToDecimalString(input.amountCents),
          currency: "USD",
          startDate: input.startDate,
        },
      ],
      { autoCommit: input.autoCommit ? "true" : "false", requestedDate: input.startDate },
    );
    if (response.status >= 400) throw this.error(response.status, response.body);
    const items = this.parse<
      Array<{ invoiceId: string; description: string; startDate: string; amount: number }>
    >(response.body);
    const first = items[0];
    const invoice = await this.getInvoice(first.invoiceId);
    if (input.autoCommit && invoice.status === "DRAFT") {
      await this.commitInvoice(invoice.invoiceId);
      return (await this.getInvoice(invoice.invoiceId)) as KbInvoice;
    }
    return invoice;
  }

  async commitInvoice(invoiceId: string): Promise<void> {
    const response = await this.request("PUT", `/invoices/${invoiceId}/commitInvoice`);
    if (response.status >= 400 && response.status !== 404) {
      throw this.error(response.status, response.body);
    }
  }

  async voidInvoice(invoiceId: string): Promise<void> {
    const response = await this.request("PUT", `/invoices/${invoiceId}/voidInvoice`);
    if (response.status >= 400 && response.status !== 404) {
      // A 400 covers invoices that can no longer be voided (already paid); the
      // state Kill Bill holds is authoritative either way.
      throw this.error(response.status, response.body);
    }
  }

  async getInvoice(invoiceId: string): Promise<KbInvoice> {
    const response = await this.request("GET", `/invoices/${invoiceId}`);
    if (response.status === 404) throw new KillBillError(404, "not_found", "Invoice not found.");
    if (response.status >= 400) throw this.error(response.status, response.body);
    return this.invoiceFrom(this.parse<Record<string, unknown>>(response.body));
  }

  async getInvoiceByNumber(invoiceNumber: string): Promise<KbInvoice | null> {
    const response = await this.request("GET", `/invoices/byNumber/${invoiceNumber}`);
    if (response.status === 404) return null;
    if (response.status >= 400) throw this.error(response.status, response.body);
    return this.invoiceFrom(this.parse<Record<string, unknown>>(response.body));
  }

  async listInvoices(accountId: string): Promise<KbInvoice[]> {
    const response = await this.request("GET", `/accounts/${accountId}/invoices`, undefined, {
      includeInvoiceComponents: "true",
    });
    if (response.status >= 400) throw this.error(response.status, response.body);
    const list = this.parse<Array<Record<string, unknown>>>(response.body);
    return list.map((entry) => this.invoiceFrom(entry));
  }

  async findPaymentByExternalKey(externalKey: string): Promise<KbPayment | null> {
    const response = await this.request("GET", `/payments/search/${encodeURIComponent(externalKey)}`);
    if (response.status >= 400) throw this.error(response.status, response.body);
    const list = this.parse<KbPaymentJson[]>(response.body);
    const match = list.find((p) => p.paymentExternalKey === externalKey);
    return match ? this.paymentFrom(match) : null;
  }

  /** Payment ids recorded against an invoice, through the account's payments. */
  async listInvoicePayments(invoiceId: string): Promise<string[]> {
    const invoice = await this.getInvoice(invoiceId);
    const payments = await this.request("GET", `/accounts/${invoice.accountId}/invoicePayments`);
    if (payments.status >= 400) return [];
    const list = this.parse<Array<{ targetInvoiceId: string; paymentId: string }>>(payments.body);
    return list.filter((entry) => entry.targetInvoiceId === invoiceId).map((entry) => entry.paymentId);
  }

  async recordPurchase(input: {
    accountId: string;
    invoiceId: string;
    amountCents: number;
    externalKey: string;
  }): Promise<KbPayment> {
    const body = {
      accountId: input.accountId,
      targetInvoiceId: input.invoiceId,
      paymentExternalKey: input.externalKey,
      purchasedAmount: centsToDecimalString(input.amountCents),
      currency: "USD",
      transactions: [
        {
          transactionExternalKey: `${input.externalKey}-tx`,
          amount: centsToDecimalString(input.amountCents),
          currency: "USD",
          transactionType: "PURCHASE",
          status: "SUCCESS",
        },
      ],
    };
    const response = await this.request(
      "POST",
      `/invoices/${input.invoiceId}/payments`,
      body,
      { externalPayment: "true" },
    );
    if (response.status >= 400) throw this.error(response.status, response.body);
    if (response.location) {
      const paymentId = response.location.split("/").pop() || "";
      const read = await this.request("GET", `/payments/${paymentId}`);
      if (read.status === 200) return this.paymentFrom(this.parse<KbPaymentJson>(read.body));
    }
    const payment = await this.findPaymentByExternalKey(input.externalKey);
    if (!payment) throw new KillBillError(500, null, "Payment could not be read back.");
    return payment;
  }

  private accountFrom(json: Record<string, unknown>): KbAccount {
    return {
      accountId: String(json.accountId),
      externalKey: String(json.externalKey ?? ""),
      name: String(json.name ?? ""),
      email: String(json.email ?? ""),
      currency: String(json.currency ?? "USD"),
      timeZone: String(json.timeZone ?? ""),
      company: (json.company as string | null) ?? null,
      paymentMethodId: (json.paymentMethodId as string | null) ?? null,
    };
  }

  private invoiceFrom(json: Record<string, unknown>): KbInvoice {
    const items = ((json.items as Array<Record<string, unknown>>) || []).map((item) => ({
      description: String(item.description ?? ""),
      startDate: String(item.startDate ?? ""),
      amountCents: decimalToCents(String(item.amount ?? "0")),
    }));
    const amount = json.amount;
    const balance = json.balance;
    // An unpaid invoice's balance can come back null in search results; the
    // single invoice read always reports the number. Treat null as the amount.
    return {
      invoiceId: String(json.invoiceId),
      invoiceNumber: String(json.invoiceNumber ?? ""),
      status: String(json.status ?? ""),
      amountCents: amount === null || amount === undefined ? 0 : decimalToCents(String(amount)),
      balanceCents: balance === null || balance === undefined ? 0 : decimalToCents(String(balance)),
      currency: String(json.currency ?? "USD"),
      accountId: String(json.accountId ?? ""),
      itemDescriptions: items,
      itemStartDate: items.length > 0 ? items[0].startDate : null,
    };
  }

  private paymentFrom(json: KbPaymentJson): KbPayment {
    return {
      paymentId: json.paymentId,
      paymentExternalKey: json.paymentExternalKey,
      purchasedAmountCents: decimalToCents(String(json.purchasedAmount ?? "0")),
    };
  }

  private error(status: number, body: string): KillBillError {
    let code: string | null = null;
    let message = body.slice(0, 300);
    try {
      const parsed = JSON.parse(body) as { code?: number; message?: string };
      code = parsed.code !== undefined ? String(parsed.code) : null;
      if (parsed.message) message = parsed.message;
    } catch {
      // Not JSON; keep the raw text.
    }
    return new KillBillError(status, code, message);
  }
}
