import { config } from "../config.js";
import { ApiError, errors } from "../errors.js";
import { type Currency, type Money, fromServiceNumber, toAmountString } from "../../shared/money.js";
import { type CareTier } from "../../shared/plans.js";

const AUTO_PAY_OFF_TAG = "00000000-0000-0000-0000-000000000001";
const EXTERNAL_PAYMENT_PLUGIN = "__EXTERNAL_PAYMENT__";

export interface KbInvoiceItem {
  itemType: string;
  description: string;
  amount: Money;
  startDate: string | null;
  endDate: string | null;
  planName: string | null;
  subscriptionId: string | null;
  bundleId: string | null;
}

export interface KbInvoice {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  amount: Money;
  balance: Money;
  currency: Currency;
  status: string;
  items: KbInvoiceItem[];
}

export interface KbSubscriptionEvent {
  eventType: string;
  effectiveDate: string;
}

export interface KbSubscription {
  subscriptionId: string;
  bundleId: string;
  productName: string;
  planName: string;
  state: string;
  startDate: string;
  chargedThroughDate: string | null;
  billingEndDate: string | null;
  cancelledDate: string | null;
  events: KbSubscriptionEvent[];
}

export interface KbPaymentTransaction {
  transactionType: string;
  amount: Money;
  status: string;
  transactionExternalKey: string;
  transactionId: string;
}

export interface KbPayment {
  paymentId: string;
  paymentExternalKey: string;
  authAmount: Money;
  capturedAmount: Money;
  purchasedAmount: Money;
  refundedAmount: Money;
  currency: Currency;
  transactions: KbPaymentTransaction[];
}

interface KbResponse {
  status: number;
  location: string | null;
  body: unknown;
}

function authHeaders(): Record<string, string> {
  const basic = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64");
  return {
    Authorization: `Basic ${basic}`,
    "X-Killbill-ApiKey": config.killbill.apiKey,
    "X-Killbill-ApiSecret": config.killbill.apiSecret,
    "X-Killbill-CreatedBy": "pampero-ledger",
    Accept: "application/json",
  };
}

async function request(
  method: string,
  path: string,
  body?: unknown,
  options: { contentType?: string; timeoutMs?: number } = {},
): Promise<KbResponse> {
  const headers = authHeaders();
  let payload: string | undefined;
  if (body !== undefined) {
    headers["Content-Type"] = options.contentType ?? "application/json";
    payload = options.contentType ? String(body) : JSON.stringify(body);
  }
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}${path}`, {
      method,
      headers,
      body: payload,
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    });
  } catch {
    throw errors.billingUnavailable();
  }
  if (response.status >= 500) {
    await response.text().catch(() => "");
    throw errors.billingUnavailable();
  }
  const text = await response.text();
  if (response.status >= 400) {
    throw new Error(`kill bill ${method} ${path} answered ${response.status}: ${text.slice(0, 400)}`);
  }
  let parsed: unknown = null;
  if (text.trim().length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: response.status, location: response.headers.get("location"), body: parsed };
}

function idFromLocation(response: KbResponse): string {
  const location = response.location;
  if (!location) throw new Error("kill bill answered without a Location header");
  const parts = location.replace(/\/+$/, "").split("/");
  const id = parts[parts.length - 1];
  if (!id) throw new Error("kill bill answered with an unusable Location header");
  return id;
}

export async function reachable(): Promise<boolean> {
  try {
    const response = await fetch(`${config.killbill.url}/1.0/healthcheck`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const CARE_PRODUCTS: Record<CareTier, { product: string; plan: string }> = {
  lite: { product: "care-lite", plan: "care-lite-monthly" },
  plus: { product: "care-plus", plan: "care-plus-monthly" },
};

const CATALOG_XML = `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>2026-01-01T00:00:00Z</effectiveDate>
  <catalogName>PamperoBuildCo</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies>
    <currency>USD</currency>
    <currency>ARS</currency>
  </currencies>
  <products>
    <product name="care-lite"><category>BASE</category></product>
    <product name="care-plus"><category>BASE</category></product>
  </products>
  <rules>
    <changePolicy><changePolicyCase><policy>IMMEDIATE</policy></changePolicyCase></changePolicy>
    <changeAlignment><changeAlignmentCase><alignment>START_OF_BUNDLE</alignment></changeAlignmentCase></changeAlignment>
    <cancelPolicy><cancelPolicyCase><policy>END_OF_TERM</policy></cancelPolicyCase></cancelPolicy>
    <createAlignment><createAlignmentCase><alignment>START_OF_BUNDLE</alignment></createAlignmentCase></createAlignment>
    <billingAlignment><billingAlignmentCase><alignment>SUBSCRIPTION</alignment></billingAlignmentCase></billingAlignment>
    <priceList><priceListCase><toPriceList>DEFAULT</toPriceList></priceListCase></priceList>
  </rules>
  <plans>
    <plan name="care-lite-monthly">
      <product>care-lite</product>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice>
            <price><currency>USD</currency><value>149.00</value></price>
            <price><currency>ARS</currency><value>189999.99</value></price>
          </recurringPrice>
        </recurring>
      </finalPhase>
    </plan>
    <plan name="care-plus-monthly">
      <product>care-plus</product>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice>
            <price><currency>USD</currency><value>349.00</value></price>
            <price><currency>ARS</currency><value>449999.99</value></price>
          </recurringPrice>
        </recurring>
      </finalPhase>
    </plan>
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT">
      <plans>
        <plan>care-lite-monthly</plan>
        <plan>care-plus-monthly</plan>
      </plans>
    </defaultPriceList>
  </priceLists>
