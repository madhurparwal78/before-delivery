import { createHmac } from "node:crypto";
import { PLANS } from "../shared/rules.js";
import { config } from "./config.js";
import { ProviderDown } from "./errors.js";

const kb = config.killbill;
const AUTH = "Basic " + Buffer.from(`${kb.username}:${kb.password}`).toString("base64");

/** The push-notification token: lowercase hex HMAC-SHA256 of the API key, keyed with the API secret. */
export const CALLBACK_TOKEN = createHmac("sha256", kb.apiSecret).update(kb.apiKey).digest("hex");

interface Call {
  method?: string;
  query?: Record<string, string>;
  body?: unknown;
  xml?: string;
}

async function call(path: string, { method = "GET", query, body, xml }: Call = {}): Promise<Response> {
  const url = new URL(`${kb.url}/1.0/kb${path}`);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.append(key, value);
  const headers: Record<string, string> = {
    Authorization: AUTH,
    "X-Killbill-ApiKey": kb.apiKey,
    "X-Killbill-ApiSecret": kb.apiSecret,
    "X-Killbill-CreatedBy": "phosphene-yard",
    Accept: "application/json",
  };
  const init: RequestInit = { method, headers, signal: AbortSignal.timeout(20_000) };
  if (xml !== undefined) {
    headers["Content-Type"] = "text/xml";
    init.body = xml;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new ProviderDown("killbill", error instanceof Error ? error.message : String(error));
  }
  if (response.status >= 500) throw new ProviderDown("killbill", `${method} ${path} HTTP ${response.status}`);
  return response;
}

