import type { Config } from "../config.ts";
import { ApiError } from "../errors.ts";

/**
 * Kill Bill client. One account per grower with the grower id as external key;
 * deposit and balance invoices are external charges; settling records one
 * external payment. Unreachable billing raises `ApiError.billing()` for the
 * caller to translate into the right behaviour.
 */

export interface KbInvoiceItem {
  invoiceId: string;
  amount: number;
  description: string;
}

interface KbResponse {
  status: number;
  body: unknown;
}

export class KillBillClient {
  private readonly config: Config;
  private readonly headers: Record<string, string>;

  constructor(config: Config) {
    this.config = config;
    const basic = Buffer.from(`${config.killbillUsername}:${config.killbillPassword}`).toString("base64");
    this.headers = {
      Authorization: `Basic ${basic}`,
      "X-Killbill-ApiKey": config.killbillApiKey,
      "X-Killbill-ApiSecret": config.killbillApiSecret,
      "Content-Type": "application/json",
      "X-Killbill-CreatedBy": "bloom-desk",
      "X-Killbill-Reason": "Swarmline Bloom Desk",
    };
  }

  private async request(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<KbResponse> {
    let url = `${this.config.killbillUrl}/1.0/kb${path}`;
    if (query) {
      url += `?${new URLSearchParams(query).toString()}`;
    }
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: this.headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw ApiError.billing();
    }
    if (response.status >= 500) throw ApiError.billing();
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  /** Decimal dollars for integer cents, e.g. 10800 -> 108.00. */
  private static dollars(cents: number): number {
    return Math.round(cents) / 100;
  }

  async ensureAccount(grower: { id: string; name: string; email: string }): Promise<string> {
    const existing = await this.request("GET", "/accounts", undefined, { externalKey: grower.id });
    if (existing.status === 200) {
      const account = existing.body as { accountId?: string } | null;
      if (account?.accountId) return account.accountId;
      throw ApiError.billing();
    }
    if (existing.status !== 404) throw ApiError.billing();
    const created = await this.request("POST", "/accounts", {
      name: grower.name,
      externalKey: grower.id,
      email: grower.email,
      currency: "USD",
    });
    if (created.status !== 201) throw ApiError.billing();
    const confirmed = await this.request("GET", "/accounts", undefined, { externalKey: grower.id });
    const account = confirmed.body as { accountId?: string } | null;
    if (confirmed.status !== 200 || !account?.accountId) throw ApiError.billing();
    return account.accountId;
  }

  /** One committed invoice holding the given external charges. */
  async createChargeInvoice(accountId: string, charges: readonly { description: string; cents: number }[]): Promise<string> {
    const response = await this.request("POST", `/invoices/charges/${accountId}`, charges.map((charge) => ({
      amount: KillBillClient.dollars(charge.cents),
      currency: "USD",
      description: charge.description,
    })), { autoCommit: "true" });
    const items = response.body as KbInvoiceItem[] | null;
    if (response.status !== 200 || !items?.[0]?.invoiceId) throw ApiError.billing();
    return items[0].invoiceId;
  }

  /** One account credit, committed so it can be voided if a later step fails. */
  async createCredit(accountId: string, cents: number, description: string): Promise<string> {
    const response = await this.request("POST", "/credits", [{
      amount: KillBillClient.dollars(cents),
      currency: "USD",
      description,
      accountId,
      itemType: "EXTERNAL_CHARGE",
    }], { autoCommit: "true" });
    const items = response.body as KbInvoiceItem[] | null;
    if (response.status !== 200 || !items?.[0]?.invoiceId) throw ApiError.billing();
    return items[0].invoiceId;
  }

  async voidInvoice(invoiceId: string): Promise<void> {
    const response = await this.request("PUT", `/invoices/${invoiceId}/voidInvoice`);
    if (response.status !== 204) throw ApiError.billing();
  }

  /**
   * One external payment against the account's unpaid invoices. The external
   * key makes retries exactly-once: a duplicate purchase on an already
   * successful key means the payment was recorded on an earlier attempt.
   */
  async recordPayment(accountId: string, invoiceId: string, cents: number, externalKey: string): Promise<void> {
    const response = await this.request("POST", `/invoices/${invoiceId}/payments`, {
      accountId,
      purchasedAmount: KillBillClient.dollars(cents),
      currency: "USD",
      paymentExternalKey: externalKey,
      targetInvoiceId: invoiceId,
    }, { externalPayment: "true" });
    if ([200, 201, 202, 204].includes(response.status)) return;
    const body = response.body as { message?: string } | null;
    if (response.status === 400 && (body?.message ?? "").includes("PURCHASE_SUCCESS")) return;
    throw ApiError.billing();
  }

  async getInvoice(invoiceId: string): Promise<{ status: string; balance: number } | null> {
    const response = await this.request("GET", `/invoices/${invoiceId}`);
    if (response.status !== 200) return null;
    return response.body as { status: string; balance: number };
  }
}
