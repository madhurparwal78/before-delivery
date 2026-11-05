import type { AppConfig } from "./config.js";
import { AppError } from "./errors.js";

export interface KillBillAccount {
  accountId: string;
  name: string;
  email: string;
  externalKey: string;
}

interface KillBillInvoiceItem {
  invoiceId: string;
  amount: number;
  description: string;
}

interface KillBillInvoice {
  invoiceId: string;
  status: string;
  balance: number;
  amount: number;
}

interface KillBillPayment {
  paymentId: string;
  paymentExternalKey: string;
  purchasedAmount: number;
  transactions: Array<{ transactionType: string; status: string; amount: number }>;
}

// Kill Bill client. All owed figures come from here.
export class KillBillClient {
  constructor(private cfg: AppConfig) {}

  private headers(): Record<string, string> {
    const auth = Buffer.from(`${this.cfg.killbill.username}:${this.cfg.killbill.password}`).toString("base64");
    return {
      Authorization: `Basic ${auth}`,
      "X-Killbill-ApiKey": this.cfg.killbill.apiKey,
      "X-Killbill-ApiSecret": this.cfg.killbill.apiSecret,
      "X-Killbill-CreatedBy": "shelfmark",
      "Content-Type": "application/json"
    };
  }

  private async request(method: string, path: string, body?: unknown, query?: string): Promise<{ status: number; json: unknown; location?: string }> {
    const url = `${this.cfg.killbill.url}/1.0/kb${path}${query ? (path.includes("?") ? "&" : "?") + query : ""}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: this.headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10000)
      });
    } catch {
      throw new AppError(503, "billing_unavailable", "Billing is unreachable.");
    }
    const location = res.headers.get("Location") ?? undefined;
    if (res.status === 204) return { status: 204, json: null, location };
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json, location };
  }

  async reachable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.cfg.killbill.url}/1.0/kb/tenants`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(4000)
      });
      return res.status > 0;
    } catch {
      return false;
    }
  }

  async getAccountByExternalKey(externalKey: string): Promise<KillBillAccount | null> {
    const res = await this.request("GET", `/accounts`, undefined, `externalKey=${encodeURIComponent(externalKey)}`);
    if (res.status === 404) return null;
    if (res.status !== 200) {
      throw new AppError(503, "billing_unavailable", "Billing is unreachable.");
    }
    const acc = res.json as KillBillAccount;
    if (!acc || !acc.accountId) return null;
    return acc;
  }

  async createAccount(externalKey: string, name: string, email: string): Promise<KillBillAccount> {
    const res = await this.request("POST", `/accounts`, {
      name,
      email,
      externalKey,
      currency: "USD"
    });
    if (res.status === 201) {
      const accountId = (res.location ?? "").split("/").pop() as string;
      return { accountId, name, email, externalKey };
    }
    if (res.status === 400) {
      const existing = await this.getAccountByExternalKey(externalKey);
      if (existing) return existing;
    }
    throw new AppError(503, "billing_unavailable", "Billing is unreachable.");
  }

  // One external charge on the owner's account. Returns the invoice id.
  async createCharge(externalKey: string, amountDollars: string, description: string): Promise<{ invoiceId: string }> {
    const account = await this.getOrCreateAccount(externalKey, description);
    const res = await this.request(
      "POST",
      `/invoices/charges/${account.accountId}`,
      [{ amount: Number(amountDollars), currency: "USD", description }],
      "autoCommit=true"
    );
    if (res.status !== 200) {
      throw new AppError(503, "billing_unavailable", "Billing is unreachable.");
    }
    const items = res.json as KillBillInvoiceItem[];
    if (!items || !items[0] || !items[0].invoiceId) {
      throw new AppError(503, "billing_unavailable", "Billing is unreachable.");
    }
    return { invoiceId: items[0].invoiceId };
  }

  async getOrCreateAccount(externalKey: string, _hint: string): Promise<KillBillAccount> {
    const existing = await this.getAccountByExternalKey(externalKey);
    if (existing) return existing;
    return this.createAccount(externalKey, _hint, externalKey);
  }

  // Creates the account when missing and corrects the recorded name and email.
  // Kill Bill's create refuses a taken key, so concurrent instances are safe.
  async ensureAccount(externalKey: string, name: string, email: string): Promise<void> {
    const existing = await this.getAccountByExternalKey(externalKey);
    if (!existing) {
      await this.createAccount(externalKey, name, email);
      return;
    }
    if (existing.name !== name || existing.email !== email) {
      try {
        await this.request("PUT", `/accounts/${existing.accountId}`, {
          accountId: existing.accountId,
          name,
          email,
          externalKey,
          currency: "USD"
        });
      } catch {
        // name/email correction is best-effort; billing still works
      }
    }
  }

  async voidInvoice(invoiceId: string): Promise<void> {
    const res = await this.request("PUT", `/invoices/${invoiceId}/voidInvoice`);
    if (res.status !== 204 && res.status !== 200) {
      throw new AppError(503, "billing_unavailable", "Billing is unreachable.");
    }
  }

  // Records a PURCHASE for the invoice's full balance. Returns success only
  // when Kill Bill confirms a SUCCESS transaction.
  async purchasePayment(externalKey: string, invoiceId: string, amountDollars: string, paymentExternalKey: string): Promise<{ ok: boolean }> {
    const account = await this.getAccountByExternalKey(externalKey);
    if (!account) {
      throw new AppError(503, "billing_unavailable", "Billing is unreachable.");
    }
    const res = await this.request(
      "POST",
      `/invoices/${invoiceId}/payments`,
      {
        accountId: account.accountId,
        targetInvoiceId: invoiceId,
        purchasedAmount: Number(amountDollars),
        currency: "USD",
        paymentExternalKey
      },
      "externalPayment=true"
    );
    if (res.status === 404) return { ok: false };
    if (res.status !== 201 && res.status !== 200 && res.status !== 204) {
      throw new AppError(503, "billing_unavailable", "Billing is unreachable.");
    }
    // Confirm the PURCHASE succeeded by reading the payment back.
    const lookup = await this.request("GET", `/payments`, undefined, `externalKey=${encodeURIComponent(paymentExternalKey)}`);
    if (lookup.status !== 200) {
      throw new AppError(503, "billing_unavailable", "Billing is unreachable.");
    }
    const payment = res.status === 204 ? (lookup.json as KillBillPayment) : ((res.json as KillBillPayment) ?? (lookup.json as KillBillPayment));
    const success = payment?.transactions?.some((t) => t.transactionType === "PURCHASE" && t.status === "SUCCESS");
    return { ok: success === true };
  }

  async getInvoice(invoiceId: string): Promise<KillBillInvoice | null> {
    const res = await this.request("GET", `/invoices/${invoiceId}`);
    if (res.status === 404) return null;
    if (res.status !== 200) {
      throw new AppError(503, "billing_unavailable", "Billing is unreachable.");
    }
    return res.json as KillBillInvoice;
  }

  async listInvoices(externalKey: string): Promise<KillBillInvoice[]> {
    const account = await this.getAccountByExternalKey(externalKey);
    if (!account) return [];
    const res = await this.request("GET", `/accounts/${account.accountId}/invoices`);
    if (res.status !== 200) {
      throw new AppError(503, "billing_unavailable", "Billing is unreachable.");
    }
    const list = res.json as KillBillInvoice[];
    // The invoice list's balances lag behind recent charges; read each
    // invoice for its current balance.
    const fresh: KillBillInvoice[] = [];
    for (const inv of list) {
      const current = await this.getInvoice(inv.invoiceId);
      fresh.push(current ?? inv);
    }
    return fresh;
  }

  // Owed for an account = its Kill Bill account balance (sum of invoice balances).
  async accountBalanceCents(externalKey: string): Promise<number> {
    const invoices = await this.listInvoices(externalKey);
    let total = 0;
    for (const inv of invoices) {
      total += Math.round(inv.balance * 100);
    }
    return total;
  }
}