async function expectOk(response: Response, what: string): Promise<Response> {
  if (!response.ok) throw new ProviderDown("killbill", `${what}: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
  return response;
}

async function getJson<T>(path: string, query?: Record<string, string>): Promise<T | null> {
  const response = await call(path, query ? { query } : {});
  if (response.status === 404) return null;
  return (await (await expectOk(response, `GET ${path}`)).json()) as T;
}

/** Kill Bill speaks decimal dollars; the app speaks integer cents read from the two-decimal string. */
function toCents(amount: number): number {
  const [whole, fraction] = Math.abs(amount).toFixed(2).split(".");
  return (amount < 0 ? -1 : 1) * (Number(whole) * 100 + Number(fraction));
}
const toDollars = (cents: number): string => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

export async function reachable(): Promise<boolean> {
  try {
    await fetch(`${kb.url}/1.0/healthcheck`, { signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
}

// ---- tenant setup: catalog and callback ----

const PLAN_XML = (name: string, product: string, price: string) => `
    <plan name="${name}">
      <product>${product}</product>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice><price><currency>USD</currency><value>${price}</value></price></recurringPrice>
        </recurring>
      </finalPhase>
    </plan>`;

const CATALOG_XML = `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>2020-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>PhospheneYard</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies><currency>USD</currency></currencies>
  <products>
    <product name="Studio"><category>BASE</category></product>
    <product name="Pro"><category>BASE</category></product>
  </products>
  <rules>
    <changePolicy><changePolicyCase><policy>IMMEDIATE</policy></changePolicyCase></changePolicy>
    <cancelPolicy><cancelPolicyCase><policy>END_OF_TERM</policy></cancelPolicyCase></cancelPolicy>
    <billingAlignment><billingAlignmentCase><alignment>ACCOUNT</alignment></billingAlignmentCase></billingAlignment>
    <priceList><priceListCase><toPriceList>DEFAULT</toPriceList></priceListCase></priceList>
  </rules>
  <plans>${Object.entries(PLANS).map(([code, plan]) => PLAN_XML(code, plan.name, toDollars(plan.priceCents))).join("")}
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT">
      <plans><plan>studio-monthly</plan><plan>pro-monthly</plan></plans>
    </defaultPriceList>
  </priceLists>
</catalog>`;

async function hasCatalog(): Promise<boolean> {
  const catalogs = (await getJson<{ products?: { name: string }[] }[]>("/catalog")) ?? [];
  return catalogs.some((catalog) => (catalog.products ?? []).some((product) => product.name === "Studio"));
}

/** Uploads the catalog when the tenant has none; a concurrent instance's identical upload is refused by Kill Bill. */
export async function ensureCatalog(): Promise<void> {
  if (await hasCatalog()) return;
  const response = await call("/catalog/xml", { method: "POST", xml: CATALOG_XML });
  if (!response.ok && !(await hasCatalog())) await expectOk(response, "upload catalog");
}

export async function registerCallback(): Promise<void> {
  const cb = `${config.publicUrl}/api/billing/killbill-events?token=${CALLBACK_TOKEN}`;
  await expectOk(await call("/tenants/registerNotificationCallback", { method: "POST", query: { cb } }), "register callback");
}

// ---- accounts, charges, payments ----

interface AccountJson {
  accountId: string;
  paymentMethodId?: string | null;
}

/** One account per person, keyed by their Keycloak user id, with the external payment method as default. */
export async function ensureAccount(externalKey: string, name: string, email: string): Promise<string> {
  let account = await getJson<AccountJson>("/accounts", { externalKey });
  if (!account) {
    const created = await call("/accounts", {
      method: "POST",
      body: { name, email, externalKey, currency: "USD", timeZone: "UTC", billCycleDayLocal: 1 },
    });
    if (created.status !== 201 && created.status !== 409) await expectOk(created, "create account");
    account = await getJson<AccountJson>("/accounts", { externalKey });
    if (!account) throw new ProviderDown("killbill", "account missing after create");
  }
  if (!account.paymentMethodId) {
    await expectOk(
      await call(`/accounts/${account.accountId}/paymentMethods`, {
        method: "POST",
        query: { isDefault: "true" },
        body: { pluginName: "__EXTERNAL_PAYMENT__" },
      }),
      "add payment method",
    );
  }
  return account.accountId;
}

/** An external charge on the account; Kill Bill pays it with the default external payment method. Returns the invoice id. */
export async function externalCharge(accountId: string, cents: number, description: string): Promise<string> {
  const response = await expectOk(
    await call(`/invoices/charges/${accountId}`, {
      method: "POST",
      query: { autoCommit: "true" },
      body: [{ accountId, amount: toDollars(cents), currency: "USD", description }],
    }),
    "external charge",
  );
  const items = (await response.json()) as { invoiceId?: string }[];
  const invoiceId = items[0]?.invoiceId;
  if (!invoiceId) throw new ProviderDown("killbill", "charge returned no invoice");
  return invoiceId;
}

interface TransactionJson {
  transactionType: string;
  status: string;
  amount: number;
  transactionExternalKey?: string;
}

interface InvoicePaymentJson {
  paymentId: string;
  transactions: TransactionJson[];
}

interface InvoiceJson {
  invoiceId: string;
  amount: number;
  items?: { subscriptionId?: string | null }[];
}

export type PaymentOutcome = { kind: "paid"; paymentId: string } | { kind: "failed" } | { kind: "none" };

/**
 * What Kill Bill shows for an invoice: paid when successful purchases cover its full amount,
 * failed when a purchase failed and none succeeded, otherwise nothing yet.
 */
export async function invoiceOutcome(invoiceId: string): Promise<PaymentOutcome> {
  const invoice = await getJson<InvoiceJson>(`/invoices/${invoiceId}`);
  if (!invoice) return { kind: "none" };
  const payments = (await getJson<InvoicePaymentJson[]>(`/invoices/${invoiceId}/payments`)) ?? [];
  let paid = 0;
  let failed = false;
  let paymentId: string | null = null;
  for (const payment of payments) {
    for (const transaction of payment.transactions) {
      if (transaction.transactionType !== "PURCHASE") continue;
      if (transaction.status === "SUCCESS") {
        paid += toCents(transaction.amount);
        paymentId ??= payment.paymentId;
      } else if (transaction.status !== "PENDING" && transaction.status !== "UNKNOWN") failed = true;
    }
  }
  const amount = toCents(invoice.amount);
  if (paymentId && amount > 0 && paid >= amount) return { kind: "paid", paymentId };
  if (failed && paid === 0) return { kind: "failed" };
  return { kind: "none" };
}

/** Invoices of the account that carry an item of the subscription. */
export async function subscriptionInvoices(accountId: string, subscriptionId: string): Promise<string[]> {
  const invoices = (await getJson<InvoiceJson[]>(`/accounts/${accountId}/invoices`, { includeInvoiceComponents: "true" })) ?? [];
  return invoices.filter((invoice) => (invoice.items ?? []).some((item) => item.subscriptionId === subscriptionId)).map((invoice) => invoice.invoiceId);
}

export async function invoiceSubscriptionIds(invoiceId: string): Promise<string[]> {
  const invoice = await getJson<InvoiceJson>(`/invoices/${invoiceId}`, { withItems: "true" });
  return (invoice?.items ?? []).flatMap((item) => (item.subscriptionId ? [item.subscriptionId] : []));
}

/** Refunds part of a payment; true only when Kill Bill reports the refund transaction as successful. */
export async function refund(paymentId: string, refundId: string, cents: number): Promise<boolean> {
  const key = `refund-${refundId}`;
  const response = await call(`/payments/${paymentId}/refunds`, {
    method: "POST",
    body: { amount: toDollars(cents), currency: "USD", transactionExternalKey: key },
  });
  if (response.status !== 201 && response.status !== 402 && response.status !== 422) await expectOk(response, "refund");
  const payment = await getJson<InvoicePaymentJson>(`/payments/${paymentId}`);
  return payment?.transactions.some((t) => t.transactionExternalKey === key && t.status === "SUCCESS") ?? false;
}

// ---- plans ----

export async function createSubscription(accountId: string, planName: string): Promise<string> {
  const response = await expectOk(
    await call("/subscriptions", {
      method: "POST",
      query: { callCompletion: "true", callTimeoutSec: "10" },
      body: { accountId, planName },
    }),
    "create subscription",
  );
  const location = response.headers.get("location") ?? "";
  const id = location.slice(location.lastIndexOf("/") + 1);
  if (!id) throw new ProviderDown("killbill", "subscription created without a location");
  return id;
}

/** Cancels at end of term and returns the billing end date Kill Bill then reports (YYYY-MM-DD). */
export async function cancelEndOfTerm(subscriptionId: string): Promise<string> {
  await expectOk(
    await call(`/subscriptions/${subscriptionId}`, {
      method: "DELETE",
      query: { entitlementPolicy: "END_OF_TERM", billingPolicy: "END_OF_TERM", callCompletion: "true", callTimeoutSec: "10" },
    }),
    "cancel subscription",
  );
  const subscription = await getJson<{ billingEndDate?: string | null; chargedThroughDate?: string | null }>(`/subscriptions/${subscriptionId}`);
  const end = subscription?.billingEndDate ?? subscription?.chargedThroughDate;
  if (!end) throw new ProviderDown("killbill", "cancelled subscription has no billing end date");
  return end.slice(0, 10);
}
