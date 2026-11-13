// Kill Bill over its REST API: agency accounts, DRAFT invoices of external charges, commit, read back.
import type { Config } from "../config.js";
import { dollarsField } from "../../shared/numerals.js";
import { ProviderError } from "./providerError.js";

const TIMEOUT_MS = 10_000;

interface KillBillItem {
  itemDetails?: string | null;
}

interface KillBillInvoice {
  invoiceId: string;
  invoiceNumber: string | number | null;
  status: string;
  balance: number;
  items?: KillBillItem[];
}

interface ChargeItem {
  description: string;
  amount_cents: number;
}

export class KillBill {
  constructor(private readonly config: Config["killbill"]) {}

  private headers(): Record<string, string> {
    const basic = Buffer.from(`${this.config.username}:${this.config.credential}`).toString("base64");
    return {
      Authorization: `Basic ${basic}`,
      "X-Killbill-ApiKey": this.config.apiKey,
      "X-Killbill-ApiSecret": this.config.apiSecret,
      "X-Killbill-CreatedBy": "slackwater",
      Accept: "application/json",
      "Content-Type": "application/json",
    };
  }

  private async call(method: string, path: string, body?: unknown): Promise<{ status: number; text: string }> {
    if (!this.config.url) throw new ProviderError("KILLBILL_URL is not set");
    try {
      const response = await fetch(`${this.config.url}${path}`, {
        method,
        headers: this.headers(),
        body: body === undefined ? null : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return { status: response.status, text: await response.text() };
    } catch (error) {
      throw new ProviderError(`Kill Bill ${method} ${path}: ${String(error)}`);
    }
  }

  private async expect<T>(method: string, path: string, statuses: number[], body?: unknown): Promise<T | null> {
    const reply = await this.call(method, path, body);
    if (!statuses.includes(reply.status)) throw new ProviderError(`Kill Bill ${method} ${path} answered ${reply.status}`);
    return reply.text ? (JSON.parse(reply.text) as T) : null;
  }

  /** Up when the tenant's API answers an authenticated read, the same path charge posting needs. */
  async reachable(): Promise<boolean> {
    if (!this.config.url) return false;
    try {
      const response = await fetch(`${this.config.url}/1.0/kb/accounts/pagination?offset=0&limit=1`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(3000),
      });
      await response.body?.cancel();
      return response.ok;
    } catch {
      return false;
    }
  }

  /** The agency's account by external key; created only when none exists (several instances share a tenant). */
  async accountFor(code: string, name: string): Promise<string> {
    const found = await this.lookup(code);
    if (found) return found;
    const reply = await this.call("POST", "/1.0/kb/accounts", { name, externalKey: code, currency: "CAD" });
    if (reply.status !== 201 && reply.status !== 409) throw new ProviderError(`account create answered ${reply.status}`);
    const account = await this.lookup(code);
    if (!account) throw new ProviderError(`account ${code} missing after create`);
    return account;
  }

  private async lookup(code: string): Promise<string | null> {
    const reply = await this.call("GET", `/1.0/kb/accounts?externalKey=${encodeURIComponent(code)}`);
    if (reply.status === 404) return null;
    if (reply.status !== 200) throw new ProviderError(`account lookup answered ${reply.status}`);
    return (JSON.parse(reply.text) as { accountId: string }).accountId;
  }

  /** Posts one DRAFT invoice holding one EXTERNAL_CHARGE per line, tagged with the attempt id. */
  async postCharges(accountId: string, items: ChargeItem[], attempt: string): Promise<string> {
    const body = items.map((item) => ({
      accountId,
      description: item.description,
      amount: dollarsField(item.amount_cents),
      currency: "CAD",
      itemType: "EXTERNAL_CHARGE",
      itemDetails: JSON.stringify({ attempt }),
    }));
    const posted = await this.expect<{ invoiceId: string }[]>(
      "POST",
      `/1.0/kb/invoices/charges/${accountId}?autoCommit=false`,
      [200, 201],
      body,
    );
    const invoiceId = posted?.[0]?.invoiceId;
    if (!invoiceId) throw new ProviderError("charges posted without an invoice id");
    return invoiceId;
  }

  /** A DRAFT invoice on the account whose items carry one of these attempt ids, if an earlier attempt landed. */
  async draftFromAttempts(accountId: string, attempts: readonly string[]): Promise<string | null> {
    const invoices = await this.expect<KillBillInvoice[]>(
      "GET",
      `/1.0/kb/accounts/${accountId}/invoices?includeInvoiceComponents=true`,
      [200],
    );
    const match = (invoices ?? []).find(
      (invoice) =>
        invoice.status === "DRAFT" &&
        (invoice.items ?? []).some((item) => attempts.some((a) => (item.itemDetails ?? "").includes(`"${a}"`))),
    );
    return match?.invoiceId ?? null;
  }

  async invoice(invoiceId: string): Promise<{ status: string; number: string; balance_cents: number }> {
    const invoice = await this.expect<KillBillInvoice>("GET", `/1.0/kb/invoices/${invoiceId}`, [200]);
    if (!invoice) throw new ProviderError(`invoice ${invoiceId} read empty`);
    return {
      status: invoice.status,
      number: String(invoice.invoiceNumber),
      balance_cents: Math.round(invoice.balance * 100),
    };
  }

  /** Commits the invoice; an invoice already COMMITTED (an earlier reply was lost) is read back as is. */
  async commit(invoiceId: string): Promise<{ number: string; balance_cents: number }> {
    const reply = await this.call("PUT", `/1.0/kb/invoices/${invoiceId}/commitInvoice`);
    const invoice = await this.invoice(invoiceId);
    if (invoice.status !== "COMMITTED") throw new ProviderError(`commit answered ${reply.status}, invoice is ${invoice.status}`);
    return { number: invoice.number, balance_cents: invoice.balance_cents };
  }
}
