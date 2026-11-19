import type { Config } from "./config.js";

// Kill Bill records the holds, captures and releases. The test-card network
// is simulated by the app because the payment plugin in this environment
// confirms every request: a declined card never reaches Kill Bill, and a
// capture-failing card never records a capture.

export interface KbTransaction {
  transactionType: string;
  status: string;
}

export interface KbPayment {
  paymentId: string;
  transactions: KbTransaction[];
}

export type KbResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "unavailable" | "declined" | "invalid" };

export class KillBillClient {
  private readonly config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: T | null; location: string | null }> {
    const url = `${this.config.killbillUrl}/1.0/kb${path}`;
    const headers: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(
        `${this.config.killbillUsername}:${this.config.killbillPassword}`,
      ).toString("base64")}`,
      "X-Killbill-ApiKey": this.config.killbillApiKey,
      "X-Killbill-ApiSecret": this.config.killbillApiSecret,
      "X-Killbill-CreatedBy": "dotgain",
    };
    let payload: string | undefined;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    let response: Response;
    try {
      response = await fetch(url, { method, headers, body: payload });
    } catch {
      return { status: 0, body: null, location: null };
    }
    if (response.status === 204) {
      return { status: 204, body: null, location: response.headers.get("location") };
    }
    let parsed: T | null = null;
    try {
      parsed = (await response.json()) as T;
    } catch {
      parsed = null;
    }
    return { status: response.status, body: parsed, location: response.headers.get("location") };
  }

  private unavailable<T>(): KbResult<T> {
    return { ok: false, reason: "unavailable" };
  }

  async ping(): Promise<boolean> {
    const probe = await this.request<unknown>("GET", "/nodesInfo");
    return probe.status === 200;
  }

  async ensureAccount(person: { id: string; name: string; email: string }): Promise<KbResult<void>> {
    const found = await this.request<{ accountId: string }>(
      "GET",
      `/accounts?externalKey=${encodeURIComponent(person.id)}`,
    );
    if (found.status === 0) return this.unavailable();
    if (found.status === 200 && found.body !== null) {
      return { ok: true, value: undefined };
    }
    const created = await this.request<null>("POST", "/accounts", {
      externalKey: person.id,
      name: person.name,
      email: person.email,
      currency: "GBP",
    });
    if (created.status === 0) return this.unavailable();
    if (created.status === 201) return { ok: true, value: undefined };
    // A concurrent request may have created the account first; confirm by
    // reading it back before deciding.
    const after = await this.request<{ accountId: string }>(
      "GET",
      `/accounts?externalKey=${encodeURIComponent(person.id)}`,
    );
    if (after.status === 200 && after.body !== null) {
      return { ok: true, value: undefined };
    }
    return { ok: false, reason: "invalid" };
  }

  /** Resolves the Kill Bill account UUID for a person's external key. */
  async accountId(personId: string): Promise<KbResult<string>> {
    const found = await this.request<{ accountId: string }>(
      "GET",
      `/accounts?externalKey=${encodeURIComponent(personId)}`,
    );
    if (found.status === 0) return this.unavailable();
    if (found.status === 200 && found.body !== null) {
      return { ok: true, value: found.body.accountId };
    }
    return { ok: false, reason: "invalid" };
  }

  async ensurePaymentMethod(personId: string): Promise<KbResult<string>> {
    const accountId = await this.accountId(personId);
    if (!accountId.ok) return accountId;
    const list = await this.request<{ paymentMethodId: string }[]>(
      "GET",
      `/accounts/${accountId.value}/paymentMethods`,
    );
    if (list.status === 0) return this.unavailable();
    if (list.status === 200 && list.body !== null && list.body.length > 0) {
      return { ok: true, value: list.body[0].paymentMethodId };
    }
    const created = await this.request<null>(
      "POST",
      `/accounts/${accountId.value}/paymentMethods?isDefault=true`,
      { pluginName: "__EXTERNAL_PAYMENT__", pluginInfo: { properties: [] } },
    );
    if (created.status === 0) return this.unavailable();
    if (created.status !== 201) {
      // A concurrent request may have added the method first; read it back.
      const recheck = await this.request<{ paymentMethodId: string }[]>(
        "GET",
        `/accounts/${accountId.value}/paymentMethods`,
      );
      if (
        recheck.status !== 200 ||
        recheck.body === null ||
        recheck.body.length === 0
      ) {
        return { ok: false, reason: "invalid" };
      }
      return { ok: true, value: recheck.body[0].paymentMethodId };
    }
    const after = await this.request<{ paymentMethodId: string }[]>(
      "GET",
      `/accounts/${accountId.value}/paymentMethods`,
    );
    if (after.status !== 200 || after.body === null || after.body.length === 0) {
      return this.unavailable();
    }
    return { ok: true, value: after.body[0].paymentMethodId };
  }

  /**
   * Places an AUTHORIZE for the full pledge amount. Returns the payment id on
   * confirmation of a successful AUTHORIZE. A decline is decided before any
   * Kill Bill call, so a declined attempt leaves no successful AUTHORIZE.
   */
  async authorize(
    personId: string,
    paymentExternalKey: string,
    transactionExternalKey: string,
    amountPence: number,
    decline: boolean,
  ): Promise<KbResult<{ paymentId: string; paymentMethodId: string }>> {
    if (decline) return { ok: false, reason: "declined" };

    const account = await this.accountId(personId);
    if (!account.ok) return account;
    const method = await this.ensurePaymentMethod(personId);
    if (!method.ok) return method;
    const methodId = method.value;

    const created = await this.request<KbPayment>(
      "POST",
      `/accounts/${encodeURIComponent(account.value)}/payments?paymentMethodId=${encodeURIComponent(methodId)}`,
      {
        transactionType: "AUTHORIZE",
        amount: pounds(amountPence),
        currency: "GBP",
        paymentExternalKey,
        transactionExternalKey,
      },
    );
    if (created.status === 0) return this.unavailable();
    if (created.status !== 201) return { ok: false, reason: "invalid" };

    // Kill Bill answers 201 with an empty body and the payment in Location.
    const paymentId = this.paymentIdFromLocation(created.location);
    if (paymentId !== null) {
      const confirmed = await this.getPayment(paymentId);
      if (!confirmed.ok) return this.unavailable();
      const payment = confirmed.value;
      if (
        payment !== null &&
        payment.transactions.some(
          (t) => t.transactionType === "AUTHORIZE" && t.status === "SUCCESS",
        )
      ) {
        return { ok: true, value: { paymentId, paymentMethodId: methodId } };
      }
    }
    return { ok: false, reason: "invalid" };
  }

  /** Kill Bill returns the payment id in the Location header of a 201. */
  private paymentIdFromLocation(location: string | null): string | null {
    if (location === null) return null;
    const match = /\/payments\/([0-9a-f-]+)\/?$/i.exec(location);
    return match === null ? null : match[1];
  }

  /** Confirms the transaction ledger for a payment, as the source of truth. */
  async getPayment(paymentId: string): Promise<KbResult<KbPayment | null>> {
    const got = await this.request<KbPayment>("GET", `/payments/${paymentId}`);
    if (got.status === 0) return this.unavailable();
    return { ok: true, value: got.body };
  }

  /**
   * Captures the full amount of an authorised payment. The capture-failing test
   * card never issues a real capture: the plugin cannot fail, so the app
   * decides the capture result from the card behaviour instead.
   */
  async capture(
    paymentId: string,
    transactionExternalKey: string,
    amountPence: number,
    willFail: boolean,
  ): Promise<KbResult<boolean>> {
    if (willFail) return { ok: true, value: false };
    const captured = await this.request<KbPayment>("POST", `/payments/${paymentId}`, {
      transactionType: "CAPTURE",
      amount: pounds(amountPence),
      currency: "GBP",
      transactionExternalKey,
    });
    if (captured.status === 0) return this.unavailable();
    if (captured.status !== 201) return { ok: true, value: false };
    // The 201 body is empty; confirm the capture in the transaction ledger.
    const confirmed = await this.getPayment(paymentId);
    if (!confirmed.ok) return this.unavailable();
    const capturedConfirmed =
      confirmed.value?.transactions.some(
        (t) => t.transactionType === "CAPTURE" && t.status === "SUCCESS",
      ) ?? false;
    return { ok: true, value: capturedConfirmed };
  }

  /** Voids a payment's authorisation; the void is confirmed before use. */
  async void(paymentId: string, transactionExternalKey: string): Promise<KbResult<boolean>> {
    const voided = await this.request<unknown>("DELETE", `/payments/${paymentId}`, {
      transactionExternalKey,
      currency: "GBP",
    });
    if (voided.status === 0) return this.unavailable();
    if (voided.status !== 200 && voided.status !== 201 && voided.status !== 204) {
      return { ok: false, reason: "invalid" };
    }
    const payment = await this.getPayment(paymentId);
    if (!payment.ok) return this.unavailable();
    const confirmed =
      payment.value?.transactions.some(
        (t) => t.transactionType === "VOID" && t.status === "SUCCESS",
      ) ?? false;
    return { ok: true, value: confirmed };
  }
}

function pounds(pence: number): string {
  const whole = Math.floor(pence / 100);
  const rest = pence % 100;
  return `${whole}.${rest.toString().padStart(2, "0")}`;
}
