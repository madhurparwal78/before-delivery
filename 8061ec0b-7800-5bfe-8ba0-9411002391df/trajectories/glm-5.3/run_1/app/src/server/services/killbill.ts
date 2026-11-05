// Kill Bill REST client (DP-09, DP-11, DP-55, DP-67, DP-68).
// Every account and subscription is looked up by its external key before it
// is created; every charge and refund is looked up by its transaction key
// before it runs.
export class KillBillError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export class KillBillUnavailable extends Error {
  constructor() {
    super("Billing is unreachable.");
  }
}

export interface KbAccount {
  accountId: string;
  paymentMethodId: string | null;
}

export interface KbSubscription {
  subscriptionId: string;
  state: string;
}

const CATALOG_XML = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:noNamespaceSchemaLocation="CatalogSchema.xsd ">
  <effectiveDate>2024-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>BellrollCatalog</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies>
    <currency>USD</currency>
  </currencies>
  <units>
  </units>
  <products>
    <product name="Rental">
      <category>BASE</category>
    </product>
  </products>
  <rules>
    <changePolicy>
      <changePolicyCase>
        <policy>END_OF_TERM</policy>
      </changePolicyCase>
    </changePolicy>
    <changeAlignment>
      <changeAlignmentCase>
        <alignment>START_OF_SUBSCRIPTION</alignment>
      </changeAlignmentCase>
    </changeAlignment>
    <cancelPolicy>
      <cancelPolicyCase>
        <policy>IMMEDIATE</policy>
      </cancelPolicyCase>
    </cancelPolicy>
    <createAlignment>
      <createAlignmentCase>
        <alignment>START_OF_BUNDLE</alignment>
      </createAlignmentCase>
    </createAlignment>
    <billingAlignment>
      <billingAlignmentCase>
        <alignment>ACCOUNT</alignment>
      </billingAlignmentCase>
    </billingAlignment>
  </rules>
  <plans>
    <plan name="bellroll-rental-monthly">
      <product>Rental</product>
      <finalPhase type="EVERGREEN">
        <duration>
          <unit>UNLIMITED</unit>
        </duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice>
            <price>
              <currency>USD</currency>
              <value>0.00</value>
            </price>
          </recurringPrice>
        </recurring>
      </finalPhase>
    </plan>
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT">
      <plans>
        <plan>bellroll-rental-monthly</plan>
      </plans>
    </defaultPriceList>
  </priceLists>
