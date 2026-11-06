import { config } from "./config";
import { errors } from "./http";
import { ZONE } from "./time";
import { toAmount, type Currency } from "../shared/money";

// Kill Bill over its REST API. Every call connects afresh; a refused connection or a server error
// surfaces as 503 billing_unavailable, and nothing about a failure is remembered between calls.

const BASE = `${config.killbill.url}/1.0/kb`;
const AUTH = `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64")}`;
const AUTO_PAY_OFF = "00000000-0000-0000-0000-000000000001";
export const AUTO_INVOICING_OFF = "00000000-0000-0000-0000-000000000002";

interface KbResponse {
  status: number;
  json: unknown;
  location: string | null;
}

/** Amounts arrive as JSON numbers; they are kept as their exact source text, never as floats. */
function parseExact(text: string): unknown {
  if (!text) return null;
  return JSON.parse(text, (_key, value, context?: { source?: string }) =>
    typeof value === "number" && context?.source ? context.source : value,
  );
}

export async function kb(
  method: string,
  path: string,
  options: { query?: Record<string, string>; body?: unknown; xml?: string; timeoutMs?: number } = {},
): Promise<KbResponse> {
  const url = new URL(`${BASE}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.append(key, value);
  const headers: Record<string, string> = {
    Authorization: AUTH,
    "X-Killbill-ApiKey": config.killbill.apiKey,
    "X-Killbill-ApiSecret": config.killbill.apiSecret,
    "X-Killbill-CreatedBy": "pampero-ledger",
    Accept: "application/json",
  };
  let payload: string | undefined;
  if (options.xml !== undefined) {
    headers["Content-Type"] = "text/xml";
    payload = options.xml;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(options.body);
  }
  let response: Response;
  try {
    response = await fetch(url, { method, headers, body: payload, signal: AbortSignal.timeout(options.timeoutMs ?? 20_000) });
  } catch {
    throw errors.billing();
  }
  const text = await response.text().catch(() => "");
  if (response.status >= 500) throw errors.billing();
  let json: unknown = null;
  try {
    json = parseExact(text);
  } catch {
    json = text;
  }
  return { status: response.status, json, location: response.headers.get("location") };
}

/** A 408 is Kill Bill saying the change was made but its completion event was not seen in time. */
async function ok(method: string, path: string, options: Parameters<typeof kb>[2] = {}): Promise<KbResponse> {
  const response = await kb(method, path, options);
  if (response.status >= 400 && response.status !== 408) throw errors.billing();
  return response;
}

function idFrom(location: string | null): string {
  const id = (location ?? "").split("/").filter(Boolean).pop();
  if (!id) throw errors.billing();
  return id;
}

/** Kill Bill decimal text (`933333.33`, `0E-9`, `-50.000000000`) to minor units, half-up. */
export function kbMinor(value: unknown): bigint {
  const text = String(value ?? "0").trim();
  const match = /^(-?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) throw new Error(`not a Kill Bill amount: ${text}`);
  const [, sign, whole = "", fraction = "", exponent = "0"] = match;
  const digits = BigInt(`${whole}${fraction}` || "0");
  const scale = fraction.length - Number(exponent) - 2;
  let minor: bigint;
  if (scale <= 0) minor = digits * 10n ** BigInt(-scale);
  else {
    const divisor = 10n ** BigInt(scale);
    minor = (digits * 2n + divisor) / (2n * divisor);
  }
  return sign === "-" ? -minor : minor;
}


/**
 * Kill Bill stores every invoice item, payment transaction and invoice payment in a decimal(15,9)
 * column, so no single record can reach 1,000,000. Larger peso amounts travel as several records
 * that sum exactly to the amount.
 */
const RECORD_CEILING = 99_999_999n;

function recordParts(minor: bigint): bigint[] {
  const parts: bigint[] = [];
  let left = minor;
  while (left > RECORD_CEILING) {
    parts.push(RECORD_CEILING);
    left -= RECORD_CEILING;
  }
  parts.push(left);
  return parts;
}

// ---- health and catalog

export async function killbillHealthy(): Promise<boolean> {
  try {
    const response = await fetch(`${config.killbill.url}/1.0/healthcheck`, { signal: AbortSignal.timeout(1_500) });
    return response.status === 200;
  } catch {
    return false;
  }
}

export async function catalogLoaded(): Promise<boolean> {
  const response = await ok("GET", "/catalog");
  return Array.isArray(response.json) && response.json.length > 0;
}

export async function uploadCatalog(xml: string): Promise<void> {
  const response = await kb("POST", "/catalog/xml", { xml });
  if (response.status >= 400 && !(await catalogLoaded())) throw errors.billing();
}

// ---- accounts

interface KbAccountSpec {
  externalKey: string;
  name: string;
  email: string;
  currency: Currency;
}

async function accountByKey(externalKey: string): Promise<string | null> {
  const response = await kb("GET", "/accounts", { query: { externalKey } });
  if (response.status === 404) return null;
  if (response.status >= 400) throw errors.billing();
  return String((response.json as { accountId: string }).accountId);
}

/** Finds or creates the billing account: AUTO_PAY_OFF and the external payment plugin as default. */
export async function ensureAccount(spec: KbAccountSpec): Promise<string> {
  let accountId = await accountByKey(spec.externalKey);
  if (!accountId) {
    const created = await kb("POST", "/accounts", {
      body: { name: spec.name, email: spec.email, currency: spec.currency, timeZone: ZONE, externalKey: spec.externalKey },
    });
    if (created.status === 201) accountId = idFrom(created.location);
    else accountId = await accountByKey(spec.externalKey);
    if (!accountId) throw errors.billing();
  }
  const tags = (await ok("GET", `/accounts/${accountId}/tags`)).json as { tagDefinitionId: string }[];
  if (!tags.some((tag) => tag.tagDefinitionId === AUTO_PAY_OFF)) {
    await ok("POST", `/accounts/${accountId}/tags`, { body: [AUTO_PAY_OFF] });
  }
  const account = (await ok("GET", `/accounts/${accountId}`)).json as { paymentMethodId: string | null };
  if (!account.paymentMethodId) {
    await ok("POST", `/accounts/${accountId}/paymentMethods`, {
      query: { isDefault: "true" },
      body: { pluginName: "__EXTERNAL_PAYMENT__", pluginInfo: { properties: [] } },
    });
  }
  return accountId;
}

export async function setAccountTag(accountId: string, tag: string, on: boolean): Promise<void> {
  if (on) await ok("POST", `/accounts/${accountId}/tags`, { body: [tag] });
  else await ok("DELETE", `/accounts/${accountId}/tags`, { query: { tagDef: tag } });
}

export async function accountCredit(accountId: string): Promise<bigint> {
  const response = await ok("GET", `/accounts/${accountId}`, { query: { accountWithBalanceAndCBA: "true" } });
  return kbMinor((response.json as { accountCBA: unknown }).accountCBA);
}

// ---- invoices

export interface KbItem {
  invoiceItemId: string;
  itemType: string;
  description: string | null;
  amount: string;
  startDate: string | null;
  endDate: string | null;
  subscriptionId: string | null;
  planName: string | null;
}

export interface KbInvoice {
  invoiceId: string;
  accountId: string;
  invoiceNumber: string;
  invoiceDate: string;
  targetDate: string;
  amount: string;
  balance: string;
  status: string;
  currency: Currency;
  items: KbItem[];
}

function asInvoice(raw: unknown): KbInvoice {
  const invoice = raw as KbInvoice;
  return { ...invoice, invoiceNumber: String(invoice.invoiceNumber), items: invoice.items ?? [] };
}

export async function invoice(invoiceId: string): Promise<KbInvoice | null> {
  const response = await kb("GET", `/invoices/${invoiceId}`);
  if (response.status === 404) return null;
  if (response.status >= 400) throw errors.billing();
  return asInvoice(response.json);
}

export async function accountInvoices(accountId: string): Promise<KbInvoice[]> {
  const response = await ok("GET", `/accounts/${accountId}/invoices`, {
    query: { includeInvoiceComponents: "true", includeVoidedInvoices: "true" },
  });
  return (response.json as unknown[]).map(asInvoice);
}

/** One external-charge invoice for an amount, described as given, committed at once. */
export async function externalCharge(accountId: string, minor: bigint, currency: Currency, description: string): Promise<KbInvoice> {
  const response = await ok("POST", `/invoices/charges/${accountId}`, {
    query: { autoCommit: "true" },
    body: recordParts(minor).map((part) => ({ accountId, amount: toAmount(part), currency, description })),
  });
  const first = (response.json as { invoiceId: string }[])[0];
  if (!first) throw errors.billing();
  const held = await invoice(first.invoiceId);
  if (!held) throw errors.billing();
  return held;
}

export async function voidInvoice(invoiceId: string): Promise<void> {
  await ok("PUT", `/invoices/${invoiceId}/voidInvoice`);
}

export async function generateInvoice(accountId: string, targetDate: string): Promise<void> {
  const response = await kb("POST", "/invoices", { query: { accountId, targetDate } });
  if (response.status >= 400 && response.status !== 404) throw errors.billing();
}

// ---- payments

interface KbTransaction {
  transactionId: string;
  transactionType: string;
  amount: string;
  status: string;
}

interface KbPayment {
  paymentId: string;
  paymentExternalKey: string;
  transactions: KbTransaction[];
}

async function paymentByKey(externalKey: string): Promise<KbPayment | null> {
  const response = await kb("GET", "/payments", { query: { externalKey } });
  if (response.status === 404) return null;
  if (response.status >= 400) throw errors.billing();
  return response.json as KbPayment;
}

async function payment(paymentId: string): Promise<KbPayment> {
  return (await ok("GET", `/payments/${paymentId}`)).json as KbPayment;
}

/** The first payment external key not used yet: `base`, then `base-2`, `base-3`… */
async function freeKey(base: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const key = attempt === 1 ? base : `${base}-${attempt}`;
    if (!(await paymentByKey(key))) return key;
  }
}

/** Authorizes an amount on the account's default method; returns one payment id per record part. */
export async function authorize(accountId: string, minor: bigint, currency: Currency, externalKey: string): Promise<string[]> {
  const key = await freeKey(externalKey);
  const ids: string[] = [];
  const parts = recordParts(minor);
  for (const [index, part] of parts.entries()) {
    const response = await kb("POST", `/accounts/${accountId}/payments`, {
      body: { transactionType: "AUTHORIZE", amount: toAmount(part), currency, paymentExternalKey: index === 0 ? key : `${key}-part-${index + 1}` },
    });
    if (response.status !== 201) {
      await voidPayments(ids).catch(() => undefined);
      throw errors.billing();
    }
    ids.push(idFrom(response.location));
  }
  return ids;
}

async function authorizedAmount(paymentId: string): Promise<string> {
  const found = await payment(paymentId);
  const auth = found.transactions.find((t) => t.transactionType === "AUTHORIZE");
  if (!auth) throw errors.billing();
  return auth.amount;
}

export async function capture(paymentIds: string[], currency: Currency): Promise<void> {
  for (const paymentId of paymentIds) {
    await ok("POST", `/payments/${paymentId}`, { body: { amount: await authorizedAmount(paymentId), currency } });
  }
}

export async function voidPayments(paymentIds: string[]): Promise<void> {
  for (const paymentId of paymentIds) await ok("DELETE", `/payments/${paymentId}`, { body: {} });
}

/**
 * Kill Bill's invoice-payment control plugin only links PURCHASE payments to invoices, so a captured
 * authorization settles its invoice with a linked payment on the external plugin for the same amount.
 */
export async function settleInvoice(accountId: string, invoiceId: string, minor: bigint, externalKey: string): Promise<void> {
  for (const [index, part] of recordParts(minor).entries()) {
    const key = index === 0 ? externalKey : `${externalKey}-part-${index + 1}`;
    if (await paymentByKey(key)) continue;
    await ok("POST", `/invoices/${invoiceId}/payments`, {
      query: { externalPayment: "true" },
      body: { accountId, purchasedAmount: toAmount(part), paymentExternalKey: key },
    });
  }
}

/** Refunds part of a payment; returns the REFUND transaction id. */
export async function refund(paymentId: string, minor: bigint, currency: Currency): Promise<string> {
  const response = await ok("POST", `/payments/${paymentId}/refunds`, { body: { amount: toAmount(minor), currency } });
  const refunded = (await payment(idFrom(response.location) || paymentId)).transactions.filter((t) => t.transactionType === "REFUND");
  const last = refunded[refunded.length - 1];
  if (!last) throw errors.billing();
  return last.transactionId;
}

export async function addCredit(accountId: string, minor: bigint, currency: Currency, description: string): Promise<void> {
  await ok("POST", "/credits", {
    query: { autoCommit: "true" },
    body: recordParts(minor).map((part) => ({ accountId, amount: toAmount(part), currency, description })),
  });
}

// ---- subscriptions

export interface KbEvent {
  eventType: string;
  effectiveDate: string;
  serviceName: string;
}

export interface KbSubscription {
  subscriptionId: string;
  bundleId: string;
  productName: string;
  planName: string;
  state: string;
  chargedThroughDate: string | null;
  billingStartDate: string | null;
  billingEndDate: string | null;
  cancelledDate: string | null;
  events: KbEvent[];
}

export interface KbBundle {
  bundleId: string;
  externalKey: string;
  subscriptions: KbSubscription[];
  timeline: { events: KbEvent[] };
}

export interface PriceOverride {
  phaseName: string;
  recurringPrice: string;
}

export function careOverride(planName: string, catalogMinor: bigint, lockedMinor: bigint): PriceOverride[] | undefined {
  return catalogMinor === lockedMinor ? undefined : [{ phaseName: `${planName}-evergreen`, recurringPrice: toAmount(lockedMinor) }];
}

async function bundleByKey(externalKey: string): Promise<KbBundle | null> {
  const response = await kb("GET", "/bundles", { query: { externalKey } });
  if (response.status === 404) return null;
  if (response.status >= 400) throw errors.billing();
  const found = response.json as KbBundle | KbBundle[];
  return (Array.isArray(found) ? found[0] : found) ?? null;
}

export async function bundle(bundleId: string): Promise<KbBundle> {
  return (await ok("GET", `/bundles/${bundleId}`)).json as KbBundle;
}

export async function createSubscription(spec: {
  accountId: string;
  bundleKey: string;
  planName: string;
  overrides?: PriceOverride[];
  startDate?: string;
}): Promise<KbBundle> {
  const existing = await bundleByKey(spec.bundleKey);
  if (existing) return existing;
  const response = await kb("POST", "/subscriptions", {
    query: {
      callCompletion: "true",
      callTimeoutSec: "20",
      ...(spec.startDate ? { entitlementDate: spec.startDate, billingDate: spec.startDate } : {}),
    },
    body: {
      accountId: spec.accountId,
      bundleExternalKey: spec.bundleKey,
      externalKey: spec.bundleKey,
      planName: spec.planName,
      ...(spec.overrides ? { priceOverrides: spec.overrides } : {}),
    },
    timeoutMs: 40_000,
  });
  if (response.status >= 400 && response.status !== 408) throw errors.billing();
  for (let tries = 0; tries < 40; tries++) {
    const created = await bundleByKey(spec.bundleKey);
    if (created?.subscriptions[0]) return created;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw errors.billing();
}

export async function dryRunChange(spec: {
  accountId: string;
  bundleId: string;
  subscriptionId: string;
  productName: string;
  overrides?: PriceOverride[];
}): Promise<KbInvoice | null> {
  const response = await ok("POST", "/invoices/dryRun", {
    query: { accountId: spec.accountId },
    body: {
      dryRunType: "SUBSCRIPTION_ACTION",
      dryRunAction: "CHANGE",
      subscriptionId: spec.subscriptionId,
      bundleId: spec.bundleId,
      productName: spec.productName,
      productCategory: "BASE",
      billingPeriod: "MONTHLY",
      priceListName: "DEFAULT",
      ...(spec.overrides ? { priceOverrides: spec.overrides } : {}),
    },
  });
  return response.status === 204 || !response.json ? null : asInvoice(response.json);
}

export async function changePlan(subscriptionId: string, productName: string, overrides?: PriceOverride[]): Promise<void> {
  await ok("PUT", `/subscriptions/${subscriptionId}`, {
    query: { callCompletion: "true", callTimeoutSec: "20", billingPolicy: "IMMEDIATE" },
    body: {
      productName,
      productCategory: "BASE",
      billingPeriod: "MONTHLY",
      priceList: "DEFAULT",
      ...(overrides ? { priceOverrides: overrides } : {}),
    },
    timeoutMs: 40_000,
  });
}

export async function pauseBundle(bundleId: string, requestedDate: string): Promise<void> {
  await ok("PUT", `/bundles/${bundleId}/pause`, { query: { requestedDate } });
}

export async function resumeBundle(bundleId: string, requestedDate?: string): Promise<void> {
  await ok("PUT", `/bundles/${bundleId}/resume`, { query: requestedDate ? { requestedDate } : {} });
}

export async function cancelAtPeriodEnd(subscriptionId: string): Promise<void> {
  await ok("DELETE", `/subscriptions/${subscriptionId}`, {
    query: { entitlementPolicy: "END_OF_TERM", billingPolicy: "END_OF_TERM", callCompletion: "true" },
  });
}

export async function cancelNow(subscriptionId: string): Promise<void> {
  const current = (await ok("GET", `/subscriptions/${subscriptionId}`)).json as KbSubscription;
  if (current.state === "CANCELLED") return;
  await ok("DELETE", `/subscriptions/${subscriptionId}`, {
    query: { entitlementPolicy: "IMMEDIATE", billingPolicy: "IMMEDIATE", callCompletion: "true" },
  });
}

// ---- custom fields: the failed renewal attempts live on the subscription

const FAILED_FIELD = "pampero_failed_attempts";

interface KbField {
  customFieldId: string;
  name: string;
  value: string;
}

async function fields(subscriptionId: string): Promise<KbField[]> {
  return (await ok("GET", `/subscriptions/${subscriptionId}/customFields`)).json as KbField[];
}

export async function failedAttempts(subscriptionId: string): Promise<number> {
  const field = (await fields(subscriptionId)).find((f) => f.name === FAILED_FIELD);
  return field ? Number(field.value) : 0;
}

export async function setFailedAttempts(subscriptionId: string, count: number): Promise<void> {
  const existing = (await fields(subscriptionId)).filter((f) => f.name === FAILED_FIELD);
  if (existing.length) {
    await ok("DELETE", `/subscriptions/${subscriptionId}/customFields`, {
      query: { customField: existing.map((f) => f.customFieldId).join(",") },
    });
  }
  if (count > 0) {
    await ok("POST", `/subscriptions/${subscriptionId}/customFields`, { body: [{ name: FAILED_FIELD, value: String(count) }] });
  }
}