</catalog>`;

export async function ensureCatalog(): Promise<void> {
  const current = await request("GET", "/1.0/kb/catalog");
  const versions = Array.isArray(current.body) ? current.body : [];
  if (versions.length > 0) return;
  await request("POST", "/1.0/kb/catalog/xml", CATALOG_XML, { contentType: "text/xml" });
}

export async function findAccountByExternalKey(externalKey: string): Promise<string | null> {
  try {
    const response = await request("GET", `/1.0/kb/accounts?externalKey=${encodeURIComponent(externalKey)}`);
    const account = response.body as { accountId?: string } | null;
    return account?.accountId ?? null;
  } catch {
    return null;
  }
}

export async function createAccount(input: {
  externalKey: string;
  name: string;
  email: string;
  currency: Currency;
}): Promise<string> {
  const existing = await findAccountByExternalKey(input.externalKey);
  if (existing) return existing;
  let created: KbResponse;
  try {
    created = await request("POST", "/1.0/kb/accounts", {
      name: input.name,
      email: input.email,
      currency: input.currency,
      externalKey: input.externalKey,
      timeZone: "America/Argentina/Buenos_Aires",
    });
  } catch (error) {
    // Another request for the same client account may have won the race.
    const raced = await findAccountByExternalKey(input.externalKey);
    if (raced) return raced;
    throw error;
  }
  const accountId = idFromLocation(created);
  await request("POST", `/1.0/kb/accounts/${accountId}/paymentMethods?isDefault=true`, {
    pluginName: EXTERNAL_PAYMENT_PLUGIN,
    pluginInfo: {},
  });
  await request("POST", `/1.0/kb/accounts/${accountId}/tags`, [AUTO_PAY_OFF_TAG]);
  return accountId;
}

export async function accountCredit(accountId: string, currency: Currency): Promise<Money> {
  const response = await request("GET", `/1.0/kb/accounts/${accountId}?accountWithBalanceAndCBA=true`);
  const account = response.body as { accountCBA?: number } | null;
  return fromServiceNumber(currency, account?.accountCBA ?? 0);
}

function parseItem(raw: Record<string, unknown>, currency: Currency): KbInvoiceItem {
  return {
    itemType: String(raw.itemType ?? ""),
    description: String(raw.description ?? ""),
    amount: fromServiceNumber(currency, Number(raw.amount ?? 0)),
    startDate: (raw.startDate as string | null) ?? null,
    endDate: (raw.endDate as string | null) ?? null,
    planName: (raw.planName as string | null) ?? null,
    subscriptionId: (raw.subscriptionId as string | null) ?? null,
    bundleId: (raw.bundleId as string | null) ?? null,
  };
}

function parseInvoice(raw: Record<string, unknown>): KbInvoice {
  const currency = String(raw.currency ?? "USD") as Currency;
  const items = Array.isArray(raw.items) ? (raw.items as Record<string, unknown>[]) : [];
  return {
    invoiceId: String(raw.invoiceId ?? ""),
    invoiceNumber: String(raw.invoiceNumber ?? ""),
    invoiceDate: String(raw.invoiceDate ?? ""),
    amount: fromServiceNumber(currency, Number(raw.amount ?? 0)),
    balance: fromServiceNumber(currency, Number(raw.balance ?? 0)),
    currency,
    status: String(raw.status ?? ""),
    items: items.map((item) => parseItem(item, currency)),
  };
}

export async function listInvoices(accountId: string): Promise<KbInvoice[]> {
  const response = await request(
    "GET",
    `/1.0/kb/accounts/${accountId}/invoices?withItems=true&includeInvoiceComponents=true&includeVoidedInvoices=true`,
  );
  const raw = Array.isArray(response.body) ? (response.body as Record<string, unknown>[]) : [];
  return raw.map(parseInvoice);
}

export async function getInvoice(invoiceId: string): Promise<KbInvoice> {
  const response = await request("GET", `/1.0/kb/invoices/${invoiceId}?withItems=true`);
  return parseInvoice((response.body ?? {}) as Record<string, unknown>);
}

export async function createExternalCharge(
  accountId: string,
  amount: Money,
  description: string,
): Promise<string> {
  const response = await request("POST", `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`, [
    {
      accountId,
      amount: toAmountString(amount),
      currency: amount.currency,
      description,
    },
  ]);
  const items = Array.isArray(response.body) ? (response.body as Record<string, unknown>[]) : [];
  const invoiceId = items[0]?.invoiceId;
  if (typeof invoiceId !== "string") throw new Error("kill bill created no invoice for the external charge");
  return invoiceId;
}

export async function voidInvoice(invoiceId: string): Promise<void> {
  await request("DELETE", `/1.0/kb/invoices/${invoiceId}`);
}

export async function authorize(
  accountId: string,
  amount: Money,
  paymentExternalKey: string,
): Promise<string> {
  const response = await request("POST", `/1.0/kb/accounts/${accountId}/payments`, {
    transactionType: "AUTHORIZE",
    amount: toAmountString(amount),
    currency: amount.currency,
    paymentExternalKey,
    transactionExternalKey: `${paymentExternalKey}-auth`,
  });
  return idFromLocation(response);
}

export async function capture(paymentId: string, amount: Money, paymentExternalKey: string): Promise<void> {
  await request("POST", `/1.0/kb/payments/${paymentId}`, {
    paymentId,
    transactionType: "CAPTURE",
    amount: toAmountString(amount),
    currency: amount.currency,
    transactionExternalKey: `${paymentExternalKey}-capture`,
  });
}

export async function voidPayment(paymentId: string, paymentExternalKey: string): Promise<void> {
  await request("DELETE", `/1.0/kb/payments/${paymentId}`, {
    paymentId,
    transactionType: "VOID",
    transactionExternalKey: `${paymentExternalKey}-void`,
  });
}

/** Records the external invoice payment that brings a captured invoice to a zero balance. */
export async function settleInvoice(
  accountId: string,
  invoiceId: string,
  amount: Money,
  paymentExternalKey: string,
): Promise<void> {
  await request("POST", `/1.0/kb/invoices/${invoiceId}/payments?externalPayment=true`, {
    accountId,
    targetInvoiceId: invoiceId,
    purchasedAmount: toAmountString(amount),
    currency: amount.currency,
    paymentExternalKey,
  });
}

function parsePayment(raw: Record<string, unknown>): KbPayment {
  const currency = String(raw.currency ?? "USD") as Currency;
  const transactions = Array.isArray(raw.transactions) ? (raw.transactions as Record<string, unknown>[]) : [];
  return {
    paymentId: String(raw.paymentId ?? ""),
    paymentExternalKey: String(raw.paymentExternalKey ?? ""),
    authAmount: fromServiceNumber(currency, Number(raw.authAmount ?? 0)),
    capturedAmount: fromServiceNumber(currency, Number(raw.capturedAmount ?? 0)),
    purchasedAmount: fromServiceNumber(currency, Number(raw.purchasedAmount ?? 0)),
    refundedAmount: fromServiceNumber(currency, Number(raw.refundedAmount ?? 0)),
    currency,
    transactions: transactions.map((transaction) => ({
      transactionType: String(transaction.transactionType ?? ""),
      amount: fromServiceNumber(currency, Number(transaction.amount ?? 0)),
      status: String(transaction.status ?? ""),
      transactionExternalKey: String(transaction.transactionExternalKey ?? ""),
      transactionId: String(transaction.transactionId ?? ""),
    })),
  };
}

async function paymentByExternalKey(externalKey: string): Promise<KbPayment | null> {
  try {
    const response = await request("GET", `/1.0/kb/payments?externalKey=${encodeURIComponent(externalKey)}`);
    if (!response.body) return null;
    return parsePayment(response.body as Record<string, unknown>);
  } catch (error) {
    if (error instanceof Error && !(error instanceof ApiError)) return null;
    throw error;
  }
}

/**
 * The published key for a Pay, unless an earlier attempt on this order already voided a payment
 * under it; Kill Bill keeps payment external keys for good.
 */
export async function freePaymentExternalKey(base: string): Promise<string> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const key = attempt === 0 ? base : `${base}-retry${attempt}`;
    if (!(await paymentByExternalKey(key))) return key;
  }
  throw errors.billingUnavailable();
}

export async function getPayment(paymentId: string): Promise<KbPayment> {
  const response = await request("GET", `/1.0/kb/payments/${paymentId}`);
  return parsePayment((response.body ?? {}) as Record<string, unknown>);
}

export async function refundPayment(
  paymentId: string,
  amount: Money,
  transactionExternalKey: string,
): Promise<string> {
  await request("POST", `/1.0/kb/payments/${paymentId}/refunds`, {
    paymentId,
    amount: toAmountString(amount),
    currency: amount.currency,
    transactionExternalKey,
  });
  const payment = await getPayment(paymentId);
  const refund = payment.transactions.find(
    (transaction) =>
      transaction.transactionType === "REFUND" && transaction.transactionExternalKey === transactionExternalKey,
  );
  if (!refund) throw new Error("kill bill recorded no refund transaction");
  return refund.transactionId;
}

export async function createCredit(accountId: string, amount: Money, description: string): Promise<void> {
  await request("POST", "/1.0/kb/credits?autoCommit=true", [
    {
      accountId,
      amount: toAmountString(amount),
      currency: amount.currency,
      description,
    },
  ]);
}

function parseSubscription(raw: Record<string, unknown>): KbSubscription {
  const events = Array.isArray(raw.events) ? (raw.events as Record<string, unknown>[]) : [];
  return {
    subscriptionId: String(raw.subscriptionId ?? ""),
    bundleId: String(raw.bundleId ?? ""),
    productName: String(raw.productName ?? ""),
    planName: String(raw.planName ?? ""),
    state: String(raw.state ?? ""),
    startDate: String(raw.startDate ?? ""),
    chargedThroughDate: (raw.chargedThroughDate as string | null) ?? null,
    billingEndDate: (raw.billingEndDate as string | null) ?? null,
    cancelledDate: (raw.cancelledDate as string | null) ?? null,
    events: events.map((event) => ({
      eventType: String(event.eventType ?? ""),
      effectiveDate: String(event.effectiveDate ?? ""),
    })),
  };
}

export async function getSubscription(subscriptionId: string): Promise<KbSubscription> {
  const response = await request("GET", `/1.0/kb/subscriptions/${subscriptionId}`);
  return parseSubscription((response.body ?? {}) as Record<string, unknown>);
}

export async function addAccountTag(accountId: string, tagDefinitionId: string): Promise<void> {
  await request("POST", `/1.0/kb/accounts/${accountId}/tags`, [tagDefinitionId]);
}

export async function removeAccountTag(accountId: string, tagDefinitionId: string): Promise<void> {
  await request("DELETE", `/1.0/kb/accounts/${accountId}/tags?tagDef=${tagDefinitionId}`);
}

export async function generateInvoices(accountId: string, targetDate: string): Promise<void> {
  await request("POST", `/1.0/kb/invoices?accountId=${accountId}&targetDate=${targetDate}`, {});
}

export async function createSubscription(input: {
  accountId: string;
  bundleExternalKey: string;
  tier: CareTier;
  price: Money;
  startDate?: string;
  waitForInvoice?: boolean;
}): Promise<KbSubscription> {
  const product = CARE_PRODUCTS[input.tier];
  const dates = input.startDate ? `&entitlementDate=${input.startDate}&billingDate=${input.startDate}` : "";
  const response = await request(
    "POST",
    `/1.0/kb/subscriptions?callCompletion=true&callTimeoutSec=30${dates}`,
    {
      accountId: input.accountId,
      externalKey: input.bundleExternalKey,
      planName: product.plan,
      priceOverrides: [
        {
          planName: product.plan,
          phaseType: "EVERGREEN",
          recurringPrice: Number(toAmountString(input.price)),
        },
      ],
    },
  );
  const subscriptionId = idFromLocation(response);
  if (input.waitForInvoice === false) return getSubscription(subscriptionId);
  return waitForFirstInvoice(subscriptionId);
}

/** Answers only once Kill Bill has invoiced the first period and set a charged-through date. */
async function waitForFirstInvoice(subscriptionId: string): Promise<KbSubscription> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const subscription = await getSubscription(subscriptionId);
    if (subscription.chargedThroughDate) return subscription;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw errors.billingUnavailable();
}

export interface KbProration {
  credit: Money;
  charge: Money;
  total: Money;
  periodStart: string | null;
  periodEnd: string | null;
}

function prorationFromItems(items: KbInvoiceItem[], currency: Currency): KbProration {
  let credit = fromServiceNumber(currency, 0);
  let charge = fromServiceNumber(currency, 0);
  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  for (const item of items) {
    if (item.itemType === "REPAIR_ADJ") {
      credit = { currency, minor: credit.minor + item.amount.minor };
    } else if (item.itemType === "RECURRING") {
      charge = { currency, minor: charge.minor + item.amount.minor };
      periodStart = item.startDate;
      periodEnd = item.endDate;
    }
  }
  return { credit, charge, total: { currency, minor: credit.minor + charge.minor }, periodStart, periodEnd };
}

export async function dryRunChange(input: {
  accountId: string;
  bundleId: string;
  subscriptionId: string;
  tier: CareTier;
  price: Money;
}): Promise<KbProration> {
  const product = CARE_PRODUCTS[input.tier];
  const response = await request("POST", `/1.0/kb/invoices/dryRun?accountId=${input.accountId}`, {
    dryRunType: "SUBSCRIPTION_ACTION",
    dryRunAction: "CHANGE",
    subscriptionId: input.subscriptionId,
    bundleId: input.bundleId,
    productName: product.product,
    productCategory: "BASE",
    billingPeriod: "MONTHLY",
    priceListName: "DEFAULT",
    priceOverrides: [
      {
        planName: product.plan,
        phaseType: "EVERGREEN",
        recurringPrice: Number(toAmountString(input.price)),
      },
    ],
  });
  const invoice = parseInvoice((response.body ?? {}) as Record<string, unknown>);
  return prorationFromItems(invoice.items, input.price.currency);
}

export async function changePlan(input: {
  subscriptionId: string;
  tier: CareTier;
  price: Money;
}): Promise<void> {
  const product = CARE_PRODUCTS[input.tier];
  await request("PUT", `/1.0/kb/subscriptions/${input.subscriptionId}?callCompletion=true&callTimeoutSec=30`, {
    productName: product.product,
    billingPeriod: "MONTHLY",
    priceList: "DEFAULT",
    priceOverrides: [
      {
        planName: product.plan,
        phaseType: "EVERGREEN",
        recurringPrice: Number(toAmountString(input.price)),
      },
    ],
  });
}

export async function pauseBundle(bundleId: string, date: string): Promise<void> {
  await request("PUT", `/1.0/kb/bundles/${bundleId}/pause?requestedDate=${date}`, {});
}

export async function resumeBundle(bundleId: string, date: string): Promise<void> {
  await request("PUT", `/1.0/kb/bundles/${bundleId}/resume?requestedDate=${date}`, {});
}

export async function cancelSubscription(subscriptionId: string, immediate: boolean): Promise<void> {
  const policy = immediate ? "IMMEDIATE" : "END_OF_TERM";
  await request(
    "DELETE",
    `/1.0/kb/subscriptions/${subscriptionId}?entitlementPolicy=${policy}&billingPolicy=${policy}` +
      "&useRequestedDateForBilling=false&callCompletion=true&callTimeoutSec=30",
  );
}
