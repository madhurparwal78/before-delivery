// Kill Bill REST client (brief: Services › Kill Bill). Amounts cross this boundary as
// major-unit decimal strings built from minor units, and come back through `majorToMinor`.

import { config } from "./config.js";
import type { Currency } from "../shared/money.js";

export class BillingUnreachable extends Error {}

const AUTO_PAY_OFF = "00000000-0000-0000-0000-000000000001";

interface KbResponse {
  status: number;
  data: unknown;
  location: string | null;
}

async function call(method: string, path: string, body?: unknown, contentType = "application/json"): Promise<KbResponse> {
  const auth = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64");
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}/1.0/kb${path}`, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        "X-Killbill-ApiKey": config.killbill.apiKey,
        "X-Killbill-ApiSecret": config.killbill.apiSecret,
        "X-Killbill-CreatedBy": "halden-sightline",
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": contentType }),
      },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
  } catch {
    throw new BillingUnreachable();
  }
  const text = await response.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // XML or plain-text bodies stay as text
  }
  return { status: response.status, data, location: response.headers.get("location") };
}

async function ok(method: string, path: string, body?: unknown, contentType?: string): Promise<KbResponse> {
  const result = await call(method, path, body, contentType);
  if (result.status >= 300) throw new Error(`Kill Bill ${method} ${path} returned ${result.status}: ${JSON.stringify(result.data).slice(0, 400)}`);
  return result;
}

export async function assertBillingReachable(): Promise<void> {
  const result = await call("GET", "/tenants/userKeyValue/halden-probe");
  if (result.status >= 500) throw new BillingUnreachable();
}

const idFrom = (location: string | null) => (location ?? "").split("/").filter(Boolean).pop()?.split("?")[0] ?? "";

// Catalog

export interface KbPrice {
  currency: Currency;
  value: number;
}
export interface KbCatalogVersion {
  effectiveDate: string;
  products: { name: string; plans: { name: string; phases: { type: string; prices: KbPrice[]; fixedPrices: KbPrice[] }[] }[] }[];
}

/** Kill Bill holds catalog versions it cannot load, such as two with one effective date. */
export class CatalogUnreadable extends Error {
  message = "Kill Bill cannot load the tenant catalog";
}

export async function getCatalog(): Promise<KbCatalogVersion[]> {
  const result = await call("GET", "/catalog");
  if (result.status === 500 && JSON.stringify(result.data).includes("de-serialize catalog")) throw new CatalogUnreadable();
  if (result.status >= 300) throw new Error(`Kill Bill GET /catalog returned ${result.status}: ${JSON.stringify(result.data).slice(0, 400)}`);
  return (result.data as KbCatalogVersion[] | null) ?? [];
}

export async function uploadCatalogVersion(xml: string): Promise<void> {
  await ok("POST", "/catalog/xml", xml, "text/xml");
}

export async function deleteCatalog(): Promise<void> {
  await ok("DELETE", "/catalog");
}

// Accounts

export async function findAccount(externalKey: string): Promise<{ accountId: string; currency: Currency } | null> {
  const result = await call("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  if (result.status === 404) return null;
  if (result.status >= 300) throw new Error(`Kill Bill account lookup returned ${result.status}`);
  return result.data as { accountId: string; currency: Currency };
}

/** Creates the account with AUTO_PAY_OFF and an external payment method as default. */
export async function createAccount(externalKey: string, name: string, email: string, currency: Currency): Promise<string> {
  const created = await call("POST", "/accounts", { externalKey, name, email, currency });
  const accountId = created.status === 201 ? idFrom(created.location) : (await findAccount(externalKey))?.accountId;
  if (!accountId) throw new Error(`Kill Bill account create returned ${created.status}`);
  await ok("POST", `/accounts/${accountId}/tags`, [AUTO_PAY_OFF]).catch(async (error: unknown) => {
    const tags = await ok("GET", `/accounts/${accountId}/tags`);
    if (!(tags.data as { tagDefinitionId: string }[]).some((t) => t.tagDefinitionId === AUTO_PAY_OFF)) throw error;
  });
  const methods = await ok("GET", `/accounts/${accountId}/paymentMethods`);
  if (!(methods.data as unknown[]).length) {
    await ok("POST", `/accounts/${accountId}/paymentMethods?isDefault=true`, { pluginName: "__EXTERNAL_PAYMENT__" });
  }
  return accountId;
}

// Invoices and payments

export interface KbInvoiceItem {
  invoiceItemId: string;
  invoiceId: string;
  subscriptionId?: string | null;
  itemType: string;
  amount: number;
  description?: string;
}
export interface KbInvoice {
  invoiceId: string;
  amount: number;
  balance: number;
  currency: Currency;
  invoiceDate: string;
  invoiceNumber: string;
  items?: KbInvoiceItem[];
}

/** One invoice holding one external charge for the full amount. */
export async function chargeInvoice(accountId: string, amountMajor: string, currency: Currency, description: string): Promise<string> {
  const result = await ok("POST", `/invoices/charges/${accountId}?autoCommit=true`, [{ accountId, amount: amountMajor, currency, description }]);
  return (result.data as KbInvoiceItem[])[0].invoiceId;
}

export async function accountInvoices(accountId: string): Promise<KbInvoice[]> {
  return (await ok("GET", `/accounts/${accountId}/invoices?includeInvoiceComponents=true`)).data as KbInvoice[];
}

export interface KbTransaction {
  transactionId: string;
  transactionExternalKey: string;
  transactionType: string;
  amount: number;
  currency: Currency;
  effectiveDate: string;
  status: string;
}
export interface KbPayment {
  paymentId: string;
  paymentExternalKey: string;
  accountId: string;
  currency: Currency;
  transactions: KbTransaction[];
}

/** Pays the invoice in full with the account's external payment method; `paymentKey` makes it idempotent in Kill Bill. */
export async function payInvoice(accountId: string, invoiceId: string, amountMajor: string, paymentKey: string): Promise<KbPayment> {
  const existing = await call("GET", `/payments?externalKey=${encodeURIComponent(paymentKey)}`);
  if (existing.status === 200) return existing.data as KbPayment;
  const created = await ok("POST", `/invoices/${invoiceId}/payments?externalPayment=true`, {
    accountId,
    targetInvoiceId: invoiceId,
    purchasedAmount: amountMajor,
    paymentExternalKey: paymentKey,
  });
  const paymentId = idFrom(created.location);
  return (await ok("GET", `/payments/${paymentId}`)).data as KbPayment;
}

export function successfulPurchase(payment: KbPayment): KbTransaction | undefined {
  return payment.transactions.find((t) => t.transactionType === "PURCHASE" && t.status === "SUCCESS");
}

/** A refund transaction on the original payment; `refundKey` makes it idempotent in Kill Bill. */
export async function refundPayment(paymentId: string, amountMajor: string, currency: Currency, refundKey: string): Promise<KbTransaction> {
  const payment = (await ok("GET", `/payments/${paymentId}`)).data as KbPayment;
  const done = payment.transactions.find((t) => t.transactionExternalKey === refundKey && t.status === "SUCCESS");
  if (done) return done;
  await ok("POST", `/payments/${paymentId}/refunds`, { amount: amountMajor, currency, transactionExternalKey: refundKey });
  const after = (await ok("GET", `/payments/${paymentId}`)).data as KbPayment;
  const refund = after.transactions.find((t) => t.transactionExternalKey === refundKey);
  if (!refund || refund.status !== "SUCCESS") throw new Error(`Kill Bill refund ${refundKey} did not succeed`);
  return refund;
}

/** Every payment of the tenant, page by page. */
export async function allPayments(): Promise<KbPayment[]> {
  const payments: KbPayment[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = (await ok("GET", `/payments/pagination?offset=${offset}&limit=500&withPluginInfo=false`)).data as KbPayment[];
    payments.push(...page);
    if (page.length < 500) return payments;
  }
}

// Subscriptions

export interface KbEvent {
  eventType: string;
  effectiveDate: string;
  plan: string | null;
}
export interface KbSubscription {
  subscriptionId: string;
  accountId: string;
  planName: string;
  state: string;
  startDate: string;
  chargedThroughDate: string | null;
  billingEndDate: string | null;
  cancelledDate: string | null;
  events: KbEvent[];
}

export async function accountSubscriptions(accountId: string): Promise<KbSubscription[]> {
  const bundles = (await ok("GET", `/accounts/${accountId}/bundles`)).data as { subscriptions: KbSubscription[] }[];
  return bundles.flatMap((b) => b.subscriptions);
}

export async function createSubscription(accountId: string, planName: string): Promise<string> {
  const created = await ok("POST", "/subscriptions?callCompletion=true&callTimeoutSec=30", { accountId, planName });
  return idFrom(created.location);
}

/** A plan change under the catalog's change rules (upgrades at once, downgrades at end of term). */
export async function changePlan(subscriptionId: string, planName: string): Promise<void> {
  await ok("PUT", `/subscriptions/${subscriptionId}?callCompletion=true&callTimeoutSec=30`, { planName });
}

export async function undoChangePlan(subscriptionId: string): Promise<void> {
  await ok("PUT", `/subscriptions/${subscriptionId}/undoChangePlan`, {});
}

/** Cancellation at the end of the paid term, for entitlement and billing alike. */
export async function cancelAtEndOfTerm(subscriptionId: string): Promise<void> {
  await ok("DELETE", `/subscriptions/${subscriptionId}?entitlementPolicy=END_OF_TERM&billingPolicy=END_OF_TERM`);
}

/** Cancellation now, used for a declined join, an overdue cancellation and the dunning end. */
export async function cancelImmediately(subscriptionId: string): Promise<void> {
  await ok("DELETE", `/subscriptions/${subscriptionId}?entitlementPolicy=IMMEDIATE&billingPolicy=IMMEDIATE&useRequestedDateForBilling=true`);
}

export async function uncancel(subscriptionId: string): Promise<void> {
  await ok("PUT", `/subscriptions/${subscriptionId}/uncancel`, {});
}
