import { config } from "./config.js";
import { ProviderDown } from "./errors.js";

const kb = config.killbill;
const AUTH = "Basic " + Buffer.from(`${kb.username}:${kb.password}`).toString("base64");

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
    "X-Killbill-CreatedBy": "plumtide-venue",
    Accept: "application/json",
  };
  const init: RequestInit = { method, headers, signal: AbortSignal.timeout(20000) };
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
  if (response.status >= 500) throw new ProviderDown("killbill", `${method} ${path} HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return response;
}

async function ok(response: Response, what: string): Promise<Response> {
  if (!response.ok) throw new Error(`Kill Bill ${what}: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
  return response;
}

async function getJson<T>(path: string, query?: Record<string, string>): Promise<T | null> {
  const response = await call(path, query ? { query } : {});
  if (response.status === 404) return null;
  return (await (await ok(response, `GET ${path}`)).json()) as T;
}

/** Kill Bill speaks decimal dollars; the app speaks integer cents, read from the amount's two-decimal digits. */
export function toCents(amount: number): number {
  const [whole, fraction] = Math.abs(amount).toFixed(2).split(".");
  return (amount < 0 ? -1 : 1) * (Number(whole) * 100 + Number(fraction));
}
const toDollars = (cents: number): string => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

export async function reachable(): Promise<boolean> {
  try {
    const response = await fetch(`${kb.url}/1.0/healthcheck`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

// ---- catalog and overdue configuration ----

const PLAN_XML = (name: string, price: string) => `
    <plan name="${name}">
      <product>BuilderApi</product>
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
  <catalogName>PlumtideVenue</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies><currency>USD</currency></currencies>
  <products>
    <product name="BuilderApi"><category>BASE</category></product>
  </products>
  <rules>
    <changePolicy>
      <changePolicyCase><policy>IMMEDIATE</policy></changePolicyCase>
    </changePolicy>
    <changeAlignment>
      <changeAlignmentCase><alignment>START_OF_BUNDLE</alignment></changeAlignmentCase>
    </changeAlignment>
    <cancelPolicy>
      <cancelPolicyCase><policy>END_OF_TERM</policy></cancelPolicyCase>
    </cancelPolicy>
    <createAlignment>
      <createAlignmentCase><alignment>START_OF_BUNDLE</alignment></createAlignmentCase>
    </createAlignment>
    <billingAlignment>
      <billingAlignmentCase><alignment>ACCOUNT</alignment></billingAlignmentCase>
    </billingAlignment>
    <priceList>
      <priceListCase><toPriceList>DEFAULT</toPriceList></priceListCase>
    </priceList>
  </rules>
  <plans>${PLAN_XML("sandbox-monthly", "0.00")}${PLAN_XML("builder-monthly", "49.00")}${PLAN_XML("desk-monthly", "249.00")}
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT">
      <plans><plan>sandbox-monthly</plan><plan>builder-monthly</plan><plan>desk-monthly</plan></plans>
    </defaultPriceList>
  </priceLists>
</catalog>`;

const OVERDUE_STATE = (name: string, unpaid: number, blockChanges: boolean) => `
    <state name="${name}">
      <condition><numberOfUnpaidInvoicesEqualsOrExceeds>${unpaid}</numberOfUnpaidInvoicesEqualsOrExceeds></condition>
      <externalMessage>${name}</externalMessage>
      <blockChanges>${blockChanges}</blockChanges>
      <disableEntitlementAndChangesBlocked>false</disableEntitlementAndChangesBlocked>
      <autoReevaluationInterval><unit>DAYS</unit><number>1</number></autoReevaluationInterval>
    </state>`;

const OVERDUE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<overdueConfig>
  <accountOverdueStates>
    <initialReevaluationInterval><unit>DAYS</unit><number>1</number></initialReevaluationInterval>${OVERDUE_STATE("DOWNGRADED", 2, true)}${OVERDUE_STATE("WARNING", 1, false)}
  </accountOverdueStates>
</overdueConfig>`;

interface CatalogJson {
  products?: { name: string }[];
}

export async function ensureCatalog(): Promise<void> {
  const catalogs = (await getJson<CatalogJson[]>("/catalog")) ?? [];
  if (catalogs.some((catalog) => (catalog.products ?? []).some((product) => product.name === "BuilderApi"))) return;
  await ok(await call("/catalog/xml", { method: "POST", xml: CATALOG_XML }), "upload catalog");
}

interface OverdueJson {
  overdueStates?: { name: string }[];
}

/** A tenant without a configuration reports only Kill Bill's default clear state. */
export async function ensureOverdueConfig(): Promise<void> {
  const names = ((await getJson<OverdueJson>("/overdue"))?.overdueStates ?? []).map((state) => state.name);
  if (names.includes("WARNING") && names.includes("DOWNGRADED")) return;
  await ok(await call("/overdue/xml", { method: "POST", xml: OVERDUE_XML }), "upload overdue config");
}

// ---- accounts and payments ----

interface AccountJson {
  accountId: string;
  paymentMethodId?: string | null;
}

export async function accountIdByKey(externalKey: string): Promise<string | null> {
  return (await getJson<AccountJson>("/accounts", { externalKey }))?.accountId ?? null;
}

export async function ensureAccount(externalKey: string, name: string, email: string): Promise<string> {
  let account = await getJson<AccountJson>("/accounts", { externalKey });
  if (!account) {
    const created = await call("/accounts", { method: "POST", body: { name, email, externalKey, currency: "USD" } });
    if (created.status !== 201 && created.status !== 409) await ok(created, "create account");
    account = await getJson<AccountJson>("/accounts", { externalKey });
    if (!account) throw new Error("Kill Bill account missing after create");
  }
  if (!account.paymentMethodId) {
    const method = await call(`/accounts/${account.accountId}/paymentMethods`, {
      method: "POST",
      query: { isDefault: "true" },
      body: { pluginName: "__EXTERNAL_PAYMENT__", pluginInfo: { properties: [] } },
    });
    await ok(method, "add payment method");
  }
  return account.accountId;
}

interface TransactionJson {
  transactionId: string;
  transactionExternalKey: string;
  transactionType: string;
  status: string;
}

interface PaymentJson {
  paymentId: string;
  transactions: TransactionJson[];
}

/** A PURCHASE on the member's own account; returns the payment id and whether it succeeded. */
export async function purchase(accountId: string, depositId: string, cents: number, last4: string): Promise<{ paymentId: string | null; success: boolean }> {
  const key = `deposit-${depositId}`;
  let payment = await getJson<PaymentJson>("/payments", { externalKey: key });
  if (!payment) {
    const response = await call(`/accounts/${accountId}/payments`, {
      method: "POST",
      query: { pluginProperty: `card_last4=${last4}` },
      body: { transactionType: "PURCHASE", amount: toDollars(cents), currency: "USD", paymentExternalKey: key, transactionExternalKey: key },
    });
    if (response.status !== 201 && response.status !== 402 && response.status !== 422) await ok(response, "purchase");
    payment = await getJson<PaymentJson>("/payments", { externalKey: key });
  }
  const tx = payment?.transactions.find((t) => t.transactionExternalKey === key);
  return { paymentId: payment?.paymentId ?? null, success: tx?.status === "SUCCESS" };
}

export async function refund(paymentId: string, refundId: string, cents: number): Promise<{ transactionId: string | null; success: boolean }> {
  const key = `refund-${refundId}`;
  const response = await call(`/payments/${paymentId}/refunds`, {
    method: "POST",
    body: { amount: toDollars(cents), currency: "USD", transactionExternalKey: key },
  });
  if (response.status !== 201 && response.status !== 402 && response.status !== 422) await ok(response, "refund");
  const payment = await getJson<PaymentJson>(`/payments/${paymentId}`);
  const tx = payment?.transactions.find((t) => t.transactionExternalKey === key);
  return { transactionId: tx?.transactionId ?? null, success: tx?.status === "SUCCESS" };
}

// ---- builder plan subscriptions ----

interface SubscriptionJson {
  subscriptionId: string;
  bundleExternalKey: string;
  planName: string;
  state: string;
  chargedThroughDate?: string | null;
  events?: { eventType: string; effectiveDate: string; plan?: string | null }[];
}

interface BundleJson {
  externalKey: string;
  subscriptions: SubscriptionJson[];
}

export async function planSubscription(accountId: string, bundleKey: string): Promise<SubscriptionJson | null> {
  const bundles = (await getJson<BundleJson[]>(`/accounts/${accountId}/bundles`)) ?? [];
  for (const bundle of bundles) {
    const active = bundle.subscriptions.find((s) => s.bundleExternalKey === bundleKey && s.state === "ACTIVE");
    if (active) return active;
  }
  return null;
}

export async function createSubscription(accountId: string, bundleKey: string, planName: string): Promise<void> {
  const response = await call("/subscriptions", {
    method: "POST",
    query: { callCompletion: "true", callTimeoutSec: "10" },
    body: { accountId, bundleExternalKey: bundleKey, planName },
  });
  await ok(response, "create subscription");
}

export async function changeSubscription(subscriptionId: string, planName: string, policy: "IMMEDIATE" | "END_OF_TERM"): Promise<void> {
  const response = await call(`/subscriptions/${subscriptionId}`, {
    method: "PUT",
    query: { callCompletion: "true", callTimeoutSec: "10", billingPolicy: policy },
    body: { planName },
  });
  await ok(response, "change subscription");
}

export async function overdueState(accountId: string): Promise<string> {
  const state = await getJson<{ name: string }>(`/accounts/${accountId}/overdue`);
  return state?.name ?? "__KILLBILL__CLEAR__OVERDUE_STATE__";
}

interface InvoiceJson {
  invoiceId: string;
  invoiceNumber: string | number;
  invoiceDate: string;
  amount: number;
  balance: number;
  items?: { description?: string | null; amount: number; startDate?: string | null; endDate?: string | null }[];
}

export async function invoices(accountId: string): Promise<InvoiceJson[]> {
  return (await getJson<InvoiceJson[]>(`/accounts/${accountId}/invoices`, { includeInvoiceComponents: "true" })) ?? [];
}

/** Pays every unpaid invoice with the account's default payment method. */
export async function payAll(accountId: string, cents: number): Promise<void> {
  const response = await call(`/accounts/${accountId}/invoicePayments`, {
    method: "POST",
    query: { externalPayment: "false", paymentAmount: toDollars(cents) },
  });
  await ok(response, "pay invoices");
}
