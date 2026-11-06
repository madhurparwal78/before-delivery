// Kill Bill REST client (brief: Services › Kill Bill). Bay subscriptions, workshop invoices, their
// balances and bank transfers live in Kill Bill; amounts are parsed from the response text exactly.
import { formatScaled, parseDecimal, toScaled } from "../shared/decimal.js";
import { HOUSE_TIME_ZONE } from "../shared/zurich.js";
import { config } from "./config.js";
import { ProviderDown } from "./errors.js";

const { url, username, password, apiKey, apiSecret, keyPrefix } = config.killbill;
const AUTHORIZATION = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
const AUTO_PAY_OFF = "00000000-0000-0000-0000-000000000001";

export const PLAN_PRICE_CENTIMES = {
  "bay-standard-monthly": 48000n,
  "bay-covered-lift-monthly": 69000n,
  "bay-sealed-capsule-monthly": 95000n,
} as const;
export type PlanName = keyof typeof PLAN_PRICE_CENTIMES;

type Json = null | boolean | string | Json[] | { [key: string]: Json };
type Reviver = (key: string, value: unknown, context: { source?: string }) => unknown;

/** Parses Kill Bill JSON keeping every number as its exact source text. */
function parseExact(text: string): Json {
  const parse = JSON.parse as (text: string, reviver: Reviver) => Json;
  return parse(text, (_key, value, context) => (typeof value === "number" ? (context.source ?? String(value)) : value));
}

interface KbResponse {
  status: number;
  body: Json;
  location: string | null;
}

