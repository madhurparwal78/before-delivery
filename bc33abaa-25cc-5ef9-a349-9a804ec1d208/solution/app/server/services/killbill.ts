// Kill Bill: catalog, one account per workspace, subscriptions, invoices and payment transactions.
import { config } from "../config.js";
import { transaction } from "../db.js";
import { unavailable } from "../errors.js";
import { isRecord } from "../../shared/graph.js";
import type { Period, Plan } from "../../shared/api-types.js";
import { PLAN_CATALOG } from "../../shared/plans.js";
import { PERIODS, PLAN_IDS, killbillPlan, killbillSeatPlan } from "../domain/subscription.js";

const BASE = `${config.killbill.url}/1.0/kb`;
const AUTO_PAY_OFF = "00000000-0000-0000-0000-000000000001";
const AUTO_INVOICING_OFF = "00000000-0000-0000-0000-000000000002";

type Query = Record<string, string>;

async function call(method: string, path: string, options: { query?: Query; json?: unknown; xml?: string } = {}): Promise<Response> {
  const url = `${BASE}${path}${options.query ? `?${new URLSearchParams(options.query)}` : ""}`;
  const headers: Record<string, string> = {
    authorization: `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64")}`,
    "x-killbill-apikey": config.killbill.apiKey,
    "x-killbill-apisecret": config.killbill.apiSecret,
    "x-killbill-createdby": "orrery-studio",
    accept: "application/json",
  };
  let body: string | undefined;
  if (options.json !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(options.json); }
  if (options.xml !== undefined) { headers["content-type"] = "text/xml"; body = options.xml; }
  let response: Response;
  try {
    response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(30_000) });
  } catch {
    throw unavailable("billing");
  }
  if (response.status >= 500 || response.status === 401) throw unavailable("billing");
  return response;
}

