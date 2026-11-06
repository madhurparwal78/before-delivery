// Kill Bill client: the only place the app talks to Kill Bill's REST API.
// Every request carries the tenant credentials and a created-by actor.
// Money crosses the wire as decimal dollars, converted from integer cents here.
import type { Env } from "../core/env.js";

export class KillBillError extends Error {
  constructor(
    public status: number,
    public body: string,
    public timeout: boolean
  ) {
    super(`Kill Bill ${status}`);
  }
}

interface RequestOptions {
  method: string;
  path: string;
  body?: unknown;
  query?: Record<string, string>;
  createdBy: string;
  timeoutMs?: number;
}

interface RawResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
}

export function centsToKb(cents: number): number {
  return Math.round(cents) / 100;
}

/** Id of the AUTO_INVOICING_DRAFT control tag, which keeps generated invoices in DRAFT. */
export const AUTO_INVOICING_DRAFT_TAG_ID = "00000000-0000-0000-0000-000000000008";

export class KillBillClient {
  constructor(private env: Env) {}

  private async rawRequest(opts: RequestOptions): Promise<RawResponse> {
    const url = new URL(this.env.killbillUrl + opts.path);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5_000);
    try {
      const auth = Buffer.from(`${this.env.killbillUsername}:${this.env.killbillPassword}`).toString("base64");
      const headers: Record<string, string> = {
        Authorization: `Basic ${auth}`,
        "X-Killbill-ApiKey": this.env.killbillApiKey,
        "X-Killbill-ApiSecret": this.env.killbillApiSecret,
        "X-Killbill-CreatedBy": opts.createdBy,
        Accept: "application/json"
      };
      if (opts.body !== undefined) headers["Content-Type"] = "application/json";
      const res = await fetch(url, {
        method: opts.method,
        headers,
        body: opts.body === undefined ? undefined :
          typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body),
        signal: controller.signal
      });
      const text = await res.text();
      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => (responseHeaders[k.toLowerCase()] = v));
      return { status: res.status, body: text, headers: responseHeaders };
    } catch (err) {
      const timeout = err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
      throw new KillBillError(0, "", timeout);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Request that must succeed with 2xx; returns parsed JSON when the body carries one. */
  async request<T>(opts: RequestOptions): Promise<T> {
    const res = await this.rawRequest(opts);
    if (res.status >= 200 && res.status < 300) {
      if (res.body === "") return {} as T;
      return JSON.parse(res.body) as T;
    }
    throw new KillBillError(res.status, res.body, false);
  }

  /** Availability check: succeeds when Kill Bill answers at all. */
  async ping(): Promise<boolean> {
    try {
      const res = await this.rawRequest({
        method: "GET",
        path: "/1.0/kb/security/subject",
        createdBy: "loafline"
      });
      return res.status < 500;
    } catch {
      return false;
    }
  }

  // ---- catalog ----

  async basePlans(): Promise<KbBasePlan[]> {
    return this.request<KbBasePlan[]>({
      method: "GET",
      path: "/1.0/kb/catalog/availableBasePlans",
      createdBy: "loafline"
    });
  }

  async createSimplePlan(input: KbSimplePlanInput): Promise<void> {
    await this.request({
      method: "POST",
      path: "/1.0/kb/catalog/simplePlan",
      body: input,
      createdBy: "loafline"
    });
  }

  // ---- accounts ----

  async getAccountByKey(externalKey: string): Promise<KbAccount | null> {
    try {
      return await this.request<KbAccount>({
        method: "GET",
        path: "/1.0/kb/accounts",
        query: { externalKey },
        createdBy: "loafline"
      });
    } catch (err) {
      if (err instanceof KillBillError && err.status === 404) return null;
      throw err;
    }
  }

  async createAccount(input: KbAccountInput): Promise<KbAccount> {
    await this.request({
      method: "POST",
      path: "/1.0/kb/accounts",
      body: input,
      createdBy: "loafline"
    });
    const account = await this.getAccountByKey(input.externalKey);
    if (!account) throw new KillBillError(500, "account not readable after creation", false);
    return account;
  }

  async tagAccountDraft(accountId: string): Promise<void> {
    await this.request({
      method: "POST",
      path: `/1.0/kb/accounts/${accountId}/tags`,
      body: [AUTO_INVOICING_DRAFT_TAG_ID],
      createdBy: "loafline"
    });
  }

  // ---- invoices: external charges, tax items, commit ----

  async createExternalCharges(accountId: string, items: KbInvoiceItemInput[]): Promise<KbInvoiceItem[]> {
    return this.request<KbInvoiceItem[]>({
      method: "POST",
      path: `/1.0/kb/invoices/charges/${accountId}`,
      body: items,
      query: { autoCommit: "false" },
      createdBy: "loafline"
    });
  }

  async createTaxItems(accountId: string, items: KbInvoiceItemInput[]): Promise<KbInvoiceItem[]> {
    return this.request<KbInvoiceItem[]>({
      method: "POST",
      path: `/1.0/kb/invoices/taxes/${accountId}`,
      body: items,
      query: { autoCommit: "false" },
      createdBy: "loafline"
    });
  }

  async commitInvoice(invoiceId: string): Promise<void> {
    await this.request({
      method: "PUT",
      path: `/1.0/kb/invoices/${invoiceId}/commitInvoice`,
      createdBy: "loafline"
    });
  }

  /** Remove an auto-applied account-credit item, restoring the invoice balance. */
  async deleteCbaItem(invoiceId: string, invoiceItemId: string, accountId: string): Promise<void> {
    await this.request({
      method: "DELETE",
      path: `/1.0/kb/invoices/${invoiceId}/${invoiceItemId}/cba`,
      query: { accountId },
      createdBy: "loafline"
    });
  }

  async getInvoice(invoiceId: string): Promise<KbInvoice> {
    return this.request<KbInvoice>({
      method: "GET",
      path: `/1.0/kb/invoices/${invoiceId}`,
      createdBy: "loafline"
    });
  }

  async getInvoices(accountId: string): Promise<KbInvoiceSummary[]> {
    return this.request<KbInvoiceSummary[]>({
      method: "GET",
      path: `/1.0/kb/accounts/${accountId}/invoices`,
      createdBy: "loafline"
    });
  }

  // ---- payments ----

  async payInvoice(invoiceId: string, input: KbInvoicePaymentInput, createdBy: string): Promise<KbPayment> {
    let payment: KbPayment = {} as KbPayment;
    try {
      payment = await this.request<KbPayment>({
        method: "POST",
        path: `/1.0/kb/invoices/${invoiceId}/payments`,
        body: input,
        query: { externalPayment: "true" },
        createdBy
      });
    } catch (err) {
      if (err instanceof KillBillError && err.status === 400) {
        // A payment with this key may already exist from an earlier attempt.
        payment = {} as KbPayment;
      } else {
        throw err;
      }
    }
    if (payment.paymentId) return payment;
    // The instant-payment route sometimes answers 204 with no body; find the
    // payment through the invoice.
    for (let i = 0; i < 20; i++) {
      const payments = await this.getInvoicePayments(invoiceId);
      const found = payments.find((candidate) => candidate.paymentExternalKey === input.paymentExternalKey);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new KillBillError(404, "payment not found after purchase", false);
  }

  async getInvoicePayments(invoiceId: string): Promise<KbPayment[]> {
    return this.request<KbPayment[]>({
      method: "GET",
      path: `/1.0/kb/invoices/${invoiceId}/payments`,
      createdBy: "loafline"
    });
  }

  async getPayment(paymentId: string): Promise<KbPayment> {
    return this.request<KbPayment>({
      method: "GET",
      path: `/1.0/kb/payments/${paymentId}`,
      createdBy: "loafline"
    });
  }

  async getAccountPayments(accountId: string): Promise<KbPayment[]> {
    return this.request<KbPayment[]>({
      method: "GET",
      path: `/1.0/kb/accounts/${accountId}/payments`,
      createdBy: "loafline"
    });
  }

  // ---- refunds ----

  async refundInvoicePayment(paymentId: string, input: KbInvoiceRefundInput, createdBy: string): Promise<void> {
    await this.request({
      method: "POST",
      path: `/1.0/kb/invoicePayments/${paymentId}/refunds`,
      body: input,
      createdBy
    });
  }

  async refundPayment(paymentId: string, input: KbPaymentRefundInput, createdBy: string): Promise<void> {
    await this.request({
      method: "POST",
      path: `/1.0/kb/payments/${paymentId}/refunds`,
      body: input,
      createdBy
    });
  }

  // ---- subscriptions ----

  async createSubscription(input: KbSubscriptionInput): Promise<void> {
    await this.request({
      method: "POST",
      path: "/1.0/kb/subscriptions",
      body: input,
      query: { callCompletion: "false" },
      createdBy: "loafline"
    });
  }

  async getSubscriptionByKey(externalKey: string): Promise<KbSubscription> {
    return this.request<KbSubscription>({
      method: "GET",
      path: "/1.0/kb/subscriptions",
      query: { externalKey },
      createdBy: "loafline"
    });
  }

  async changePlan(subscriptionId: string, planName: string, requestedDate: string): Promise<void> {
    await this.request({
      method: "PUT",
      path: `/1.0/kb/subscriptions/${subscriptionId}`,
      body: { planName },
      query: { requestedDate, callCompletion: "false" },
      createdBy: "loafline"
    });
  }

  async undoChangePlan(subscriptionId: string): Promise<void> {
    await this.request({
      method: "PUT",
      path: `/1.0/kb/subscriptions/${subscriptionId}/undoChangePlan`,
      createdBy: "loafline"
    });
  }

  async cancelSubscription(subscriptionId: string, requestedDate: string): Promise<void> {
    await this.request({
      method: "DELETE",
      path: `/1.0/kb/subscriptions/${subscriptionId}`,
      query: {
        requestedDate,
        callCompletion: "false",
        entitlementPolicy: "END_OF_TERM",
        billingPolicy: "END_OF_TERM",
        useRequestedDateForBilling: "true"
      },
      createdBy: "loafline"
    });
  }

  async uncancelSubscription(subscriptionId: string): Promise<void> {
    await this.request({
      method: "PUT",
      path: `/1.0/kb/subscriptions/${subscriptionId}/uncancel`,
      createdBy: "loafline"
    });
  }

  async addSubscriptionBlockingState(
    subscriptionId: string,
    input: KbBlockingStateInput,
    requestedDate: string
  ): Promise<void> {
    await this.request({
      method: "POST",
      path: `/1.0/kb/subscriptions/${subscriptionId}/block`,
      body: input,
      query: { requestedDate },
      createdBy: "loafline"
    });
  }

  async getBlockingStates(accountId: string): Promise<KbBlockingState[]> {
    return this.request<KbBlockingState[]>({
      method: "GET",
      path: `/1.0/kb/accounts/${accountId}/block`,
      createdBy: "loafline"
    });
  }

  // ---- credits ----

  async createCredit(input: KbCreditInput, createdBy: string): Promise<KbInvoiceItem[]> {
    return this.request<KbInvoiceItem[]>({
      method: "POST",
      path: "/1.0/kb/credits",
      body: [input],
      query: { autoCommit: "true" },
      createdBy
    });
  }
}

// ---- wire types ----

export interface KbBasePlan {
  product: string;
  plan: string;
  priceList: string;
  finalPhaseBillingPeriod: string;
}

export interface KbSimplePlanInput {
  planId: string;
  productName: string;
  productCategory: "BASE";
  currency: "CAD";
  amount: number;
  billingPeriod: string;
  trialLength: number;
}

export interface KbAccount {
  accountId: string;
  externalKey?: string;
  name: string;
  currency: string;
  timeZone: string;
  locale?: string;
  accountCBA?: number | null;
  accountBalance?: number | null;
  paymentMethodId?: string;
}

export interface KbAccountInput {
  externalKey: string;
  name: string;
  currency: "CAD";
  timeZone: "America/Toronto";
  locale: string;
}

export interface KbInvoiceItemInput {
  itemType: "EXTERNAL_CHARGE" | "TAX" | "CREDIT_ADJ";
  description: string;
  amount: number;
  currency: "CAD";
  invoiceId?: string;
  accountId?: string;
}

export interface KbInvoiceItem {
  invoiceItemId: string;
  invoiceId: string;
  accountId?: string;
  itemType: string;
  description?: string;
  amount: number;
  currency: string;
  subscriptionId?: string;
}

export interface KbInvoice {
  invoiceId: string;
  invoiceNumber: number;
  accountId: string;
  status: string;
  amount: number;
  currency: string;
  balance: number;
  creditAdj?: number;
  invoiceDate?: string;
  targetDate?: string;
  items?: KbInvoiceItem[];
}

export interface KbInvoiceSummary {
  invoiceId: string;
  invoiceNumber: number;
  status: string;
  amount: number;
  balance: number;
  targetDate?: string;
  invoiceDate?: string;
}

export interface KbInvoicePaymentInput {
  targetInvoiceId: string;
  accountId: string;
  purchasedAmount: number;
  currency: "CAD";
  paymentExternalKey: string;
  transactions: {
    transactionExternalKey: string;
    transactionType: "PURCHASE";
    amount: number;
    currency: "CAD";
  }[];
}

export interface KbPaymentTransaction {
  transactionId: string;
  transactionExternalKey: string;
  transactionType: string;
  status: string;
  amount: number;
  currency: string;
  effectiveDate?: string;
}

export interface KbPayment {
  paymentId: string;
  paymentExternalKey?: string;
  accountId?: string;
  purchasedAmount?: number;
  refundedAmount?: number;
  transactions: KbPaymentTransaction[];
}

export interface KbInvoiceRefundInput {
  paymentId: string;
  amount: number;
  currency: "CAD";
  isAdjusted: boolean;
  adjustments: { invoiceItemId: string; amount: number }[];
  transactionExternalKey: string;
}

export interface KbPaymentRefundInput {
  amount: number;
  currency: "CAD";
  transactionExternalKey: string;
}

export interface KbSubscriptionInput {
  accountId: string;
  externalKey: string;
  planName: string;
}

export interface KbSubscription {
  subscriptionId: string;
  accountId: string;
  externalKey?: string;
  planName: string;
  state: string;
  startDate: string;
  chargedThroughDate?: string;
  futureCancellationDate?: string;
}

export interface KbBlockingStateInput {
  blockedId: string;
  stateName: string;
  service: "loafline";
  isBlockBilling: boolean;
  isBlockChange: boolean;
  isBlockEntitlement: boolean;
  effectiveDate: string;
  type: "SUBSCRIPTION";
}

export interface KbBlockingState {
  blockedId: string;
  stateName: string;
  service: string;
  isBlockBilling: boolean;
  isBlockChange: boolean;
  isBlockEntitlement: boolean;
  effectiveDate: string;
  type: string;
}

export interface KbCreditInput {
  accountId: string;
  amount: number;
  currency: "CAD";
  description: string;
  itemType: "CREDIT_ADJ";
}