async function kb(
  method: "GET" | "POST" | "DELETE",
  path: string,
  options: { body?: unknown; xml?: string; timeoutMs?: number } = {},
): Promise<KbResponse> {
  const headers: Record<string, string> = {
    Authorization: AUTHORIZATION,
    "X-Killbill-ApiKey": apiKey,
    "X-Killbill-ApiSecret": apiSecret,
    "X-Killbill-CreatedBy": "lacquer",
    Accept: "application/json",
  };
  let body: string | undefined;
  if (options.xml !== undefined) {
    headers["Content-Type"] = "text/xml";
    body = options.xml;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  let response: Response;
  try {
    response = await fetch(`${url}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
      signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
    });
  } catch {
    throw new ProviderDown("Kill Bill unreachable");
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new ProviderDown("Kill Bill answer cut off");
  }
  if (response.status >= 500) throw new ProviderDown(`Kill Bill ${response.status}`);
  let parsed: Json = null;
  if (text.trim() !== "" && (response.headers.get("content-type") ?? "").includes("json")) parsed = parseExact(text);
  return { status: response.status, body: parsed, location: response.headers.get("location") };
}

function expect(response: KbResponse, ok: number[], what: string): KbResponse {
  if (!ok.includes(response.status)) throw new Error(`Kill Bill ${what}: ${response.status} ${JSON.stringify(response.body)}`);
  return response;
}

function field(value: Json, name: string): Json {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value[name] ?? null) : null;
}

function text(value: Json, name: string): string | null {
  const v = field(value, name);
  return typeof v === "string" ? v : null;
}

function idFromLocation(location: string | null): string {
  const id = location?.split("?")[0]?.replace(/\/+$/, "").split("/").pop();
  if (!id) throw new Error("Kill Bill answered without a Location");
  return id;
}

/** A Kill Bill amount ("4470.7", "0") as centimes. */
function centimes(value: Json): bigint {
  const parsed = typeof value === "string" ? parseDecimal(value) : null;
  if (!parsed) return 0n;
  return toScaled(parsed, 2);
}

const rawJSON = (JSON as unknown as { rawJSON: (text: string) => unknown }).rawJSON;

/** An amount written into the request body as an exact two-decimal JSON number literal. */
function amount(centimesValue: bigint): unknown {
  return rawJSON(formatScaled(centimesValue, 2));
}

function accountKey(ownerId: string): string {
  return `${keyPrefix}owner-${ownerId}`;
}

function subscriptionKey(carId: string): string {
  return `${keyPrefix}car-${carId}`;
}

export function transferKey(transferId: string): string {
  return `${keyPrefix}transfer-${transferId}`;
}

const CATALOG = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>2020-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>lacquer-bays</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies><currency>CHF</currency></currencies>
  <units/>
  <products>
    <product name="bay-standard"><category>BASE</category></product>
    <product name="bay-covered-lift"><category>BASE</category></product>
    <product name="bay-sealed-capsule"><category>BASE</category></product>
  </products>
  <rules>
    <changePolicy><changePolicyCase><policy>IMMEDIATE</policy></changePolicyCase></changePolicy>
    <cancelPolicy><cancelPolicyCase><policy>END_OF_TERM</policy></cancelPolicyCase></cancelPolicy>
  </rules>
  <plans>
${(
  [
    ["bay-standard-monthly", "bay-standard", "480.00"],
    ["bay-covered-lift-monthly", "bay-covered-lift", "690.00"],
    ["bay-sealed-capsule-monthly", "bay-sealed-capsule", "950.00"],
  ] as const
)
  .map(
    ([plan, product, price]) => `    <plan name="${plan}">
      <product>${product}</product>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice><price><currency>CHF</currency><value>${price}</value></price></recurringPrice>
        </recurring>
      </finalPhase>
    </plan>`,
  )
  .join("\n")}
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT">
      <plans><plan>bay-standard-monthly</plan><plan>bay-covered-lift-monthly</plan><plan>bay-sealed-capsule-monthly</plan></plans>
    </defaultPriceList>
  </priceLists>
</catalog>`;

function catalogHasPlans(body: Json): boolean {
  const serialised = JSON.stringify(body);
  return Object.keys(PLAN_PRICE_CENTIMES).every((plan) => serialised.includes(`"${plan}"`));
}

/** Makes sure the tenant's catalog carries the three monthly bay plans. */
export async function ensureCatalog(): Promise<void> {
  const current = await kb("GET", "/1.0/kb/catalog");
  if (current.status === 200 && catalogHasPlans(current.body)) return;
  await kb("POST", "/1.0/kb/catalog/xml", { xml: CATALOG, timeoutMs: 20_000 });
  const after = await kb("GET", "/1.0/kb/catalog");
  if (!(after.status === 200 && catalogHasPlans(after.body))) throw new ProviderDown("catalog not yet in place");
}

/** The owner's account (external key `<prefix>owner-<id>`), created when first needed. */
export async function ensureAccount(owner: { id: string; name: string; email: string }): Promise<string> {
  const path = `/1.0/kb/accounts?externalKey=${encodeURIComponent(accountKey(owner.id))}`;
  const existing = await kb("GET", path);
  if (existing.status === 200) return text(existing.body, "accountId") ?? "";
  const created = await kb("POST", "/1.0/kb/accounts", {
    body: {
      name: owner.name,
      email: owner.email,
      externalKey: accountKey(owner.id),
      currency: "CHF",
      timeZone: HOUSE_TIME_ZONE,
    },
  });
  const accountId = created.status === 201 ? idFromLocation(created.location) : text(expect(await kb("GET", path), [200], "account").body, "accountId");
  if (!accountId) throw new Error("Kill Bill answered an account with no id");
  if (created.status === 201) {
    expect(await kb("POST", `/1.0/kb/accounts/${accountId}/tags`, { body: [AUTO_PAY_OFF] }), [201, 204], "AUTO_PAY_OFF tag");
  }
  return accountId;
}

interface SubscriptionState {
  subscriptionId: string;
  chargedThroughDate: string | null;
  billingEndDate: string | null;
}

function subscriptionState(body: Json): SubscriptionState {
  return {
    subscriptionId: text(body, "subscriptionId") ?? "",
    chargedThroughDate: text(body, "chargedThroughDate"),
    billingEndDate: text(body, "billingEndDate"),
  };
}

/** The car's bay subscription (external key `<prefix>car-<id>`), reused when it already exists. */
export async function ensureSubscription(accountId: string, carId: string, plan: PlanName): Promise<SubscriptionState> {
  const key = subscriptionKey(carId);
  const existing = await kb("GET", `/1.0/kb/subscriptions?externalKey=${encodeURIComponent(key)}`);
  if (existing.status === 200) return subscriptionState(existing.body);
  const created = await kb("POST", "/1.0/kb/subscriptions", {
    body: { accountId, externalKey: key, bundleExternalKey: key, planName: plan },
    timeoutMs: 20_000,
  });
  const id = created.status === 201 ? idFromLocation(created.location) : null;
  if (id) return subscription(id);
  return subscriptionState(expect(await kb("GET", `/1.0/kb/subscriptions?externalKey=${encodeURIComponent(key)}`), [200], "subscription").body);
}

export async function subscription(subscriptionId: string): Promise<SubscriptionState> {
  return subscriptionState(expect(await kb("GET", `/1.0/kb/subscriptions/${subscriptionId}`), [200], "subscription").body);
}

/** Entitlement ends at once; billing ends at the end of the paid term. */
export async function cancelSubscription(subscriptionId: string): Promise<void> {
  expect(
    await kb("DELETE", `/1.0/kb/subscriptions/${subscriptionId}?entitlementPolicy=IMMEDIATE&billingPolicy=END_OF_TERM`, { timeoutMs: 20_000 }),
    [204, 200],
    "cancel subscription",
  );
}

/** Records one external charge and returns the committed Kill Bill invoice id. */
export async function chargeAccount(accountId: string, totalCentimes: bigint, description: string): Promise<string> {
  const response = expect(
    await kb("POST", `/1.0/kb/invoices/charges/${accountId}?autoCommit=true`, {
      body: [{ accountId, description, amount: amount(totalCentimes), currency: "CHF" }],
      timeoutMs: 20_000,
    }),
    [201, 200],
    "external charge",
  );
  const items = Array.isArray(response.body) ? response.body : [];
  const invoiceId = items.length > 0 ? text(items[0] ?? null, "invoiceId") : null;
  if (!invoiceId) throw new Error("Kill Bill charge without invoice id");
  return invoiceId;
}

export interface KbPayment {
  paymentId: string;
  amountCentimes: bigint;
  refundedCentimes: bigint;
  at: string;
}

export interface KbInvoiceState {
  balanceCentimes: bigint;
  payments: KbPayment[];
  paidAt: string | null;
}

function paymentOf(p: Json): KbPayment {
  const transactions = field(p, "transactions");
  const purchase = (Array.isArray(transactions) ? transactions : []).find((t) => text(t, "transactionType") === "PURCHASE");
  return {
    paymentId: text(p, "paymentId") ?? "",
    amountCentimes: centimes(field(p, "purchasedAmount")),
    refundedCentimes: centimes(field(p, "refundedAmount")),
    at: text(purchase ?? null, "effectiveDate") ?? "",
  };
}

/**
 * The invoice's balance and every payment against it, as Kill Bill reports them now. `transfers` are
 * the Kill Bill payment ids the house recorded for this invoice; any that Kill Bill had to take as an
 * account payment (see recordExternalPayment) are read from Kill Bill too.
 */
const PAYMENTS = "/1.0/kb/payments";

/** The Kill Bill resource path of one payment. */
function paymentPath(paymentId: string): string {
  return [PAYMENTS, paymentId].join("/");
}

export async function invoiceState(invoiceId: string, transfers: string[], timeoutMs = 4000): Promise<KbInvoiceState> {
  const [invoice, payments] = await Promise.all([
    kb("GET", `/1.0/kb/invoices/${invoiceId}`, { timeoutMs }),
    kb("GET", `/1.0/kb/invoices/${invoiceId}/payments`, { timeoutMs }),
  ]);
  expect(invoice, [200], "invoice");
  expect(payments, [200], "invoice payments");
  const list = (Array.isArray(payments.body) ? payments.body : []).map(paymentOf);
  const accountPayments = transfers.filter((id) => !list.some((p) => p.paymentId === id));
  for (const response of await Promise.all(accountPayments.map((id) => kb("GET", paymentPath(id), { timeoutMs })))) {
    list.push(paymentOf(expect(response, [200], "payment").body));
  }
  list.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  // A refund made through Kill Bill's payment API leaves the invoice's own balance untouched while
  // the payment reports it as refunded; the invoice amount less what its payments still hold is
  // Kill Bill's view of what remains due, so the larger of the two is the live balance.
  const stillPaid = list.reduce((sum, p) => sum + p.amountCentimes - p.refundedCentimes, 0n);
  const reopened = centimes(field(invoice.body, "amount")) - stillPaid;
  const reported = centimes(field(invoice.body, "balance"));
  const balanceCentimes = reopened > reported ? reopened : reported;
  const lastPurchase = list.filter((p) => p.amountCentimes > 0n).at(-1);
  return { balanceCentimes, payments: list, paidAt: balanceCentimes === 0n && lastPurchase ? lastPurchase.at : null };
}

async function externalPaymentMethod(accountId: string): Promise<string> {
  const methods = expect(await kb("GET", `/1.0/kb/accounts/${accountId}/paymentMethods`), [200], "payment methods").body;
  const external = (Array.isArray(methods) ? methods : []).find((m) => text(m, "pluginName") === "__EXTERNAL_PAYMENT__");
  const id = external ? text(external, "paymentMethodId") : null;
  if (id) return id;
  const created = expect(
    await kb("POST", `/1.0/kb/accounts/${accountId}/paymentMethods`, { body: { accountId, pluginName: "__EXTERNAL_PAYMENT__" } }),
    [201],
    "external payment method",
  );
  return idFromLocation(created.location);
}

/**
 * One external payment of exactly the amount against the invoice; returns the payment id. When
 * Kill Bill's own invoice still counts a refunded payment as paid it answers 204 and takes no
 * payment; the same external payment is then recorded on the owner's account, and the house's
 * transfer record ties it to the invoice.
 */
export async function recordExternalPayment(
  accountId: string,
  invoiceId: string,
  amountCentimes: bigint,
  externalKey: string,
  bankReference: string,
): Promise<string> {
  const onInvoice = await kb("POST", `/1.0/kb/invoices/${invoiceId}/payments?externalPayment=true`, {
    body: { accountId, targetInvoiceId: invoiceId, purchasedAmount: amount(amountCentimes), currency: "CHF", paymentExternalKey: externalKey },
    timeoutMs: 20_000,
  });
  let location = onInvoice.location;
  if (onInvoice.status === 204) {
    const method = await externalPaymentMethod(accountId);
    location = expect(
      await kb("POST", `/1.0/kb/accounts/${accountId}/payments?paymentMethodId=${method}`, {
        body: { transactionType: "PURCHASE", amount: amount(amountCentimes), currency: "CHF", paymentExternalKey: externalKey },
        timeoutMs: 20_000,
      }),
      [201],
      "external account payment",
    ).location;
  } else {
    expect(onInvoice, [201, 200], "external payment");
  }
  const paymentId = idFromLocation(location);
  expect(
    await kb("POST", `${paymentPath(paymentId)}/customFields`, { body: [{ name: "bank_reference", value: bankReference }] }),
    [201, 200],
    "bank_reference custom field",
  );
  return paymentId;
}

/** True when Kill Bill's health check answers within the probe timeout. */
export async function healthy(timeoutMs: number): Promise<boolean> {
  try {
    const response = await fetch(`${url}/1.0/healthcheck`, { signal: AbortSignal.timeout(timeoutMs) });
    await response.arrayBuffer();
    return response.ok;
  } catch {
    return false;
  }
}
