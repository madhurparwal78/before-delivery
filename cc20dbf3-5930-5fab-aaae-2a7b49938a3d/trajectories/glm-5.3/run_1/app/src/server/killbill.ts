import { Config } from "./config";

export interface KillBillAccount {
  accountId: string;
}

interface RequestResult {
  status: number;
  body: string;
}

export class BillingUnavailable extends Error {
  constructor() {
    super("Billing is unavailable");
  }
}

function authHeaders(config: Config): Record<string, string> {
  const credentials = Buffer.from(`${config.killbillUsername}:${config.killbillPassword}`).toString("base64");
  return {
    "Authorization": `Basic ${credentials}`,
    "X-Killbill-ApiKey": config.killbillApiKey,
    "X-Killbill-ApiSecret": config.killbillApiSecret,
    "X-Killbill-CreatedBy": "shedline",
  };
}

async function call(
  config: Config,
  method: string,
  path: string,
  body: string | null,
  contentType: string,
): Promise<RequestResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${config.killbillUrl}${path}`, {
      method,
      headers: { ...authHeaders(config), ...(body === null ? {} : { "Content-Type": contentType }) },
      body,
      signal: controller.signal,
    });
    const text = await response.text();
    return { status: response.status, body: text };
  } catch {
    throw new BillingUnavailable();
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(body: string): Record<string, unknown> {
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function isDuplicateTransaction(body: string): boolean {
  const parsed = parseJson(body);
  return parsed.message === "string" && /already exists/i.test(parsed.message as string);
}

async function probeCall(config: Config): Promise<boolean> {
  try {
    // Any answer at all proves billing is up; only reachability and 5xx count as down.
    const result = await call(config, "GET", "/1.0/kb/accounts?externalKey=shedline-probe", null, "application/json");
    return result.status >= 200 && result.status < 500;
  } catch {
    return false;
  }
}

export class KillBillClient {
  private readonly config: Config;
  private probeResult: boolean = true;
  private probeAt = 0;
  private readonly inFlightProbes = new Set<Promise<void>>();

  constructor(config: Config) {
    this.config = config;
  }

  /** Billing failures are never cached for more than 10 seconds. */
  async probe(): Promise<boolean> {
    const age = Date.now() - this.probeAt;
    if (age < 5000 && this.probeAt > 0) return this.probeResult;
    const existing = [...this.inFlightProbes][0];
    if (existing !== undefined) {
      await existing;
      return this.probeResult;
    }
    const task = (async () => {
      this.probeResult = await probeCall(this.config);
      this.probeAt = Date.now();
    })();
    this.inFlightProbes.add(task);
    try {
      await task;
    } finally {
      this.inFlightProbes.delete(task);
    }
    return this.probeResult;
  }

  private async mustBeUp(): Promise<void> {
    if (!(await this.probe())) throw new BillingUnavailable();
  }

  async findAccount(memberId: string): Promise<KillBillAccount | null> {
    await this.mustBeUp();
    const result = await call(this.config, "GET", `/1.0/kb/accounts?externalKey=shedline-${encodeURIComponent(memberId)}`, null, "application/json");
    if (result.status === 404) return null;
    if (result.status >= 500) throw new BillingUnavailable();
    if (result.status !== 200) throw new BillingUnavailable();
    const parsed = parseJson(result.body);
    const accountId = parsed.accountId;
    if (typeof accountId !== "string") return null;
    return { accountId };
  }

  async createAccount(memberId: string, name: string, email: string): Promise<KillBillAccount> {
    await this.mustBeUp();
    const body = JSON.stringify({ externalKey: `shedline-${memberId}`, name, email, currency: "USD" });
    const result = await call(this.config, "POST", "/1.0/kb/accounts", body, "application/json");
    if (result.status === 201) {
      const created = await this.findAccount(memberId);
      if (created !== null) return created;
    }
    if (isDuplicateTransaction(result.body)) {
      const existing = await this.findAccount(memberId);
      if (existing !== null) return existing;
    }
    throw new BillingUnavailable();
  }

  async ensureExternalPaymentMethod(accountId: string): Promise<void> {
    await this.mustBeUp();
    const list = await call(this.config, "GET", `/1.0/kb/accounts/${accountId}/paymentMethods`, null, "application/json");
    if (list.status >= 500) throw new BillingUnavailable();
    if (list.status === 200) {
      try {
        const methods = JSON.parse(list.body) as { pluginName?: string }[];
        if (methods.some((m) => m.pluginName === "__EXTERNAL_PAYMENT__")) return;
      } catch {
        throw new BillingUnavailable();
      }
    }
    const body = JSON.stringify({ pluginName: "__EXTERNAL_PAYMENT__", isDefault: true });
    const result = await call(
      this.config,
      "POST",
      `/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true&pluginName=__EXTERNAL_PAYMENT__`,
      body,
      "application/json",
    );
    if (result.status === 201) return;
    throw new BillingUnavailable();
  }

  /** Records one PURCHASE transaction; an existing transaction with the same key is reused. */
  async recordPurchase(
    accountId: string,
    paymentExternalKey: string,
    transactionExternalKey: string,
    cents: number,
  ): Promise<void> {
    await this.mustBeUp();
    const body =
      `{"transactionType":"PURCHASE","amount":${centsToBillingAmount(cents)},"currency":"USD",` +
      `"paymentExternalKey":${JSON.stringify(paymentExternalKey)},"transactionExternalKey":${JSON.stringify(transactionExternalKey)}}`;
    const result = await call(
      this.config,
      "POST",
      `/1.0/kb/accounts/${accountId}/payments?pluginName=__EXTERNAL_PAYMENT__`,
      body,
      "application/json",
    );
    if (result.status === 201) return;
    if (isDuplicateTransaction(result.body)) return;
    throw new BillingUnavailable();
  }

  /** Records one REFUND transaction on the deposit payment; an existing one is reused. */
  async recordRefund(
    accountId: string,
    paymentExternalKey: string,
    transactionExternalKey: string,
    cents: number,
  ): Promise<void> {
    await this.mustBeUp();
    const payments = await call(this.config, "GET", `/1.0/kb/accounts/${accountId}/payments`, null, "application/json");
    if (payments.status >= 500 || payments.status !== 200) throw new BillingUnavailable();
    let paymentId: string | null = null;
    let alreadyRefunded = false;
    try {
      const list = JSON.parse(payments.body) as {
        paymentExternalKey: string;
        paymentId: string;
        transactions: { transactionExternalKey: string }[];
      }[];
      for (const payment of list) {
        if (payment.paymentExternalKey !== paymentExternalKey) continue;
        paymentId = payment.paymentId;
        alreadyRefunded = (payment.transactions ?? []).some((t) => t.transactionExternalKey === transactionExternalKey);
      }
    } catch {
      throw new BillingUnavailable();
    }
    if (paymentId === null) throw new BillingUnavailable();
    if (alreadyRefunded) return;
    const body =
      `{"amount":${centsToBillingAmount(cents)},"currency":"USD",` +
      `"transactionExternalKey":${JSON.stringify(transactionExternalKey)}}`;
    const result = await call(
      this.config,
      "POST",
      `/1.0/kb/payments/${paymentId}/refunds?pluginName=__EXTERNAL_PAYMENT__`,
      body,
      "application/json",
    );
    if (result.status === 201) return;
    if (isDuplicateTransaction(result.body)) return;
    throw new BillingUnavailable();
  }

  async ensureAccountReady(memberId: string, name: string, email: string): Promise<KillBillAccount> {
    const existing = await this.findAccount(memberId);
    const account = existing ?? (await this.createAccount(memberId, name, email));
    await this.ensureExternalPaymentMethod(account.accountId);
    return account;
  }
}

/** Exact fixed-point decimal text for a billing amount; no floating point is involved. */
function centsToBillingAmount(cents: number): string {
  const negative = cents < 0;
  const magnitude = Math.abs(cents);
  return `${negative ? "-" : ""}${Math.floor(magnitude / 100)}.${String(magnitude % 100).padStart(2, "0")}`;
}
