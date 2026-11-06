import type { Env } from "./env";

export interface KbInvoice {
  invoiceId: string;
  invoiceNumber: string | number;
  invoiceDate: string;
  targetDate: string;
  amount: number;
  balance: number;
  currency: string;
  status: string;
  items: { planName: string | null; amount: number; itemType: string; description: string | null; prettyPlanName: string | null }[] | null;
}

export interface KbPayment {
  paymentId: string;
  paymentNumber: string | number;
  paymentExternalKey: string;
  purchasedAmount: number;
  refundedAmount: number;
  currency: string;
  targetInvoiceId: string | null;
  transactions: { transactionId: string; transactionExternalKey: string; transactionType: string; amount: number; status: string; effectiveDate: string }[];
}

export interface KbSubscription {
  subscriptionId: string;
  bundleId: string;
  externalKey: string;
  planName: string;
  state: string;
  chargedThroughDate: string | null;
}

export class KillBill {
  private base: string;

  constructor(private env: Env) {
    this.base = env.killbill.url;
  }

  private async call<T>(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<{ status: number; data: T | null }> {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Killbill-ApiKey": this.env.killbill.apiKey,
        "X-Killbill-ApiSecret": this.env.killbill.apiSecret,
        "X-Killbill-CreatedBy": "orrery-studio",
        Authorization: "Basic " + Buffer.from(`${this.env.killbill.username}:${this.env.killbill.password}`).toString("base64"),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`KillBill ${method} ${path} failed: ${res.status} ${text.slice(0, 300)}`);
    }
    return { status: res.status, data: text ? (JSON.parse(text) as T) : null };
  }

  async ping(): Promise<boolean> {
    try {
      // Any HTTP answer, even an error status, proves the gateway is reachable.
      const url = new URL(this.base + "/1.0/kb/accounts");
      url.searchParams.set("externalKey", "orrery-ping-nonexistent");
      const res = await fetch(url, {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      void res;
      return true;
    } catch {
      return false;
    }
  }

  private authHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Killbill-ApiKey": this.env.killbill.apiKey,
      "X-Killbill-ApiSecret": this.env.killbill.apiSecret,
      "X-Killbill-CreatedBy": "orrery-studio",
      Authorization: "Basic " + Buffer.from(`${this.env.killbill.username}:${this.env.killbill.password}`).toString("base64"),
    };
  }

  async uploadCatalog(): Promise<void> {
    const plans = [
      { planId: "team-monthly", productName: "Team", productCategory: "BASE", amount: 96, billingPeriod: "MONTHLY" },
      { planId: "team-annual", productName: "Team", productCategory: "BASE", amount: 960, billingPeriod: "ANNUAL" },
      { planId: "business-monthly", productName: "Business", productCategory: "BASE", amount: 380, billingPeriod: "MONTHLY" },
      { planId: "business-annual", productName: "Business", productCategory: "BASE", amount: 3800, billingPeriod: "ANNUAL" },
      { planId: "seat-team-monthly", productName: "Seat", productCategory: "ADD_ON", amount: 12, billingPeriod: "MONTHLY" },
      { planId: "seat-team-annual", productName: "Seat", productCategory: "ADD_ON", amount: 120, billingPeriod: "ANNUAL" },
      { planId: "seat-business-monthly", productName: "Seat", productCategory: "ADD_ON", amount: 16, billingPeriod: "MONTHLY" },
      { planId: "seat-business-annual", productName: "Seat", productCategory: "ADD_ON", amount: 160, billingPeriod: "ANNUAL" },
    ];
    for (const plan of plans) {
      const body = {
        planId: plan.planId,
        productName: plan.productName,
        productCategory: plan.productCategory,
        currency: "USD",
        amount: plan.amount,
        billingPeriod: plan.billingPeriod,
        trialLength: 0,
        trialTimeUnit: "UNLIMITED",
        ...(plan.productCategory === "ADD_ON" ? { availableBaseProducts: ["Team", "Business"] } : {}),
      };
      try {
        await this.call("POST", "/1.0/kb/catalog/simplePlan", body);
      } catch (e) {
        // Re-uploading an identical plan is a no-op; anything else is a real failure.
        const message = e instanceof Error ? e.message : "";
        if (!/failed: 400/.test(message)) throw e;
      }
    }
  }

  async getAccount(workspaceId: string): Promise<string | null> {
    try {
      const res = await this.call<{ accountId: string }>("GET", "/1.0/kb/accounts", undefined, { externalKey: workspaceId });
      return res.data?.accountId ?? null;
    } catch {
      return null;
    }
  }

  async createAccount(workspaceId: string, workspaceName: string): Promise<string> {
    const existing = await this.getAccount(workspaceId);
    if (existing) return existing;
    await this.call("POST", "/1.0/kb/accounts", { name: workspaceName, externalKey: workspaceId, currency: "USD" });
    const accountId = await this.waitForAccount(workspaceId);
    // AUTO_PAY_OFF control tag: only the app records payments.
    await this.call("POST", `/1.0/kb/accounts/${accountId}/tags`, ["00000000-0000-0000-0000-000000000001"]);
    await this.call("POST", `/1.0/kb/accounts/${accountId}/paymentMethods`, { pluginName: "__EXTERNAL_PAYMENT__", externalKey: `${workspaceId}-external` });
    return accountId;
  }

  private async waitForAccount(workspaceId: string): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const id = await this.getAccount(workspaceId);
      if (id) return id;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error("KillBill account did not appear");
  }

  async getSubscription(externalKey: string): Promise<KbSubscription | null> {
    try {
      const res = await this.call<KbSubscription>("GET", "/1.0/kb/subscriptions", undefined, { externalKey });
      return res.data;
    } catch {
      return null;
    }
  }

  async createSubscription(accountId: string, planName: string, externalKey: string, bundleId?: string): Promise<KbSubscription> {
    await this.call("POST", "/1.0/kb/subscriptions", {
      accountId,
      planName,
      externalKey,
      ...(bundleId ? { bundleId } : {}),
    });
    for (let i = 0; i < 20; i++) {
      const sub = await this.getSubscription(externalKey);
      if (sub) return sub;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`KillBill subscription ${externalKey} did not appear`);
  }

  async changePlan(subscriptionId: string, planName: string, productName: string, billingPeriod: string, policy: "IMMEDIATE" | "END_OF_TERM"): Promise<void> {
    await this.call("PUT", `/1.0/kb/subscriptions/${subscriptionId}`, { planName, productName, billingPeriod, priceList: "DEFAULT" }, { billingPolicy: policy });
  }

  async cancelSubscription(subscriptionId: string, policy: "IMMEDIATE" | "END_OF_TERM"): Promise<void> {
    await this.call("DELETE", `/1.0/kb/subscriptions/${subscriptionId}`, undefined, { billingPolicy: policy, entitlementPolicy: policy, callCompletion: "false" });
  }

  async listInvoices(accountId: string): Promise<KbInvoice[]> {
    const res = await this.call<KbInvoice[] | { invoices?: KbInvoice[] }>("GET", `/1.0/kb/accounts/${accountId}/invoices`);
    const data = res.data;
    if (Array.isArray(data)) return data;
    return data?.invoices ?? [];
  }

  async getInvoice(invoiceId: string): Promise<KbInvoice> {
    const res = await this.call<KbInvoice>("GET", `/1.0/kb/invoices/${invoiceId}`);
    return res.data!;
  }

  async dryRunChange(accountId: string, subscriptionId: string, bundleId: string, planName: string, policy: "IMMEDIATE" | "END_OF_TERM"): Promise<KbInvoice | null> {
    const res = await this.call<KbInvoice | null>(
      "POST",
      "/1.0/kb/invoices/dryRun",
      { dryRunType: "SUBSCRIPTION_ACTION", dryRunAction: "CHANGE", subscriptionId, bundleId, planName, billingPolicy: policy },
      { accountId },
    );
    return res.data;
  }

  async payInvoice(accountId: string, invoiceId: string, amountDollars: number, externalKey: string): Promise<void> {
    await this.call("POST", `/1.0/kb/invoices/${invoiceId}/payments`, {
      accountId,
      targetInvoiceId: invoiceId,
      purchasedAmount: amountDollars,
      currency: "USD",
      paymentExternalKey: `${externalKey}-payment`,
      transactions: [
        {
          transactionExternalKey: externalKey,
          transactionType: "PURCHASE",
          amount: amountDollars,
          currency: "USD",
          status: "SUCCESS",
          processedAmount: amountDollars,
          processedCurrency: "USD",
          effectiveDate: new Date().toISOString(),
        },
      ],
    }, { externalPayment: "true" });
  }

  async listInvoicePayments(accountId: string): Promise<KbPayment[]> {
    const res = await this.call<KbPayment[]>("GET", `/1.0/kb/accounts/${accountId}/invoicePayments`);
    return res.data ?? [];
  }

  async findPaymentByExternalKey(accountId: string, paymentExternalKey: string): Promise<KbPayment | null> {
    const payments = await this.listInvoicePayments(accountId);
    return payments.find((p) => p.paymentExternalKey === paymentExternalKey) ?? null;
  }

  async refundPayment(paymentId: string, amountDollars: number, externalKey: string): Promise<void> {
    await this.call("POST", `/1.0/kb/invoicePayments/${paymentId}/refunds`, {
      amount: amountDollars,
      currency: "USD",
      transactionExternalKey: externalKey,
    });
  }

  async chargebackPayment(paymentId: string, amountDollars: number): Promise<void> {
    await this.call("POST", `/1.0/kb/invoicePayments/${paymentId}/chargebacks`, {
      amount: amountDollars,
      currency: "USD",
    });
  }
}
