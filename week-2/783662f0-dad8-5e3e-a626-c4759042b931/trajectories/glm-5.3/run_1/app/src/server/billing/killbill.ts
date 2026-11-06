/** Kill Bill client: the only source of billing truth. */

import { config } from "../config.js";

export interface KbAccount {
  accountId: string;
  name: string | null;
  externalKey: string | null;
  currency: string | null;
  paymentMethodId: string | null;
}

export interface KbSubscriptionEvent {
  eventId: string;
  effectiveDate: string;
  eventType: string;
  plan: string | null;
}

export interface KbSubscription {
  subscriptionId: string;
  externalKey: string | null;
  planName: string;
  state: string;
  startDate: string | null;
  events: KbSubscriptionEvent[];
}

export interface KbInvoiceItem {
  invoiceItemId: string;
  invoiceId: string;
  itemType: string | null;
  planName: string | null;
  productName: string | null;
  amount: number;
  currency: string | null;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
}

export interface KbInvoice {
  invoiceId: string;
  invoiceNumber: number;
  invoiceDate: string;
  targetDate: string | null;
  currency: string | null;
  status: string;
  balance: number;
  amount: number;
  items: KbInvoiceItem[];
  credits: number | null;
}

export interface KbPaymentTransaction {
  transactionId: string;
  transactionExternalKey: string | null;
  transactionType: string;
  status: string;
  effectiveDate: string;
  amount: number;
}

export interface KbPayment {
  paymentId: string;
  paymentNumber: number;
  paymentExternalKey: string | null;
  accountId: string | null;
  paymentMethodId: string | null;
  purchasedAmount: number;
  refundedAmount: number;
  currency: string | null;
  transactions: KbPaymentTransaction[];
}

export interface KbInvoicePayment {
  paymentId: string;
  paymentNumber: number;
  paymentExternalKey: string | null;
  accountId: string | null;
  targetInvoiceId: string | null;
  purchasedAmount: number;
  refundedAmount: number;
  currency: string | null;
  transactions: KbPaymentTransaction[];
}

export interface KbTenant {
  tenantId: string;
}

export interface KbTagDefinition {
  id: string;
  name: string;
  isControlTag: boolean;
}

export class KillBillError extends Error {
  constructor(
    public readonly kind: "timeout" | "unreachable" | "http" | "not_found",
    public readonly status: number,
    public readonly body: string
  ) {
    super(body.slice(0, 200));
    this.name = "KillBillError";
  }

  /** True when the provider is entirely unreachable, as opposed to merely slow. */
  get isOutage(): boolean {
    return this.kind === "unreachable" || this.kind === "http";
  }
}

interface CallOptions {
  timeoutMs?: number;
  accept?: string;
  noBody?: boolean;
}

async function call(method: string, path: string, body: unknown, opts: CallOptions = {}): Promise<{ status: number; text: string; headers: Headers }> {
  const cfg = config().killbill;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 7000);
  const auth = Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64");
  try {
    const headers: Record<string, string> = {
      Accept: opts.accept ?? "application/json",
      Authorization: `Basic ${auth}`,
      "X-Killbill-ApiKey": cfg.apiKey,
      "X-Killbill-ApiSecret": cfg.apiSecret,
      "X-Killbill-CreatedBy": "plotwright",
    };
    if (opts.noBody !== true) {
      headers["Content-Type"] = "application/json";
    }
    const res = await fetch(`${cfg.url}${path}`, {
      method,
      headers,
      body: opts.noBody === true ? null : typeof body === "string" ? body : JSON.stringify(body),
      signal: controller.signal,
    });
    return { status: res.status, text: await res.text(), headers: res.headers };
  } catch (err) {
    if (err instanceof KillBillError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new KillBillError("timeout", 0, "The billing provider did not answer in time.");
    }
    throw new KillBillError("unreachable", 0, String(err));
  } finally {
    clearTimeout(timer);
  }
}

