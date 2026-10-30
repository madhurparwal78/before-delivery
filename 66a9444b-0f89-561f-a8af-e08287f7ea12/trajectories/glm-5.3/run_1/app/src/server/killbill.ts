import { createHmac, createHash } from "node:crypto";
import { request as httpRequest, type RequestOptions, type IncomingMessage } from "node:http";
import { URL } from "node:url";
import type { Config } from "./config.js";

export class PaymentUnavailable extends Error {}

interface KbPaymentTransaction {
  transactionId: string;
  transactionExternalKey: string;
  transactionType: string;
  amount: number | null;
  currency: string | null;
  status: string;
  effectiveDate: string;
}

interface KbPayment {
  paymentId: string;
  paymentExternalKey: string;
  transactions: KbPaymentTransaction[];
}

function centsToAmount(cents: number): number {
  return cents / 100;
}

export function amountToCents(amount: number | string): number {
  return Math.round(Number(amount) * 100);
}

export class KillBill {
  constructor(private cfg: Config) {}

  private async call(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string>,
    timeoutMs = 8000,
  ): Promise<{ status: number; json: unknown }> {
    const url = new URL(this.cfg.killbill.url + path);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(`${this.cfg.killbill.username}:${this.cfg.killbill.password}`).toString("base64")}`,
      "X-Killbill-Apikey": this.cfg.killbill.apiKey,
      "X-Killbill-Apisecret": this.cfg.killbill.apiSecret,
      "X-Killbill-CreatedBy": "kerf",
      "Content-Type": "application/json; charset=UTF-8",
      Accept: "application/json",
    };
    if (payload !== undefined) headers["Content-Length"] = String(Buffer.byteLength(payload));
    const options: RequestOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers,
    };
    return new Promise((resolve, reject) => {
      const req = httpRequest(options, (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json: unknown = null;
          try {
            json = text.length > 0 ? JSON.parse(text) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      });
      req.setTimeout(timeoutMs, () => {
        req.destroy(new PaymentUnavailable("killbill timeout"));
      });
      req.on("error", (e) => reject(e));
      if (payload !== undefined) req.write(payload);
      req.end();
    });
  }

  private async ok(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string>,
  ): Promise<{ status: number; json: unknown }> {
    try {
      return await this.call(method, path, body, query);
    } catch (e) {
      throw new PaymentUnavailable(e instanceof Error ? e.message : String(e));
    }
  }

  async health(): Promise<boolean> {
    try {
      const res = await this.call("GET", "/1.0/kb/tenants", undefined, { apiKey: this.cfg.killbill.apiKey }, 3000);
      return res.status === 200;
    } catch {
      return false;
    }
  }

  async ensureAccount(externalKey: string, name: string): Promise<string> {
    const existing = await this.ok("GET", "/1.0/kb/accounts", undefined, { externalKey });
    const existingBody = existing.json as { accountId?: string } | null;
    if (existing.status === 200 && existingBody?.accountId) return existingBody.accountId;
    const created = await this.ok("POST", "/1.0/kb/accounts", { externalKey, name, currency: "EUR" });
    if (created.status !== 201) {
      const again = await this.ok("GET", "/1.0/kb/accounts", undefined, { externalKey });
      const body = again.json as { accountId?: string } | null;
      if (again.status === 200 && body?.accountId) return body.accountId;
      throw new PaymentUnavailable(`account create failed: ${created.status}`);
    }
    const fetched = await this.ok("GET", "/1.0/kb/accounts", undefined, { externalKey });
    const fetchedBody = fetched.json as { accountId?: string; paymentMethodId?: string | null } | null;
    if (fetched.status !== 200 || !fetchedBody?.accountId) {
      throw new PaymentUnavailable("account lookup failed");
    }
    return fetchedBody.accountId;
  }

  async ensurePaymentMethod(accountId: string): Promise<void> {
    const acct = await this.ok("GET", `/1.0/kb/accounts/${accountId}`);
    const acctBody = acct.json as { paymentMethodId?: string | null } | null;
    if (acctBody?.paymentMethodId) return;
    const res = await this.ok("POST", `/1.0/kb/accounts/${accountId}/paymentMethods`, {
      pluginName: "__EXTERNAL_PAYMENT__",
      pluginInfo: { properties: [] },
    }, { isDefault: "true" });
    if (res.status !== 201) throw new PaymentUnavailable("payment method create failed");
  }

  // The emulator answers payment creation with an empty body, so the created
  // payment is read back from the account's payment list by transaction key.
  private async findTransaction(accountId: string, transactionKey: string): Promise<{ paymentId: string; transactionId: string }> {
    const payments = await this.listPayments(accountId);
    for (const p of payments) {
      const tx = p.transactions.find((t) => t.transactionExternalKey === transactionKey);
      if (tx) return { paymentId: p.paymentId, transactionId: tx.transactionId };
    }
    throw new PaymentUnavailable("payment not found after create");
  }

  // One payment per order with the order ref as its external key.
  async authorize(orderRef: string, accountId: string, cents: number): Promise<{ paymentId: string; transactionId: string }> {
    const res = await this.ok("POST", `/1.0/kb/accounts/${accountId}/payments`, {
      transactionType: "AUTHORIZE",
      amount: centsToAmount(cents),
      currency: "EUR",
      transactionExternalKey: `${orderRef}-auth`,
    }, { externalKey: orderRef });
    if (res.status !== 201) throw new PaymentUnavailable(`authorize failed: ${res.status}`);
    const payment = res.json as KbPayment | null;
    if (payment?.paymentId) {
      const tx = payment.transactions.find((t) => t.transactionExternalKey === `${orderRef}-auth`);
      return { paymentId: payment.paymentId, transactionId: tx?.transactionId ?? "" };
    }
    return this.findTransaction(accountId, `${orderRef}-auth`);
  }

  async completeTransaction(
    paymentId: string,
    type: "CAPTURE" | "VOID" | "REFUND" | "CHARGEBACK",
    transactionKey: string,
    cents: number,
  ): Promise<string> {
    const res = await this.ok("POST", `/1.0/kb/payments/${paymentId}`, {
      transactionType: type,
      amount: centsToAmount(cents),
      currency: "EUR",
      transactionExternalKey: transactionKey,
    });
    if (res.status !== 201) throw new PaymentUnavailable(`${type} failed: ${res.status}`);
    const payment = res.json as KbPayment | null;
    if (payment?.transactions) {
      const tx = payment.transactions.find((t) => t.transactionExternalKey === transactionKey);
      return tx?.transactionId ?? "";
    }
    const after = await this.getPayment(paymentId);
    const tx = after?.transactions.find((t) => t.transactionExternalKey === transactionKey);
    return tx?.transactionId ?? "";
  }

  async purchase(accountId: string, paymentKey: string, transactionKey: string, cents: number): Promise<{ paymentId: string; transactionId: string }> {
    const res = await this.ok("POST", `/1.0/kb/accounts/${accountId}/payments`, {
      transactionType: "PURCHASE",
      amount: centsToAmount(cents),
      currency: "EUR",
      transactionExternalKey: transactionKey,
    }, { externalKey: paymentKey });
    if (res.status !== 201) throw new PaymentUnavailable(`purchase failed: ${res.status}`);
    const payment = res.json as KbPayment | null;
    if (payment?.paymentId) {
      const tx = payment.transactions.find((t) => t.transactionExternalKey === transactionKey);
      return { paymentId: payment.paymentId, transactionId: tx?.transactionId ?? "" };
    }
    return this.findTransaction(accountId, transactionKey);
  }

  async listPayments(accountId: string): Promise<KbPayment[]> {
    const res = await this.ok("GET", `/1.0/kb/accounts/${accountId}/payments`);
    if (res.status !== 200) throw new PaymentUnavailable("payment list failed");
    return (res.json as KbPayment[]) ?? [];
  }

  async getPayment(paymentId: string): Promise<KbPayment | null> {
    const res = await this.ok("GET", `/1.0/kb/payments/${paymentId}`);
    if (res.status !== 200) return null;
    return res.json as KbPayment;
  }
}

export function hmacKey(secret: string, data: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}