/** A refused or unreadable gateway answer is the billing outage answer; the detail goes to the log. */
async function expectOk(response: Response, what: string): Promise<Response> {
  if (response.ok) return response;
  console.error(`Kill Bill ${what} failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  throw unavailable("billing");
}

function malformed(what: string): never {
  console.error(`Kill Bill returned a malformed ${what}`);
  throw unavailable("billing");
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  return text ? JSON.parse(text) as unknown : null;
}

const createdId = (response: Response) => (response.headers.get("location") ?? "").replace(/\/+$/, "").split("/").pop() ?? "";

const str = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) => (typeof value === "number" ? value : Number(value ?? 0));
/** Kill Bill money is decimal dollars; the app works in integer cents. */
const toCents = (amount: unknown) => Math.round(num(amount) * 100);
const decimal = (cents: number) => `${Math.trunc(cents / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;
const toDollars = (cents: number) => Number(decimal(cents));

function catalogXml(): string {
  const plan = (name: string, product: string, period: Period, price: string) => `
    <plan name="${name}"><product>${product}</product>
      <finalPhase type="EVERGREEN"><duration><unit>UNLIMITED</unit></duration>
        <recurring><billingPeriod>${period === "monthly" ? "MONTHLY" : "ANNUAL"}</billingPeriod>
          <recurringPrice><price><currency>USD</currency><value>${price}</value></price></recurringPrice></recurring>
      </finalPhase></plan>`;
  const names: string[] = [];
  const plans = PLAN_IDS.flatMap((p) => PERIODS.flatMap((period) => {
    names.push(killbillPlan(p, period), killbillSeatPlan(p, period));
    const prices = PLAN_CATALOG[p].prices[period];
    return [plan(killbillPlan(p, period), PLAN_CATALOG[p].name, period, decimal(prices.base)),
      plan(killbillSeatPlan(p, period), "Seat", period, decimal(prices.seat))];
  }));
  return `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>2020-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>OrreryStudio</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies><currency>USD</currency></currencies>
  <products>
    <product name="Team"><category>BASE</category><available><addonProduct>Seat</addonProduct></available></product>
    <product name="Business"><category>BASE</category><available><addonProduct>Seat</addonProduct></available></product>
    <product name="Seat"><category>ADD_ON</category></product>
  </products>
  <rules>
    <changePolicy><changePolicyCase><policy>IMMEDIATE</policy></changePolicyCase></changePolicy>
    <cancelPolicy><cancelPolicyCase><policy>IMMEDIATE</policy></cancelPolicyCase></cancelPolicy>
  </rules>
  <plans>${plans.join("")}
  </plans>
  <priceLists><defaultPriceList name="DEFAULT"><plans>${names.map((n) => `<plan>${n}</plan>`).join("")}</plans></defaultPriceList></priceLists>
</catalog>`;
}

async function catalogHasPlans(): Promise<boolean> {
  const body = await readJson(await expectOk(await call("GET", "/catalog"), "catalog read"));
  return JSON.stringify(body).includes(`"${killbillSeatPlan("business", "annual")}"`);
}

let catalogReady: Promise<void> | null = null;

/**
 * Uploads the catalog once Kill Bill is reachable; uploading again is skipped when the plans are there.
 * Serve instances sharing one tenant take a PostgreSQL advisory lock first, so only one of them uploads.
 */
export function ensureCatalog(): Promise<void> {
  catalogReady ??= transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('orrery.killbill.catalog'))");
    if (await catalogHasPlans()) return;
    await expectOk(await call("POST", "/catalog/xml", { xml: catalogXml() }), "catalog upload");
  }).catch((error: unknown) => { catalogReady = null; throw error; });
  return catalogReady;
}

export interface KbAccount { accountId: string; paymentMethodId: string; referenceTime: string }

function account(body: unknown): KbAccount {
  if (!isRecord(body)) malformed("account");
  return { accountId: str(body.accountId), paymentMethodId: str(body.paymentMethodId), referenceTime: str(body.referenceTime) };
}

export async function findAccount(workspaceId: string): Promise<KbAccount | null> {
  const response = await call("GET", "/accounts", { query: { externalKey: workspaceId } });
  if (response.status === 404) return null;
  return account(await readJson(await expectOk(response, "account lookup")));
}

/** One account per workspace: AUTO_PAY_OFF first, then the external payment method, so only the app records payments. */
export async function openAccount(workspaceId: string, name: string, email: string): Promise<KbAccount> {
  const existing = await findAccount(workspaceId);
  if (existing?.paymentMethodId) return existing;
  const id = existing?.accountId ?? createdId(await expectOk(
    await call("POST", "/accounts", { json: { name, email, externalKey: workspaceId, currency: "USD" } }), "account create"));
  await expectOk(await call("POST", `/accounts/${id}/tags`, { json: [AUTO_PAY_OFF] }), "AUTO_PAY_OFF tag");
  await expectOk(await call("POST", `/accounts/${id}/paymentMethods`, {
    query: { isDefault: "true" }, json: { pluginName: "__EXTERNAL_PAYMENT__", pluginInfo: {} },
  }), "payment method");
  return account(await readJson(await expectOk(await call("GET", `/accounts/${id}`), "account read")));
}

export interface KbInvoice { invoiceId: string; accountId: string; invoiceNumber: string; invoiceDate: string; amountCents: number; balanceCents: number; items: { description: string; amountCents: number }[] }

function invoiceOf(body: unknown): KbInvoice {
  if (!isRecord(body)) malformed("invoice");
  const items = Array.isArray(body.items) ? body.items.filter(isRecord) : [];
  return {
    invoiceId: str(body.invoiceId), accountId: str(body.accountId), invoiceNumber: String(body.invoiceNumber ?? ""), invoiceDate: str(body.invoiceDate),
    amountCents: toCents(body.amount), balanceCents: toCents(body.balance),
    items: items.map((i) => ({ description: str(i.prettyPlanName) || str(i.planName) || str(i.itemType), amountCents: toCents(i.amount) })),
  };
}

export async function accountInvoices(accountId: string): Promise<KbInvoice[]> {
  const body = await readJson(await expectOk(await call("GET", `/accounts/${accountId}/invoices`, { query: { includeInvoiceComponents: "true" } }), "invoice list"));
  return Array.isArray(body) ? body.map(invoiceOf) : [];
}

export async function invoice(invoiceId: string): Promise<KbInvoice | null> {
  const response = await call("GET", `/invoices/${invoiceId}`);
  if (response.status === 404) return null;
  return invoiceOf(await readJson(await expectOk(response, "invoice read")));
}

/** Kill Bill generates invoices asynchronously; waits for the one an action produced. */
export async function newInvoice(accountId: string, known: ReadonlySet<string>): Promise<KbInvoice> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const fresh = (await accountInvoices(accountId)).find((i) => !known.has(i.invoiceId));
    if (fresh) return fresh;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw unavailable("billing");
}

interface KbSubscription { subscriptionId: string; bundleId: string; planName: string; category: string; quantity: number; chargedThroughDate: string }

export async function activeSubscriptions(accountId: string): Promise<KbSubscription[]> {
  const body = await readJson(await expectOk(await call("GET", `/accounts/${accountId}/bundles`), "bundle list"));
  const subs: KbSubscription[] = [];
  for (const bundle of Array.isArray(body) ? body.filter(isRecord) : []) {
    for (const s of Array.isArray(bundle.subscriptions) ? bundle.subscriptions.filter(isRecord) : []) {
      if (s.state !== "ACTIVE") continue;
      subs.push({ subscriptionId: str(s.subscriptionId), bundleId: str(s.bundleId), planName: str(s.planName),
        category: str(s.productCategory), quantity: typeof s.quantity === "number" ? s.quantity : 1, chargedThroughDate: str(s.chargedThroughDate) });
    }
  }
  return subs;
}

