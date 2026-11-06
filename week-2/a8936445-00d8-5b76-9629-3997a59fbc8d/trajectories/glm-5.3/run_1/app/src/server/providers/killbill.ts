/**
 * Kill Bill client. One account per tenant business; charges, credits and payments are real records.
 * Endpoint shapes verified against the deployed build (see AGENTS.md).
 */

import { ProviderError } from "../http/errors.js";

export type KbcRecordKind = "charge" | "credit";

export class KillBillUnavailableError extends ProviderError {
  constructor(cause: Error | string) {
    super("billing", cause);
  }
}

export interface KbcCharge {
  kind: KbcRecordKind;
  description: string;
  amountCents: number;
}

const TIMEOUT_MS = 10_000;

export class KillBillClient {
  constructor(
    private readonly url: string,
    private readonly username: string,
    private readonly password: string,
    private readonly apiKey: string,
    private readonly apiSecret: string
  ) {}

  private async request(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string>
  ): Promise<{ status: number; text: string }> {
    const url = new URL(this.url + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      url.searchParams.set(k, v);
    }
    const headers: Record<string, string> = {
      "X-Killbill-ApiKey": this.apiKey,
      "X-Killbill-ApiSecret": this.apiSecret,
      "X-Killbill-CreatedBy": "stationkeeper"
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const res = await fetch(url, {
        method,
        headers: {
          ...headers,
          Authorization: "Basic " + Buffer.from(`${this.username}:${this.password}`).toString("base64")
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
      const text = await res.text();
      if (res.status >= 500) {
        throw new KillBillUnavailableError(`Kill Bill ${res.status} on ${method} ${path}`);
      }
      return { status: res.status, text };
    } catch (e) {
      if (e instanceof KillBillUnavailableError) throw e;
      throw new KillBillUnavailableError(
        `Kill Bill unreachable on ${method} ${path}: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** The tenant's Kill Bill account id, created on first need. */
  async ensureAccount(tenantId: string, businessName: string): Promise<string> {
    const found = await this.request("GET", "/1.0/kb/accounts", undefined, { externalKey: tenantId });
    if (found.status === 200) {
      const account = JSON.parse(found.text) as { accountId: string };
      return account.accountId;
    }
    if (found.status !== 404) {
      throw new KillBillUnavailableError(`Kill Bill account lookup failed: ${found.status}`);
    }
    const created = await this.request(
      "POST",
      "/1.0/kb/accounts",
      { name: businessName, externalKey: tenantId, currency: "USD" },
      { autoPayOff: "true" }
    );
    if (created.status !== 201) {
      // A concurrent creator may have won; look it up again.
      const again = await this.request("GET", "/1.0/kb/accounts", undefined, { externalKey: tenantId });
      if (again.status === 200) {
        return (JSON.parse(again.text) as { accountId: string }).accountId;
      }
      throw new KillBillUnavailableError(`Kill Bill account creation failed: ${created.status}`);
    }
    const located = await this.request("GET", "/1.0/kb/accounts", undefined, { externalKey: tenantId });
    if (located.status !== 200) {
      throw new KillBillUnavailableError("Kill Bill account not found after creation");
    }
    return (JSON.parse(located.text) as { accountId: string }).accountId;
  }

  /** The tenant's external payment method id, created on first need. */
  async ensurePaymentMethod(accountId: string, tenantId: string): Promise<string> {
    const list = await this.request("GET", `/1.0/kb/accounts/${accountId}/paymentMethods`);
    if (list.status !== 200) {
      throw new KillBillUnavailableError(`Kill Bill payment methods lookup failed: ${list.status}`);
    }
    const methods = JSON.parse(list.text) as Array<{ paymentMethodId: string; externalKey: string }>;
    const existing = methods.find((m) => m.externalKey === `pm-${tenantId}`);
    if (existing) return existing.paymentMethodId;
    const created = await this.request(
      "POST",
      `/1.0/kb/accounts/${accountId}/paymentMethods`,
      { externalKey: `pm-${tenantId}`, isDefault: true, pluginName: "__EXTERNAL_PAYMENT__" }
    );
    if (created.status !== 201 && created.status !== 200) {
      throw new KillBillUnavailableError(`Kill Bill payment method creation failed: ${created.status}`);
    }
    const again = await this.request("GET", `/1.0/kb/accounts/${accountId}/paymentMethods`);
    if (again.status !== 200) {
      throw new KillBillUnavailableError("Kill Bill payment methods not readable after creation");
    }
    const methods2 = JSON.parse(again.text) as Array<{ paymentMethodId: string; externalKey: string }>;
    const created2 = methods2.find((m) => m.externalKey === `pm-${tenantId}`);
    if (!created2) {
      throw new KillBillUnavailableError("Kill Bill payment method not found after creation");
    }
    return created2.paymentMethodId;
  }

  /** One external charge on the tenant's account. Amount in cents; stored in Kill Bill as dollars. */
  async createCharge(accountId: string, charge: KbcCharge): Promise<void> {
    const body = [
      {
        amount: centsAmount(charge.amountCents),
        currency: "USD",
        description: charge.description
      }
    ];
    const res = await this.request("POST", `/1.0/kb/invoices/charges/${accountId}`, body);
    if (res.status !== 200 && res.status !== 201) {
      throw new KillBillUnavailableError(`Kill Bill charge failed: ${res.status} ${res.text.slice(0, 200)}`);
    }
  }

  /** One credit on the tenant's account. */
  async createCredit(accountId: string, credit: KbcCharge): Promise<void> {
    const body = [
      {
        accountId,
        amount: centsAmount(credit.amountCents),
        currency: "USD",
        description: credit.description
      }
    ];
    const res = await this.request("POST", "/1.0/kb/credits", body);
    if (res.status !== 200 && res.status !== 201) {
      throw new KillBillUnavailableError(`Kill Bill credit failed: ${res.status} ${res.text.slice(0, 200)}`);
    }
  }

  /** One PURCHASE payment on the tenant's account. A transaction external key that already
   *  exists means the payment was already recorded, so the retry confirms it. */
  async createPurchasePayment(
    accountId: string,
    paymentMethodId: string,
    amountCents: number,
    transactionExternalKey: string
  ): Promise<void> {
    const body = {
      transactionType: "PURCHASE",
      amount: centsAmount(amountCents),
      currency: "USD",
      transactionExternalKey
    };
    const res = await this.request(
      "POST",
      `/1.0/kb/accounts/${accountId}/payments`,
      body,
      { paymentMethodId }
    );
    if (res.status !== 200 && res.status !== 201) {
      if (res.status === 400 && res.text.includes("already exists")) {
        return;
      }
      throw new KillBillUnavailableError(`Kill Bill payment failed: ${res.status} ${res.text.slice(0, 200)}`);
    }
  }
}

/** Exact cent amounts as decimal-dollar strings, the precision Kill Bill accepts. */
const centsAmount = (cents: number): string => (cents / 100).toFixed(2);