async function callJson<T>(method: string, path: string, body: unknown, opts: CallOptions = {}): Promise<{ status: number; value: T | null }> {
  const res = await call(method, path, body, opts);
  if (res.status === 404) throw new KillBillError("not_found", 404, res.text);
  if (!isSuccess(res.status)) throw new KillBillError("http", res.status, res.text);
  const value = res.text === "" ? null : (JSON.parse(res.text) as T);
  return { status: res.status, value };
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

function idFromLocation(location: string | null): string {
  if (location === null || location === "") throw new KillBillError("http", 0, "Missing Location header");
  return location.split("/").filter(Boolean).pop()!;
}

export async function isReachable(): Promise<boolean> {
  try {
    const res = await call("GET", `/1.0/kb/tenants?apiKey=${encodeURIComponent(config().killbill.apiKey)}`, undefined, {
      timeoutMs: 3000,
      noBody: true,
    });
    return res.status < 500;
  } catch {
    return false;
  }
}

export async function findTenant(): Promise<KbTenant | null> {
  const res = await call("GET", `/1.0/kb/tenants?apiKey=${encodeURIComponent(config().killbill.apiKey)}`, undefined, { noBody: true });
  if (!isSuccess(res.status)) return null;
  const data = JSON.parse(res.text) as KbTenant[] | KbTenant;
  const rows = Array.isArray(data) ? data : [data];
  return rows.length > 0 ? rows[0]! : null;
}

export async function createTenant(): Promise<KbTenant> {
  const res = await call("POST", "/1.0/kb/tenants", { apiKey: config().killbill.apiKey, apiSecret: config().killbill.apiSecret });
  if (!isSuccess(res.status)) throw new KillBillError("http", res.status, res.text);
  return JSON.parse(res.text) as KbTenant;
}

/** Uploads the product catalog if absent: two BASE products with evergreen monthly plans, immediate plan changes. */
export async function ensureCatalog(): Promise<void> {
  if (await catalogHasPlans()) return;
  const plans: { planId: string; product: string; amount: number }[] = [
    { planId: "hamlet-monthly", product: "Hamlet", amount: 6 },
    { planId: "borough-monthly", product: "Borough", amount: 12 },
  ];
  for (const plan of plans) {
    const res = await call(
      "POST",
      "/1.0/kb/catalog/simplePlan",
      { planId: plan.planId, productName: plan.product, productCategory: "BASE", billingPeriod: "MONTHLY", currency: "USD", amount: plan.amount },
      { timeoutMs: 20000 }
    );
    if (!isSuccess(res.status) && !(await catalogHasPlans())) {
      throw new KillBillError("http", res.status, res.text);
    }
  }
}

async function catalogHasPlans(): Promise<boolean> {
  try {
    const res = await call("GET", "/1.0/kb/catalog", undefined, { noBody: true, accept: "text/xml", timeoutMs: 8000 });
    return res.text.includes("hamlet-monthly");
  } catch {
    return false;
  }
}

let autoPayOffTagId: string | null = null;

/** The AUTO_PAY_OFF tag definition id, looked up by name once. */
export async function autoPayOffTag(): Promise<string> {
  if (autoPayOffTagId !== null) return autoPayOffTagId;
  const res = await call("GET", "/1.0/kb/tagDefinitions", undefined, { noBody: true });
  if (!isSuccess(res.status)) throw new KillBillError("http", res.status, res.text);
  const defs = JSON.parse(res.text) as KbTagDefinition[];
  const found = defs.find((d) => d.name === "AUTO_PAY_OFF");
  if (found === undefined) throw new KillBillError("http", 404, "AUTO_PAY_OFF tag definition missing");
  autoPayOffTagId = found.id;
  return found.id;
}

export async function createAccount(externalKey: string, name: string): Promise<KbAccount> {
  const res = await call("POST", "/1.0/kb/accounts", { name, externalKey, currency: "USD" }, { timeoutMs: 15000 });
  if (!isSuccess(res.status)) throw new KillBillError("http", res.status, res.text);
  return await getAccount(idFromLocation(res.headers.get("location")));
}

export async function getAccount(accountId: string): Promise<KbAccount> {
  const res = await call("GET", `/1.0/kb/accounts/${accountId}`, undefined, { noBody: true });
  if (!isSuccess(res.status)) throw new KillBillError("http", res.status, res.text);
  return JSON.parse(res.text) as KbAccount;
}

export async function addAutoPayOffTag(accountId: string): Promise<void> {
  const tagId = await autoPayOffTag();
  const res = await call("POST", `/1.0/kb/accounts/${accountId}/tags`, [tagId]);
  if (!isSuccess(res.status)) {
    // A retry after a partial failure may find the tag already present.
    const tags = await listAccountTags(accountId);
    if (tags.includes(tagId)) return;
    throw new KillBillError("http", res.status, res.text);
  }
}

export async function listAccountTags(accountId: string): Promise<string[]> {
  const res = await call("GET", `/1.0/kb/accounts/${accountId}/tags`, undefined, { noBody: true });
  if (!isSuccess(res.status)) return [];
  const tags = JSON.parse(res.text) as { tagDefinitionId?: string; id?: string }[];
  return tags.map((t) => t.tagDefinitionId ?? t.id ?? "").filter((t) => t !== "");
}

export async function createSubscription(accountId: string, externalKey: string, bundleExternalKey: string, planName: string): Promise<KbSubscription> {
  const res = await call(
    "POST",
    "/1.0/kb/subscriptions?entitlementPolicy=IMMEDIATE&billingPolicy=IMMEDIATE",
    { accountId, externalKey, bundleExternalKey, planName },
    { timeoutMs: 20000 }
  );
  if (!isSuccess(res.status)) throw new KillBillError("http", res.status, res.text);
  return await getSubscription(idFromLocation(res.headers.get("location")));
}

export async function findSubscriptionByExternalKey(externalKey: string): Promise<KbSubscription | null> {
  try {
    const res = await callJson<KbSubscription | KbSubscription[]>(
      "GET",
      `/1.0/kb/subscriptions?externalKey=${encodeURIComponent(externalKey)}`,
      undefined,
      { noBody: true }
    );
    const rows = Array.isArray(res.value) ? res.value : [res.value!];
    return rows.length > 0 ? rows[0]! : null;
  } catch (err) {
    if (err instanceof KillBillError && err.kind === "not_found") return null;
    throw err;
  }
}

export async function getSubscription(subscriptionId: string): Promise<KbSubscription> {
  const res = await call("GET", `/1.0/kb/subscriptions/${subscriptionId}`, undefined, { noBody: true });
  if (!isSuccess(res.status)) throw new KillBillError("http", res.status, res.text);
  return JSON.parse(res.text) as KbSubscription;
}

export async function changeSubscriptionPlan(subscriptionId: string, planName: string): Promise<void> {
  const res = await call(
    "PUT",
    `/1.0/kb/subscriptions/${subscriptionId}?billingPolicy=IMMEDIATE&entitlementPolicy=IMMEDIATE`,
    { planName },
    { timeoutMs: 20000 }
  );
  if (!isSuccess(res.status)) throw new KillBillError("http", res.status, res.text);
}

/** The invoice ids for an account. The list view is truncated; each invoice is fetched for its data. */
export async function listInvoiceIds(accountId: string): Promise<string[]> {
  const res = await call("GET", `/1.0/kb/accounts/${accountId}/invoices`, undefined, { noBody: true });
  if (!isSuccess(res.status)) throw new KillBillError("http", res.status, res.text);
  const rows = JSON.parse(res.text) as { invoiceId: string }[];
  return rows.map((r) => r.invoiceId);
}

export async function getInvoice(invoiceId: string): Promise<KbInvoice> {
  const res = await call("GET", `/1.0/kb/invoices/${invoiceId}?withItems=true`, undefined, { noBody: true });
  if (!isSuccess(res.status)) throw new KillBillError("http", res.status, res.text);
  return JSON.parse(res.text) as KbInvoice;
}

export async function getInvoicesForAccount(accountId: string): Promise<KbInvoice[]> {
  const ids = await listInvoiceIds(accountId);
  const invoices: KbInvoice[] = [];
  for (const id of ids) {
    invoices.push(await getInvoice(id));
  }
  return invoices;
}

/** An external payment for an invoice. Idempotent in Kill Bill on the payment external key. */
export async function payInvoiceExternally(accountId: string, invoiceId: string, amount: number, paymentExternalKey: string): Promise<void> {
  const body = {
    accountId,
    targetInvoiceId: invoiceId,
    purchasedAmount: amount,
    currency: "USD",
    paymentExternalKey,
    transactions: [{ transactionType: "PURCHASE", amount, currency: "USD", transactionExternalKey: `${paymentExternalKey}-tx` }],
  };
  const res = await call("POST", `/1.0/kb/invoices/${invoiceId}/payments?externalPayment=true`, body, { timeoutMs: 5000 });
  if (!isSuccess(res.status)) throw new KillBillError("http", res.status, res.text);
}

export async function getInvoicePayments(invoiceId: string): Promise<KbInvoicePayment[]> {
  const res = await call("GET", `/1.0/kb/invoices/${invoiceId}/payments`, undefined, { noBody: true });
  if (!isSuccess(res.status)) throw new KillBillError("http", res.status, res.text);
  return JSON.parse(res.text) as KbInvoicePayment[];
}

export async function getPaymentByExternalKey(externalKey: string): Promise<KbPayment | null> {
  try {
    const res = await callJson<KbPayment>("GET", `/1.0/kb/payments?externalKey=${encodeURIComponent(externalKey)}`, undefined, { noBody: true });
    return res.value;
  } catch (err) {
    if (err instanceof KillBillError && err.kind === "not_found") return null;
    throw err;
  }
}

export async function refundPayment(paymentId: string, amount: number, transactionExternalKey: string): Promise<void> {
  const res = await call(
    "POST",
    `/1.0/kb/payments/${paymentId}/refunds?adjusted=NONE`,
    { transactionType: "REFUND", amount, currency: "USD", transactionExternalKey },
    { timeoutMs: 20000 }
  );
  if (!isSuccess(res.status)) throw new KillBillError("http", res.status, res.text);
}

/** Creates the account's external payment method, used for buyer coin payments. Returns its id. */
export async function createExternalPaymentMethod(accountId: string): Promise<string> {
  const res = await call("POST", `/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`, {
    pluginName: "__EXTERNAL_PAYMENT__",
    isDefault: true,
  });
  if (!isSuccess(res.status)) throw new KillBillError("http", res.status, res.text);
  return idFromLocation(res.headers.get("location"));
}

/** An external payment on a buyer account. Idempotent on the payment external key. */
export async function payAccountExternally(accountId: string, paymentMethodId: string, amount: number, paymentExternalKey: string): Promise<void> {
  const body = {
    transactionType: "PURCHASE",
    amount,
    currency: "USD",
    paymentExternalKey,
    transactionExternalKey: `${paymentExternalKey}-tx`,
  };
  const res = await call(
    "POST",
    `/1.0/kb/accounts/${accountId}/payments?externalPayment=true&paymentMethodId=${encodeURIComponent(paymentMethodId)}`,
    body,
    { timeoutMs: 5000 }
  );
  if (!isSuccess(res.status)) throw new KillBillError("http", res.status, res.text);
}

export function isPaymentSuccessful(payment: KbPayment | null): boolean {
  if (payment === null) return false;
  return payment.transactions.some((t) => t.transactionType === "PURCHASE" && t.status === "SUCCESS");
}