export async function startSubscription(accountId: string, plan: Plan, period: Period, extraSeats: number): Promise<void> {
  const entries: Record<string, unknown>[] = [{ accountId, planName: killbillPlan(plan, period) }];
  if (extraSeats > 0) entries.push({ accountId, planName: killbillSeatPlan(plan, period), quantity: extraSeats });
  await expectOk(await call("POST", "/subscriptions/createSubscriptionWithAddOns", { json: entries }), "subscription create");
}

export async function previewChange(accountId: string, sub: KbSubscription, planName: string): Promise<number> {
  const body = await readJson(await expectOk(await call("POST", "/invoices/dryRun", {
    query: { accountId },
    json: { dryRunType: "SUBSCRIPTION_ACTION", dryRunAction: "CHANGE", planName, subscriptionId: sub.subscriptionId, bundleId: sub.bundleId, billingPolicy: "IMMEDIATE" },
  }), "dry run"));
  if (!isRecord(body) || typeof body.amount !== "number") malformed("dry-run invoice");
  return toCents(body.amount);
}

export async function changePlan(sub: KbSubscription, planName: string, policy: "IMMEDIATE" | "END_OF_TERM"): Promise<void> {
  await expectOk(await call("PUT", `/subscriptions/${sub.subscriptionId}`, { query: { billingPolicy: policy }, json: { planName } }), "plan change");
}

/** Runs several subscription changes so Kill Bill invoices them together on one invoice. */
export async function asOneInvoice(accountId: string, work: () => Promise<void>): Promise<void> {
  await expectOk(await call("POST", `/accounts/${accountId}/tags`, { json: [AUTO_INVOICING_OFF] }), "AUTO_INVOICING_OFF tag");
  try {
    await work();
  } finally {
    await expectOk(await call("DELETE", `/accounts/${accountId}/tags`, { query: { tagDef: AUTO_INVOICING_OFF } }), "AUTO_INVOICING_OFF removal");
  }
}

export async function addSeats(accountId: string, bundleId: string, planName: string, quantity: number, startDate?: string): Promise<void> {
  await expectOk(await call("POST", "/subscriptions", {
    query: startDate ? { entitlementDate: startDate, billingDate: startDate } : {},
    json: { accountId, bundleId, planName, quantity },
  }), "seat add-on");
}

export async function cancel(sub: KbSubscription, policy: "IMMEDIATE" | "END_OF_TERM"): Promise<void> {
  await expectOk(await call("DELETE", `/subscriptions/${sub.subscriptionId}`, { query: { entitlementPolicy: policy, billingPolicy: policy } }), "cancel");
}

/** The instant an end-of-term change takes effect: the charged-through date at the account's reference time. */
export function endOfTerm(acct: KbAccount, sub: KbSubscription): Date {
  const time = acct.referenceTime.slice(11, 19) || "00:00:00";
  return new Date(`${sub.chargedThroughDate}T${time}Z`);
}

/** A PURCHASE against one invoice through the invoice payment control plugin, keyed for idempotency. */
export async function purchase(acct: KbAccount, invoiceId: string, amountCents: number, externalKey: string): Promise<string> {
  const response = await call("POST", `/accounts/${acct.accountId}/payments`, {
    query: { paymentMethodId: acct.paymentMethodId, controlPluginName: "__INVOICE_PAYMENT_CONTROL_PLUGIN__", pluginProperty: `IPCD_INVOICE_ID=${invoiceId}` },
    json: { transactionType: "PURCHASE", amount: toDollars(amountCents), currency: "USD", transactionExternalKey: externalKey, paymentExternalKey: externalKey },
  });
  if (response.status === 422) throw unavailable("billing");
  return createdId(await expectOk(response, "purchase"));
}

/** A failed settlement: a chargeback on the invoice payment, which reopens the invoice balance. */
export async function chargeback(paymentId: string, amountCents: number): Promise<void> {
  await expectOk(await call("POST", `/invoicePayments/${paymentId}/chargebacks`, {
    json: { transactionType: "CHARGEBACK", amount: toDollars(amountCents), currency: "USD" },
  }), "chargeback");
}

export async function refund(paymentId: string, amountCents: number, externalKey: string): Promise<void> {
  await expectOk(await call("POST", `/payments/${paymentId}/refunds`, {
    json: { transactionType: "REFUND", amount: toDollars(amountCents), currency: "USD", transactionExternalKey: externalKey },
  }), "refund");
}