</catalog>`;

export class KillBillClient {
  private readonly base: string;
  private readonly authHeader: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private catalogReady = false;

  constructor(
    base: string,
    username: string,
    password: string,
    apiKey: string,
    apiSecret: string
  ) {
    this.base = base.replace(/\/$/, "");
    this.authHeader = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  private async request(
    method: string,
    path: string,
    body?: string | object,
    contentType = "application/json"
  ): Promise<{ status: number; body: string; location?: string }> {
    let response: Response;
    const bodyStr = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    try {
      response = await fetch(this.base + path, {
        method,
        headers: {
          Authorization: this.authHeader,
          "X-Killbill-ApiKey": this.apiKey,
          "X-Killbill-ApiSecret": this.apiSecret,
          "X-Killbill-CreatedBy": "bellroll",
          ...(bodyStr !== undefined ? { "Content-Type": contentType } : {}),
        },
        body: bodyStr,
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new KillBillUnavailable();
    }
    const text = await response.text();
    return { status: response.status, body: text, location: response.headers.get("location") ?? undefined };
  }

  // Tenant: the verifier normally creates it; the app creates it once if
  // Kill Bill has no tenant for the given key.
  async ensureTenant(username: string, password: string): Promise<void> {
    const probe = await fetch(`${this.base}/1.0/kb/tenants?apiKey=${encodeURIComponent(this.apiKey)}`, {
      headers: {
        Authorization: "Basic " + Buffer.from(`${username}:${password}`).toString("base64"),
        "X-Killbill-ApiKey": this.apiKey,
        "X-Killbill-ApiSecret": this.apiSecret,
        "X-Killbill-CreatedBy": "bellroll",
      },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {
      throw new KillBillUnavailable();
    });
    if (probe.ok) return;
    if (probe.status === 404 || probe.status === 400) {
      const create = await this.request(
        "POST",
        "/1.0/kb/tenants",
        { apiKey: this.apiKey, apiSecret: this.apiSecret }
      );
      if (create.status !== 201 && create.status !== 409 && create.status !== 400) {
        throw new KillBillError(`Tenant creation failed: ${create.body}`, create.status);
      }
      return;
    }
    // Other statuses: assume the tenant exists and normal calls will work.
  }

  // Upload the catalog the tenant needs, when it is missing.
  async ensureCatalog(): Promise<void> {
    if (this.catalogReady) return;
    const catalog = await this.request("GET", "/1.0/kb/catalog/xml");
    if (catalog.status !== 200) throw new KillBillUnavailable();
    if (catalog.body.includes("<versions/>") || !catalog.body.includes("bellroll-rental-monthly")) {
      const uploaded = await this.request("POST", "/1.0/kb/catalog/xml", CATALOG_XML, "text/xml");
      if (uploaded.status !== 201 && uploaded.status !== 200 && uploaded.status !== 400) {
        throw new KillBillError(`Catalog upload failed: ${uploaded.body}`, uploaded.status);
      }
    }
    this.catalogReady = true;
  }

  async accountByExternalKey(externalKey: string): Promise<KbAccount | null> {
    const res = await this.request("GET", `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`);
    if (res.status === 404) return null;
    if (res.status !== 200) {
      if (res.body.includes("ACCOUNT_DOES_NOT_EXIST") || res.body.includes("does not exist")) return null;
      throw new KillBillUnavailable();
    }
    try {
      const parsed = JSON.parse(res.body) as { accountId: string; paymentMethodId: string | null };
      return { accountId: parsed.accountId, paymentMethodId: parsed.paymentMethodId ?? null };
    } catch {
      throw new KillBillUnavailable();
    }
  }

  async createAccount(externalKey: string, name: string, email: string): Promise<KbAccount> {
    const res = await this.request("POST", "/1.0/kb/accounts", {
      name,
      externalKey,
      currency: "USD",
      email,
      timeZone: "America/Chicago",
    });
    if (res.status !== 201) {
      if (res.status === 409 || (res.status === 400 && res.body.includes("exists"))) {
        const existing = await this.accountByExternalKey(externalKey);
        if (existing) return existing;
      }
      throw new KillBillError(`Account creation failed: ${res.body}`, res.status);
    }
    const accountId = res.location?.split("/").filter(Boolean).pop();
    if (!accountId) throw new KillBillUnavailable();
    return { accountId, paymentMethodId: null };
  }

  async ensureAccount(externalKey: string, name: string, email: string): Promise<KbAccount> {
    const existing = await this.accountByExternalKey(externalKey);
    if (existing) {
      if (!existing.paymentMethodId) {
        await this.ensureDefaultPaymentMethod(existing.accountId);
      }
      return existing;
    }
    const account = await this.createAccount(externalKey, name, email);
    await this.ensureDefaultPaymentMethod(account.accountId);
    return account;
  }

  private async ensureDefaultPaymentMethod(accountId: string): Promise<void> {
    const res = await this.request(
      "POST",
      `/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`,
      { pluginName: "__EXTERNAL_PAYMENT__", pluginInfo: {} }
    );
    if (res.status !== 201) {
      // An external payment method may already exist.
      const account = await this.request("GET", `/1.0/kb/accounts/${accountId}`);
      if (account.status === 200 && account.body.includes("paymentMethodId")) return;
      throw new KillBillError(`Payment method creation failed: ${res.body}`, res.status);
    }
  }

  async subscriptionByExternalKey(externalKey: string): Promise<KbSubscription | null> {
    const res = await this.request(
      "GET",
      `/1.0/kb/subscriptions?externalKey=${encodeURIComponent(externalKey)}`
    );
    if (res.status === 404) return null;
    if (res.status !== 200) {
      if (res.body.includes("does not exist")) return null;
      throw new KillBillUnavailable();
    }
    try {
      const parsed = JSON.parse(res.body) as { subscriptionId: string; state: string };
      return { subscriptionId: parsed.subscriptionId, state: parsed.state };
    } catch {
      throw new KillBillUnavailable();
    }
  }

  async createSubscription(accountId: string, externalKey: string): Promise<KbSubscription> {
    const res = await this.request("POST", "/1.0/kb/subscriptions", {
      accountId,
      planName: "bellroll-rental-monthly",
      bundleExternalKey: externalKey,
      externalKey: externalKey,
    });
    if (res.status !== 201) {
      const existing = await this.subscriptionByExternalKey(externalKey);
      if (existing) return existing;
      throw new KillBillError(`Subscription creation failed: ${res.body}`, res.status);
    }
    const subscriptionId = res.location?.split("/").filter(Boolean).pop();
    if (!subscriptionId) throw new KillBillUnavailable();
    return { subscriptionId, state: "ACTIVE" };
  }

  async ensureSubscription(accountId: string, externalKey: string): Promise<KbSubscription> {
    const existing = await this.subscriptionByExternalKey(externalKey);
    if (existing) return existing;
    return this.createSubscription(accountId, externalKey);
  }

  // Look up a transaction by its external key in the account's payments.
  // Returns the successful transaction's amount and payment id, or null.
  async findSuccessfulTransaction(
    accountId: string,
    transactionKey: string
  ): Promise<{ amountCents: number; paymentId: string } | null> {
    const res = await this.request(
      "GET",
      `/1.0/kb/accounts/${accountId}/payments?withAttempts=false&withPluginInfo=false`
    );
    if (res.status !== 200) throw new KillBillUnavailable();
    let payments: {
      paymentId: string;
      transactions: { transactionExternalKey: string; status: string; amount: number }[];
    }[];
    try {
      payments = JSON.parse(res.body);
    } catch {
      throw new KillBillUnavailable();
    }
    for (const payment of payments) {
      for (const txn of payment.transactions ?? []) {
        if (txn.transactionExternalKey === transactionKey && txn.status === "SUCCESS") {
          return { amountCents: Math.round(txn.amount * 100), paymentId: payment.paymentId };
        }
      }
    }
    return null;
  }

  // One PURCHASE on the contract's account for the given amount.
  async createPurchase(
    accountId: string,
    amountCents: number,
    transactionKey: string
  ): Promise<string> {
    const dollars = (amountCents / 100).toFixed(2);
    const res = await this.request(
      "POST",
      `/1.0/kb/accounts/${accountId}/payments?pluginName=__EXTERNAL_PAYMENT__`,
      {
        amount: dollars,
        currency: "USD",
        transactionType: "PURCHASE",
        transactionExternalKey: transactionKey,
        paymentExternalKey: transactionKey,
      }
    );
    if (res.status !== 201) {
      throw new KillBillError(`Purchase failed: ${res.body}`, res.status);
    }
    const paymentId = res.location?.split("/").filter(Boolean).pop();
    if (!paymentId) throw new KillBillUnavailable();
    return paymentId;
  }

  // One REFUND on the original payment for its full amount.
  async createRefund(
    paymentId: string,
    amountCents: number,
    transactionKey: string
  ): Promise<string> {
    const dollars = (amountCents / 100).toFixed(2);
    const res = await this.request(
      "POST",
      `/1.0/kb/payments/${paymentId}/refunds?pluginName=__EXTERNAL_PAYMENT__`,
      {
        amount: dollars,
        currency: "USD",
        transactionExternalKey: transactionKey,
        paymentExternalKey: transactionKey,
      }
    );
    if (res.status !== 201) {
      throw new KillBillError(`Refund failed: ${res.body}`, res.status);
    }
    const location = res.location ?? "";
    const match = location.match(/payments\/([0-9a-f-]+)\//);
    return match ? match[1] : paymentId;
  }

  // Cancel with IMMEDIATE policies and read the subscription back as
  // CANCELLED before the caller commits anything (DP-67). A subscription
  // found already CANCELLED (left by an interrupted earlier attempt) is done.
  async cancelSubscriptionConfirmed(subscriptionId: string): Promise<void> {
    const before = await this.request("GET", `/1.0/kb/subscriptions/${subscriptionId}`);
    if (before.status === 200) {
      const state = (JSON.parse(before.body) as { state: string }).state;
      if (state === "CANCELLED") return;
    }
    const res = await this.request(
      "DELETE",
      `/1.0/kb/subscriptions/${subscriptionId}?entitlementPolicy=IMMEDIATE&billingPolicy=IMMEDIATE&useRequestedDateForBilling=true`
    );
    if (res.status !== 204 && res.status !== 200) {
      // A concurrent or interrupted attempt may have cancelled it already.
      if (!res.body.includes("is in state CANCELLED") && res.status !== 404) {
        throw new KillBillError(`Cancellation failed: ${res.body}`, res.status);
      }
    }
    const read = await this.request("GET", `/1.0/kb/subscriptions/${subscriptionId}`);
    if (read.status !== 200) throw new KillBillUnavailable();
    let state = "";
    try {
      state = (JSON.parse(read.body) as { state: string }).state;
    } catch {
      throw new KillBillUnavailable();
    }
    if (state !== "CANCELLED") throw new KillBillError("Subscription not cancelled", 500);
  }

  async subscriptionState(subscriptionId: string): Promise<string> {
    const res = await this.request("GET", `/1.0/kb/subscriptions/${subscriptionId}`);
    if (res.status !== 200) throw new KillBillUnavailable();
    return (JSON.parse(res.body) as { state: string }).state;
  }
}
