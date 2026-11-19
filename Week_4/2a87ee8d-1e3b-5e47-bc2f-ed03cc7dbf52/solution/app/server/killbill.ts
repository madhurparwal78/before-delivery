// Kill Bill over its REST API. Amounts cross this boundary as JSON numbers and leave it as integer cents.
import { config } from "./config.js";
import { centsToAmount } from "../shared/money.js";
import { PLANS, PLAN_LABELS, PRICES, TERMS, isImmediateChange, planCode, type Plan, type Term } from "../shared/plans.js";

export class BillingDown extends Error {}

interface KbResponse {
  status: number;
  text: string;
}

const AUTH = `Basic ${Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64")}`;

async function call(method: string, path: string, body?: string, contentType = "application/json"): Promise<KbResponse> {
  let response: Response;
  try {
    response = await fetch(`${config.killbill.url}/1.0/kb${path}`, {
      method,
      headers: {
        Authorization: AUTH,
        "X-Killbill-ApiKey": config.killbill.apiKey,
        "X-Killbill-ApiSecret": config.killbill.apiSecret,
        "X-Killbill-CreatedBy": "lanternfold-rooms",
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": contentType }),
      },
      ...(body === undefined ? {} : { body }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new BillingDown((error as Error).message);
  }
  const text = await response.text();
  if (response.status >= 500 || response.status === 401) throw new BillingDown(`Kill Bill ${method} ${path}: ${response.status}`);
  return { status: response.status, text };
}

function json<T>(response: KbResponse, what: string): T {
  if (response.status >= 400) throw new BillingDown(`${what}: ${response.status} ${response.text.slice(0, 200)}`);
  return JSON.parse(response.text) as T;
}

function ok(response: KbResponse, what: string): void {
  if (response.status >= 400) throw new BillingDown(`${what}: ${response.status} ${response.text.slice(0, 200)}`);
}

/** Kill Bill's JSON amount to exact cents. */
function cents(amount: number | null | undefined): number {
  return Math.round((amount ?? 0) * 100);
}


export async function healthy(): Promise<boolean> {
  try {
    return (await call("GET", "/catalog/versions")).status < 400;
  } catch {
    return false;
  }
}

function catalogXml(): string {
  const productOf = (plan: Plan) => PLAN_LABELS[plan];
  const offered = PLANS.flatMap((plan) => TERMS.filter((term) => PRICES[plan][term] !== undefined).map((term) => ({ plan, term })));
  const cases = offered
    .flatMap((from) => offered.filter((to) => isImmediateChange(from, to)).map((to) => ({ from, to })))
    .map(
      ({ from, to }) =>
        `<changePolicyCase><fromProduct>${productOf(from.plan)}</fromProduct><fromBillingPeriod>${from.term.toUpperCase()}</fromBillingPeriod>` +
        `<toProduct>${productOf(to.plan)}</toProduct><toBillingPeriod>${to.term.toUpperCase()}</toBillingPeriod><policy>IMMEDIATE</policy></changePolicyCase>`,
    )
    .join("");
  const plans = offered
    .map(
      ({ plan, term }) =>
        `<plan name="${planCode(plan, term)}"><product>${productOf(plan)}</product><finalPhase type="EVERGREEN"><duration><unit>UNLIMITED</unit></duration>` +
        `<recurring><billingPeriod>${term.toUpperCase()}</billingPeriod><recurringPrice><price><currency>EUR</currency><value>${PRICES[plan][term]}</value></price></recurringPrice></recurring></finalPhase></plan>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
<effectiveDate>2020-01-01T00:00:00+00:00</effectiveDate><catalogName>LanternfoldRooms</catalogName>
<recurringBillingMode>IN_ADVANCE</recurringBillingMode><currencies><currency>EUR</currency></currencies>
<products>${PLANS.map((p) => `<product name="${productOf(p)}"><category>BASE</category></product>`).join("")}</products>
<rules>
<changePolicy>${cases}<changePolicyCase><policy>END_OF_TERM</policy></changePolicyCase></changePolicy>
<changeAlignment><changeAlignmentCase><alignment>START_OF_SUBSCRIPTION</alignment></changeAlignmentCase></changeAlignment>
<cancelPolicy><cancelPolicyCase><policy>END_OF_TERM</policy></cancelPolicyCase></cancelPolicy>
<createAlignment><createAlignmentCase><alignment>START_OF_BUNDLE</alignment></createAlignmentCase></createAlignment>
<billingAlignment><billingAlignmentCase><alignment>SUBSCRIPTION</alignment></billingAlignmentCase></billingAlignment>
<priceList><priceListCase><toPriceList>DEFAULT</toPriceList></priceListCase></priceList>
</rules>
<plans>${plans}</plans>
<priceLists><defaultPriceList name="DEFAULT"><plans>${offered.map((o) => `<plan>${planCode(o.plan, o.term)}</plan>`).join("")}</plans></defaultPriceList></priceLists>
</catalog>`;
}

export async function catalogVersions(): Promise<string[]> {
  return json<string[]>(await call("GET", "/catalog/versions"), "catalog versions");
}

export async function uploadCatalog(): Promise<void> {
  ok(await call("POST", "/catalog/xml", catalogXml(), "text/xml"), "catalog upload");
}

interface KbAccount {
  accountId: string;
  paymentMethodId: string | null;
}

async function findAccount(externalKey: string): Promise<KbAccount | null> {
  const response = await call("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  if (response.status === 404) return null;
  return json<KbAccount>(response, "account lookup");
}

/** Creates the account, or returns the one another instance created under the same external key. */
export async function ensureAccount(input: { externalKey: string; name: string; email: string; timeZone?: string }): Promise<KbAccount> {
  const existing = await findAccount(input.externalKey);
  if (existing) return existing;
  const response = await call("POST", "/accounts", JSON.stringify({ ...input, currency: "EUR" }));
  if (response.status >= 400 && response.status !== 409) throw new BillingDown(`account create: ${response.status}`);
  const created = await findAccount(input.externalKey);
  if (!created) throw new BillingDown("account missing after create");
  return created;
}

export async function addExternalPaymentMethod(accountId: string): Promise<void> {
  ok(await call("POST", `/accounts/${accountId}/paymentMethods?isDefault=true`, JSON.stringify({ pluginName: "__EXTERNAL_PAYMENT__" })), "payment method");
}

export interface KbSubscription {
  subscriptionId: string;
  planName: string;
  state: string;
  chargedThroughDate: string | null;
  billingStartDate: string;
  events: { eventType: string; effectiveDate: string; plan: string | null }[];
}

export async function subscriptions(accountId: string): Promise<KbSubscription[]> {
  const bundles = json<{ subscriptions: KbSubscription[] }[]>(await call("GET", `/accounts/${accountId}/bundles`), "bundles");
  return bundles.flatMap((b) => b.subscriptions);
}

export async function createSubscription(accountId: string, plan: Plan, term: Term): Promise<void> {
  const response = await call("POST", "/subscriptions?callCompletion=true&callTimeoutSec=10", JSON.stringify({ accountId, planName: planCode(plan, term) }));
  if (response.status >= 400 && response.status !== 408) throw new BillingDown(`subscription create: ${response.status}`);
}

export async function changePlan(subscriptionId: string, plan: Plan, term: Term, immediate: boolean): Promise<void> {
  const response = await call(
    "PUT",
    `/subscriptions/${subscriptionId}?callCompletion=true&callTimeoutSec=10&policy=${immediate ? "IMMEDIATE" : "END_OF_TERM"}`,
    JSON.stringify({ planName: planCode(plan, term) }),
  );
  if (response.status >= 400 && response.status !== 408) throw new BillingDown(`change plan: ${response.status} ${response.text.slice(0, 200)}`);
}

export async function undoChangePlan(subscriptionId: string): Promise<void> {
  ok(await call("PUT", `/subscriptions/${subscriptionId}/undoChangePlan`), "undo change");
}

export interface KbInvoice {
  id: string;
  number: string;
  date: string;
  amountCents: number;
  balanceCents: number;
  descriptions: string[];
}

interface RawInvoice {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  amount: number;
  balance: number;
  items?: { description: string | null }[];
}

function toInvoice(raw: RawInvoice): KbInvoice {
  return {
    id: raw.invoiceId,
    number: raw.invoiceNumber,
    date: raw.invoiceDate,
    amountCents: cents(raw.amount),
    balanceCents: cents(raw.balance),
    descriptions: (raw.items ?? []).map((i) => i.description ?? ""),
  };
}

export async function invoiceIds(accountId: string): Promise<string[]> {
  return json<RawInvoice[]>(await call("GET", `/accounts/${accountId}/invoices`), "invoices").map((i) => i.invoiceId);
}

/** The account listing reports summaries; amounts and items come from each invoice. */
export async function invoice(invoiceId: string): Promise<KbInvoice> {
  return toInvoice(json<RawInvoice>(await call("GET", `/invoices/${invoiceId}?withItems=true`), "invoice"));
}

export async function invoices(accountId: string): Promise<KbInvoice[]> {
  return Promise.all((await invoiceIds(accountId)).map(invoice));
}

/** Whether the account carries Kill Bill's automatic-payment-off control tag. */
export async function autoPayOff(accountId: string): Promise<boolean> {
  const tags = json<{ tagDefinitionName: string }[]>(await call("GET", `/accounts/${accountId}/tags`), "account tags");
  return tags.some((tag) => tag.tagDefinitionName === "AUTO_PAY_OFF");
}

export async function payInvoice(accountId: string, target: KbInvoice): Promise<void> {
  const body = `{"accountId":${JSON.stringify(accountId)},"targetInvoiceId":${JSON.stringify(target.id)},"purchasedAmount":${centsToAmount(target.balanceCents)}}`;
  ok(await call("POST", `/invoices/${target.id}/payments?externalPayment=false`, body), "invoice payment");
}

export async function externalCharge(accountId: string, amountCents: number, description: string): Promise<KbInvoice> {
  const body = `[{"accountId":${JSON.stringify(accountId)},"currency":"EUR","description":${JSON.stringify(description)},"amount":${centsToAmount(amountCents)}}]`;
  const items = json<{ invoiceId: string }[]>(await call("POST", `/invoices/charges/${accountId}?autoCommit=true`, body), "external charge");
  const first = items[0];
  if (!first) throw new BillingDown("external charge returned no item");
  return invoice(first.invoiceId);
}
